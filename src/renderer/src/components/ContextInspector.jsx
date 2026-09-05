import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, Sparkles, Code2, Database, DollarSign, ToggleLeft, ToggleRight } from 'lucide-react'
import { skeletonizeCode } from '../utils/astParser'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

function getLanguageFromPath(path) {
  if (!path) return 'javascript'
  const ext = path.split('.').pop().toLowerCase()
  if (['js', 'mjs', 'cjs'].includes(ext)) return 'javascript'
  if (['jsx', 'ts', 'tsx'].includes(ext)) return 'tsx'
  if (ext === 'py' || ext === 'pyw') return 'python'
  if (['cpp', 'cc', 'cxx', 'hpp', 'hxx', 'hh'].includes(ext)) return 'cpp'
  if (ext === 'c' || ext === 'h') return 'c'
  if (ext === 'java') return 'java'
  if (ext === 'go') return 'go'
  if (ext === 'rs') return 'rust'
  if (ext === 'cs') return 'csharp'
  if (ext === 'rb') return 'ruby'
  if (ext === 'php' || ext === 'phtml') return 'php'
  if (['sh', 'bash', 'zsh'].includes(ext)) return 'bash'
  if (ext === 'ps1' || ext === 'psm1') return 'powershell'
  if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css'
  return null
}

export function ContextInspector({ isOpen, onClose, originalCode, filePath }) {
  const [skeletonCode, setSkeletonCode] = useState('')
  const [errorMsg, setErrorMsg] = useState(null)
  const [notice, setNotice] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [lastOriginalCode, setLastOriginalCode] = useState(originalCode)

  const [options, setOptions] = useState({ skeletonizeFunctions: true, removeComments: false, removeWhitespace: false })

  useEffect(() => {
    let active = true;
    if (isOpen && originalCode) {
      const process = async () => {
        setIsProcessing(true)
        setErrorMsg(null)
        const lang = getLanguageFromPath(filePath)

        if (!lang) {
          if (active) {
            setSkeletonCode(originalCode)
            setErrorMsg(null)
            setNotice(`AST compression is not supported for this file type. Showing the original content unchanged.`)
            setIsProcessing(false)
            setLastOriginalCode(originalCode)
          }
          return
        }

        const result = await skeletonizeCode(originalCode, lang, options)
        if (!active) return

        if (typeof result === 'object' && result.error) {
          const isNoFuncs = /No skeletonizable function bodies found/i.test(result.error)
          if (isNoFuncs) {
            // Short file or no function-like constructs — not a real error; just no savings.
            setNotice('This file has no function bodies to compress. The AI will see it unchanged.')
            setErrorMsg(null)
          } else {
            setErrorMsg(result.error)
            setNotice(null)
          }
          setSkeletonCode(result.code || originalCode)
          setLastOriginalCode(originalCode)
        } else {
          setSkeletonCode(result.code || result)
          setNotice(null)
          setLastOriginalCode(originalCode)
        }
        setIsProcessing(false)
      }
      process()
    }
    return () => { active = false }
  }, [isOpen, originalCode, filePath, options])

  if (!isOpen) return null

  // Calculate token savings (1 token ~= 4 chars roughly)
  const originalChars = originalCode ? originalCode.length : 0
  const isStale = originalCode !== lastOriginalCode
  const skeletonChars = (isProcessing || isStale || !skeletonCode) ? originalChars : skeletonCode.length
  const originalTokens = Math.round(originalChars / 4)
  const skeletonTokens = Math.round(skeletonChars / 4)
  const savedTokens = originalTokens - skeletonTokens
  const savedPercent = originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 100) : 0
  const isNegative = savedTokens < 0
  const isZero = savedTokens === 0
  const costPerMillion = 3.00 // $3 per 1M tokens (average)
  const savedCost = (savedTokens / 1000000) * costPerMillion
  const fillPercentage = originalTokens > 0 ? (skeletonTokens / originalTokens) * 100 : 100

  const ToggleBtn = ({ label, prop }) => (
    <div 
      onClick={() => setOptions(p => ({ ...p, [prop]: !p[prop] }))}
      style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: options[prop] ? 'var(--accent-color)' : 'var(--text-muted)', fontSize: '13px', fontWeight: '500', transition: 'color 0.2s' }}
    >
      {options[prop] ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
      {label}
    </div>
  )

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--bg-deep)',
      backdropFilter: 'blur(10px)',
      zIndex: 9999, display: 'flex', flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 30px', borderBottom: '1px solid var(--border-base)',
        background: 'var(--bg-activity)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={20} color="var(--accent-color)" />
            Context Optimization Dashboard
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            Visually analyze and optimize token consumption before querying the AI.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', gap: '16px', background: 'var(--bg-elevated)', padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-base)' }}>
            <ToggleBtn label="Skeletonize Functions" prop="skeletonizeFunctions" />
            <ToggleBtn label="Strip Comments" prop="removeComments" />
            <ToggleBtn label="Strip Whitespace" prop="removeWhitespace" />
          </div>
          <button onClick={onClose} className="tab-action" style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border-base)', color: 'var(--text-primary)', cursor: 'pointer', padding: '6px', borderRadius: '4px'
          }}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Visual Stats Bar */}
      <div style={{
        background: 'var(--bg-surface)', padding: '24px 30px',
        borderBottom: '1px solid var(--border-base)',
        display: 'flex', flexDirection: 'column', gap: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: '40px' }}>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Original Tokens</div>
              <div style={{ color: 'var(--text-bright)', fontSize: '24px', fontWeight: '600' }}>{originalTokens.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Optimized Tokens</div>
              <div style={{ color: 'var(--accent-color)', fontSize: '24px', fontWeight: '600' }}>{skeletonTokens.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tokens Saved</div>
              <div style={{ color: isNegative ? '#ef4444' : (isZero ? 'var(--text-muted)' : '#10b981'), fontSize: '24px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {savedPercent > 0 ? `+${savedPercent}` : savedPercent}%
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '8px 16px', borderRadius: '8px', color: '#10b981' }}>
            <DollarSign size={20} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Est. Cost Saved</div>
                <div style={{ fontSize: '9px', background: 'rgba(16, 185, 129, 0.2)', padding: '2px 6px', borderRadius: '4px' }}>@ $3.00 / 1M Tokens</div>
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700 }}>${savedCost > 0 ? savedCost.toFixed(5) : '0.00000'}</div>
            </div>
          </div>
        </div>

        {/* Animated Progress Bar */}
        <div style={{ width: '100%', height: '12px', background: 'var(--bg-elevated)', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-base)', position: 'relative' }}>
          <motion.div 
            initial={{ width: '100%' }}
            animate={{ width: `${Math.min(100, Math.max(0, fillPercentage))}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            style={{ position: 'absolute', top: 0, left: 0, bottom: 0, background: 'var(--accent-color)' }}
          />
        </div>
      </div>

      {/* Split View */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: Original */}
        <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--border-base)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 20px', background: 'var(--bg-activity)', borderBottom: '1px solid var(--border-base)', color: 'var(--text-muted)', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Code2 size={14} />
            Original Code (Heavy)
          </div>
          <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg-surface)' }}>
            <SyntaxHighlighter
              language={getLanguageFromPath(filePath) || 'javascript'}
              style={vscDarkPlus}
              customStyle={{ margin: 0, padding: '20px', background: 'transparent', fontSize: '13px', lineHeight: '1.5' }}
            >
              {originalCode || ''}
            </SyntaxHighlighter>
          </div>
        </div>

        {/* Right: Skeleton */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)' }}>
          <div style={{ padding: '12px 20px', background: 'var(--bg-activity)', borderBottom: '1px solid var(--border-base)', color: 'var(--accent-color)', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={14} />
            AST Skeleton (Optimized)
          </div>
          {errorMsg && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid rgba(239, 68, 68, 0.2)', padding: '10px 20px', color: '#ef4444', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              Error: {errorMsg}
            </div>
          )}
          {notice && (
            <div style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-base)', padding: '10px 20px', color: 'var(--text-muted)', fontSize: '12px' }}>
              Notice: {notice}
            </div>
          )}
          <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg-surface)' }}>
            {isProcessing ? (
              <pre style={{ margin: 0, padding: '20px', color: 'var(--text-primary)', fontSize: '13px', lineHeight: '1.5' }}>
                Processing AST...
              </pre>
            ) : (
              <SyntaxHighlighter
                language={getLanguageFromPath(filePath) || 'javascript'}
                style={vscDarkPlus}
                customStyle={{ margin: 0, padding: '20px', background: 'transparent', fontSize: '13px', lineHeight: '1.5' }}
              >
                {skeletonCode || ''}
              </SyntaxHighlighter>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
