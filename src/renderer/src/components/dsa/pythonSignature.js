// ============================================================
// PYTHON SIGNATURE PARSER
// Recognizes `class Solution:` with a first non-dunder method
// annotated in LeetCode's typing style:
//   def findMaxLength(self, nums: List[int]) -> int:
//   def invertTree(self, root: Optional[TreeNode]) -> Optional[TreeNode]:
// ============================================================

export function parsePythonSolutionSignature(src) {
  if (!src) return null
  const classRe = /class\s+Solution\s*(?:\([^)]*\))?\s*:/
  const classIdx = src.search(classRe)
  if (classIdx < 0) return null

  // Find first def name(self, ...) inside the class. We keep it
  // simple: allow anything up to a trailing `:` on the def line.
  const defRe = /def\s+([A-Za-z_]\w*)\s*\(\s*self\s*(?:,\s*([\s\S]*?))?\)\s*(?:->\s*([^:]+))?\s*:/g
  let m, best = null
  while ((m = defRe.exec(src)) !== null) {
    const name = m[1]
    if (name.startsWith('__')) continue
    const paramsRaw = (m[2] || '').trim()
    const retType = (m[3] || 'Any').trim()
    const params = parsePythonParams(paramsRaw)
    if (!params) continue
    best = { retType, name, params }
    break
  }
  return best
}

function parsePythonParams(raw) {
  if (!raw) return []
  const parts = splitTopLevelCommas(raw)
  const out = []
  for (const p of parts) {
    if (!p) continue
    // name: type   OR just name (untyped — treat as 'Any')
    const colon = firstTopLevelColon(p)
    if (colon < 0) {
      out.push({ name: p.trim(), type: 'Any' })
    } else {
      const name = p.slice(0, colon).trim()
      let type = p.slice(colon + 1).trim()
      // Default value? strip it.
      const eq = firstTopLevelChar(type, '=')
      if (eq >= 0) type = type.slice(0, eq).trim()
      if (!name) return null
      out.push({ name, type })
    }
  }
  return out
}

function splitTopLevelCommas(raw) {
  const parts = []
  let depth = 0, start = 0
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === '[' || c === '(' || c === '{') depth++
    else if (c === ']' || c === ')' || c === '}') depth--
    else if (c === ',' && depth === 0) { parts.push(raw.slice(start, i).trim()); start = i + 1 }
  }
  parts.push(raw.slice(start).trim())
  return parts
}

function firstTopLevelColon(s) { return firstTopLevelChar(s, ':') }
function firstTopLevelChar(s, ch) {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '[' || c === '(' || c === '{') depth++
    else if (c === ']' || c === ')' || c === '}') depth--
    else if (c === ch && depth === 0) return i
  }
  return -1
}
