import React, { useMemo } from 'react'
import { parseCppSolutionSignature, normalizeType as normalizeCppType } from './cppHarness'
import { parseJavaSolutionSignature, normalizeType as normalizeJavaType } from './javaHarness'
import { parsePythonSolutionSignature } from './pythonSignature'

// ============================================================
// Per-parameter input fields — replaces the raw JSON textarea.
// Reuses each language's harness-side signature parser so the
// per-field UI is always in sync with what the harness will
// eventually marshal into a real value.
//
//   parseSignature(code, language) → { name, retType, params: [{name, type}] } | null
//   classifyKind(type, language)   → 'int' | 'float' | 'bool' | 'string'
//                                    | 'char' | 'vec' | 'vec2'
//                                    | 'listnode' | 'treenode' | 'unknown'
//   parseFieldValues(sig, values, lang) → { ok, args? , error? }
// ============================================================

// ── Signature parser dispatch ──
export function parseSignatureFor(code, language) {
  if (!code || !code.trim()) return null
  try {
    if (language === 'cpp') return parseCppSolutionSignature(code)
    if (language === 'java') return parseJavaSolutionSignature(code)
    if (language === 'python') return parsePythonSolutionSignature(code)
  } catch { return null }
  return null
}

// ── Type → field kind classifier ──
// Same categories for every language so the UI is uniform.
export function classifyKind(type, language) {
  if (!type) return 'unknown'
  const t = language === 'cpp' ? normalizeCppType(type)
          : language === 'java' ? normalizeJavaType(type)
          : type.trim()

  if (language === 'cpp') {
    if (t === 'int' || t === 'long' || t === 'long long') return 'int'
    if (t === 'double' || t === 'float') return 'float'
    if (t === 'bool') return 'bool'
    if (t === 'char') return 'char'
    if (t === 'string') return 'string'
    if (t === 'ListNode*') return 'listnode'
    if (t === 'TreeNode*') return 'treenode'
    const m1 = t.match(/^vector<(.+)>$/)
    if (m1) {
      const inner = m1[1]
      if (/^vector<.+>$/.test(inner)) return 'vec2'
      return 'vec'
    }
    return 'unknown'
  }

  if (language === 'java') {
    if (t === 'int' || t === 'long' || t === 'Integer' || t === 'Long') return 'int'
    if (t === 'double' || t === 'float' || t === 'Double' || t === 'Float') return 'float'
    if (t === 'boolean' || t === 'Boolean') return 'bool'
    if (t === 'char' || t === 'Character') return 'char'
    if (t === 'String') return 'string'
    if (t === 'ListNode') return 'listnode'
    if (t === 'TreeNode') return 'treenode'
    if (t.endsWith('[][]')) return 'vec2'
    if (t.endsWith('[]')) return 'vec'
    const list1 = t.match(/^List<(.+)>$/)
    if (list1) {
      const inner = list1[1]
      if (/^List<.+>$/.test(inner)) return 'vec2'
      return 'vec'
    }
    return 'unknown'
  }

  if (language === 'python') {
    // Peel Optional[...] since LeetCode annotates trees/lists as Optional[TreeNode].
    let base = t
    let opt = base.match(/^Optional\[(.+)\]$/)
    if (opt) base = opt[1].trim()
    if (base === 'int') return 'int'
    if (base === 'float') return 'float'
    if (base === 'bool') return 'bool'
    if (base === 'str') return 'string'
    if (base === 'TreeNode') return 'treenode'
    if (base === 'ListNode') return 'listnode'
    const list1 = base.match(/^List\[(.+)\]$/)
    if (list1) {
      const inner = list1[1].trim()
      if (/^List\[.+\]$/.test(inner)) return 'vec2'
      return 'vec'
    }
    return 'unknown'
  }

  return 'unknown'
}

// ── One field value → JS value the harness accepts ──
function parseFieldValue(kind, raw) {
  const trimmed = (raw ?? '').trim()

  if (kind === 'int') {
    if (trimmed === '') return { ok: false, error: 'expected integer' }
    const n = Number(trimmed)
    if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: 'expected integer' }
    return { ok: true, value: n }
  }
  if (kind === 'float') {
    if (trimmed === '') return { ok: false, error: 'expected number' }
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return { ok: false, error: 'expected number' }
    return { ok: true, value: n }
  }
  if (kind === 'bool') {
    if (trimmed === '' || (trimmed !== 'true' && trimmed !== 'false')) {
      return { ok: false, error: 'expected true or false' }
    }
    return { ok: true, value: trimmed === 'true' }
  }
  if (kind === 'string') {
    // Strip a single surrounding pair of quotes if present, else use verbatim.
    let s = trimmed
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1)
    }
    return { ok: true, value: s }
  }
  if (kind === 'char') {
    let s = trimmed
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1)
    }
    if (s.length !== 1) return { ok: false, error: 'expected a single character' }
    return { ok: true, value: s }
  }

  if (kind === 'vec') {
    // Accept `[1,2,3]` OR `1,2,3` OR `["a","b"]`.
    if (trimmed === '') return { ok: true, value: [] }
    if (trimmed.startsWith('[')) {
      try { return { ok: true, value: JSON.parse(trimmed) } }
      catch (e) { return { ok: false, error: 'invalid JSON array: ' + e.message } }
    }
    // Comma-separated. Try numeric first, then string fallback.
    const parts = trimmed.split(',').map(s => s.trim()).filter(s => s.length > 0)
    const nums = parts.map(p => Number(p))
    if (nums.every(n => Number.isFinite(n))) return { ok: true, value: nums }
    // String fallback — strip quotes if any.
    const strs = parts.map(p => {
      if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) return p.slice(1, -1)
      return p
    })
    return { ok: true, value: strs }
  }

  if (kind === 'vec2') {
    if (trimmed === '') return { ok: true, value: [] }
    // Multi-line vec2 is expected to be pasted as JSON.
    try { return { ok: true, value: JSON.parse(trimmed) } }
    catch (e) { return { ok: false, error: 'invalid 2D JSON: ' + e.message } }
  }

  if (kind === 'listnode') {
    if (trimmed === '' || trimmed === 'null' || trimmed === '[]') return { ok: true, value: [] }
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed)
        if (!Array.isArray(arr)) return { ok: false, error: 'ListNode input must be an array' }
        return { ok: true, value: arr }
      } catch (e) { return { ok: false, error: 'invalid JSON array: ' + e.message } }
    }
    const parts = trimmed.split(',').map(s => s.trim()).filter(s => s.length > 0).map(Number)
    if (!parts.every(n => Number.isFinite(n))) return { ok: false, error: 'ListNode input must be comma-separated integers' }
    return { ok: true, value: parts }
  }

  if (kind === 'treenode') {
    if (trimmed === '' || trimmed === 'null') return { ok: true, value: null }
    try {
      const arr = JSON.parse(trimmed)
      if (!Array.isArray(arr)) return { ok: false, error: 'TreeNode input must be an array' }
      return { ok: true, value: arr }
    } catch (e) { return { ok: false, error: 'invalid tree JSON: ' + e.message } }
  }

  // 'unknown' → last-resort JSON parse.
  if (trimmed === '') return { ok: false, error: 'value required' }
  try { return { ok: true, value: JSON.parse(trimmed) } }
  catch (e) { return { ok: false, error: 'unrecognized type — use JSON: ' + e.message } }
}

// ── Assembly: field values → args array in signature order ──
export function parseFieldValues(sig, values, language) {
  if (!sig || !sig.params) return { ok: false, error: 'no signature' }
  const args = []
  for (const p of sig.params) {
    const kind = classifyKind(p.type, language)
    const raw = values[p.name]
    const r = parseFieldValue(kind, raw)
    if (!r.ok) return { ok: false, error: `${p.name}: ${r.error}` }
    args.push(r.value)
  }
  return { ok: true, args }
}

// ── UI ──
export function ArgFields({
  language,
  code,
  values,
  onChange,
  onFallback,
  fallbackText,
  onFallbackTextChange,
  runOutput
}) {
  const sig = useMemo(() => parseSignatureFor(code, language), [code, language])

  // Notify parent whether we're in fallback mode so it knows whether
  // to read `values` (structured) or `fallbackText` (raw JSON).
  const usingFallback = !sig || !sig.params
  React.useEffect(() => { onFallback && onFallback(usingFallback) }, [usingFallback])

  if (usingFallback) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Couldn't detect parameters — enter raw arguments as JSON.
          </div>
          <div style={{ fontSize: '11px', color: 'var(--accent-color)', textAlign: 'right', maxWidth: '300px' }}>
            Tip: Place helper functions above your main method, or make them 'private'.
          </div>
        </div>
        <textarea
          value={fallbackText || ''}
          onChange={(e) => onFallbackTextChange(e.target.value)}
          spellCheck={false}
          placeholder='Enter args as JSON, e.g. [[2, 7, 11, 15], 9]'
          style={textareaStyle}
        />
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'auto' }}>
      {sig.params.map((p) => {
        const kind = classifyKind(p.type, language)
        const hint = placeholderFor(kind, p.name)
        const isMultiline = kind === 'vec2'
        return (
          <div key={p.name} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={labelStyle}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{p.name}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontFamily: 'monospace' }}>
                : {p.type}
              </span>
              {kind === 'unknown' && (
                <span style={{ color: 'var(--accent-rose, #ef4444)', marginLeft: '8px' }}>
                  · unsupported type — will fall back
                </span>
              )}
            </label>
            {isMultiline ? (
              <textarea
                value={values[p.name] || ''}
                onChange={(e) => onChange(p.name, e.target.value)}
                spellCheck={false}
                placeholder={hint}
                style={{ ...inputStyle, minHeight: '72px', resize: 'vertical', fontFamily: 'monospace' }}
              />
            ) : (
              <input
                type="text"
                value={values[p.name] || ''}
                onChange={(e) => onChange(p.name, e.target.value)}
                spellCheck={false}
                placeholder={hint}
                style={{ ...inputStyle, fontFamily: 'monospace' }}
              />
            )}
          </div>
        )
      })}
      {sig.retType && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '4px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Returns: <code style={{ color: 'var(--text-primary)' }}>{sig.retType}</code>
            {runOutput && (
              <span style={{ marginLeft: '8px', padding: '2px 6px', background: 'var(--bg-highlight)', color: 'var(--text-success, #10b981)', borderRadius: '4px', fontWeight: 500 }}>
                Result: {runOutput}
              </span>
            )}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--accent-color)', textAlign: 'right', maxWidth: '300px' }}>
            Tip: Place helper functions above your main method, or make them 'private'.
          </div>
        </div>
      )}
    </div>
  )
}

function placeholderFor(kind, paramName) {
  switch (kind) {
    case 'int':      return '42'
    case 'float':    return '3.14'
    case 'bool':     return 'true'
    case 'string':   return 'hello'
    case 'char':     return 'a'
    case 'vec':      return '2,7,11,15   or   [2,7,11,15]'
    case 'vec2':     return '[[1,2,3],[4,5,6]]'
    case 'listnode': return '1,2,3,4   or   [1,2,3,4]'
    case 'treenode': return '[3,9,20,null,null,15,7]'
    default:         return `Enter value for ${paramName || 'arg'} directly, e.g. [0,1,1,1,1,1,0,0,0]`
  }
}

const inputStyle = {
  width: '100%',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-base)',
  borderRadius: '4px',
  color: 'var(--text-primary)',
  fontSize: '12px',
  padding: '6px 8px',
  outline: 'none',
  boxSizing: 'border-box'
}

const textareaStyle = {
  flex: 1,
  ...inputStyle,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  padding: '8px 10px',
  resize: 'none'
}

const labelStyle = {
  fontSize: '11px',
  color: 'var(--text-muted)',
  display: 'flex',
  alignItems: 'center'
}
