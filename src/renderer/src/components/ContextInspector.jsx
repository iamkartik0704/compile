import React, { useState, useEffect } from 'react'
import { X, Sparkles, Code2, Database } from 'lucide-react'
import { skeletonizeCode } from '../utils/astParser'

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

  useEffect(() => {
    if (isOpen && originalCode) {
      const process = async () => {
        setIsProcessing(true)
        setErrorMsg(null)
        const lang = getLanguageFromPath(filePath)

        if (!lang) {
          setSkeletonCode(originalCode)
          setErrorMsg(null)
          setNotice(`AST compression is not supported for this file type. Showing the original content unchanged.`)
          setIsProcessing(false)
          return
        }

        const result = await skeletonizeCode(originalCode, lang)

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
        } else {
          setSkeletonCode(result.code || result)
          setNotice(null)
        }
        setIsProcessing(false)
      }
      process()
    }
  }, [isOpen, originalCode, filePath])

  if (!isOpen) return null

  // Calculate token savings (1 token ~= 4 chars roughly)
  const originalChars = originalCode ? originalCode.length : 0
  const skeletonChars = skeletonCode ? skeletonCode.length : 0
  const originalTokens = Math.round(originalChars / 4)
  const skeletonTokens = Math.round(skeletonChars / 4)
  const savedTokens = originalTokens - skeletonTokens
  const savedPercent = originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 100) : 0

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--bg-deep)',
      backdropFilter: 'blur(10px)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 30px', borderBottom: '1px solid var(--border-base)',
        background: 'var(--bg-activity)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--text-bright)', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={20} color="var(--accent-color)" />
            Passive Context Compressor
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            Preview how the AI sees your code before sending it to the API.
          </p>
        </div>
        <button onClick={onClose} style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border-base)', color: 'var(--text-primary)',
          width: '36px', height: '36px', borderRadius: '8px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <X size={18} />
        </button>
      </div>

      {/* Stats Bar */}
      <div style={{
        background: 'var(--bg-elevated)', padding: '16px 30px',
        borderBottom: '1px solid var(--border-base)',
        display: 'flex', gap: '40px'
      }}>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Original Tokens</div>
          <div style={{ color: 'var(--text-bright)', fontSize: '24px', fontWeight: '600' }}>{originalTokens.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Skeleton Tokens</div>
          <div style={{ color: 'var(--accent-color)', fontSize: '24px', fontWeight: '600' }}>{skeletonTokens.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Token Savings</div>
          <div style={{ color: '#10a37f', fontSize: '24px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {savedPercent}%
            <span style={{ fontSize: '14px', background: '#10a37f', color: '#fff', padding: '2px 8px', borderRadius: '12px' }}>
              -{savedTokens.toLocaleString()} tokens
            </span>
          </div>
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
          <pre style={{ margin: 0, padding: '20px', overflow: 'auto', flex: 1, color: 'var(--text-primary)', fontSize: '13px', lineHeight: '1.5', background: 'var(--bg-surface)' }}>
            {originalCode}
          </pre>
        </div>

        {/* Right: Skeleton */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)' }}>
          <div style={{ padding: '12px 20px', background: 'var(--bg-activity)', borderBottom: '1px solid var(--border-base)', color: 'var(--accent-color)', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={14} />
            AST Skeleton (Optimized)
          </div>
          {errorMsg && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid rgba(239, 68, 68, 0.2)', padding: '10px 20px', color: '#ef4444', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              ⚠️ Error: {errorMsg}
            </div>
          )}
          {notice && (
            <div style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-base)', padding: '10px 20px', color: 'var(--text-muted)', fontSize: '12px' }}>
              ℹ️ {notice}
            </div>
          )}
          <pre style={{ margin: 0, padding: '20px', overflow: 'auto', flex: 1, color: 'var(--text-primary)', fontSize: '13px', lineHeight: '1.5' }}>
            {isProcessing ? 'Processing AST...' : skeletonCode}
          </pre>
        </div>
      </div>
    </div>
  )
}
