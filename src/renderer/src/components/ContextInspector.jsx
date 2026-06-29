import React, { useState, useEffect } from 'react'
import { X, Sparkles, Code2, Database } from 'lucide-react'
import { skeletonizeCode } from '../utils/astParser'

function getLanguageFromPath(path) {
  if (!path) return 'javascript'
  const ext = path.split('.').pop().toLowerCase()
  if (['js'].includes(ext)) return 'javascript'
  if (['jsx', 'ts', 'tsx'].includes(ext)) return 'tsx'
  if (ext === 'py') return 'python'
  if (['cpp', 'cc'].includes(ext)) return 'cpp'
  if (ext === 'c') return 'c'
  if (ext === 'java') return 'java'
  if (ext === 'go') return 'go'
  if (ext === 'rs') return 'rust'
  return 'javascript'
}

export function ContextInspector({ isOpen, onClose, originalCode, filePath }) {
  const [skeletonCode, setSkeletonCode] = useState('')
  const [errorMsg, setErrorMsg] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    if (isOpen && originalCode) {
      const process = async () => {
        setIsProcessing(true)
        setErrorMsg(null)
        const lang = getLanguageFromPath(filePath)
        const result = await skeletonizeCode(originalCode, lang)
        
        if (typeof result === 'object' && result.error) {
          setErrorMsg(result.error)
          setSkeletonCode(result.code || originalCode)
        } else {
          setSkeletonCode(result.code || result)
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
      background: 'rgba(10, 10, 12, 0.95)',
      backdropFilter: 'blur(10px)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 30px', borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div>
          <h2 style={{ margin: 0, color: '#fff', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={20} color="#06b6d4" />
            Passive Context Compressor
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            Preview how the AI sees your code before sending it to the API.
          </p>
        </div>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.05)', border: 'none', color: '#fff',
          width: '36px', height: '36px', borderRadius: '8px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <X size={18} />
        </button>
      </div>

      {/* Stats Bar */}
      <div style={{
        background: 'rgba(6, 182, 212, 0.1)', padding: '16px 30px',
        borderBottom: '1px solid rgba(6, 182, 212, 0.2)',
        display: 'flex', gap: '40px'
      }}>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Original Tokens</div>
          <div style={{ color: '#fff', fontSize: '24px', fontWeight: '600' }}>{originalTokens.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Skeleton Tokens</div>
          <div style={{ color: '#06b6d4', fontSize: '24px', fontWeight: '600' }}>{skeletonTokens.toLocaleString()}</div>
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
        <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Code2 size={14} />
            Original Code (Heavy)
          </div>
          <pre style={{ margin: 0, padding: '20px', overflow: 'auto', flex: 1, color: '#e2e8f0', fontSize: '13px', lineHeight: '1.5' }}>
            {originalCode}
          </pre>
        </div>

        {/* Right: Skeleton */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'rgba(6, 182, 212, 0.02)' }}>
          <div style={{ padding: '12px 20px', background: 'rgba(6, 182, 212, 0.05)', borderBottom: '1px solid rgba(6, 182, 212, 0.1)', color: '#06b6d4', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={14} />
            AST Skeleton (Optimized)
          </div>
          {errorMsg && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid rgba(239, 68, 68, 0.2)', padding: '10px 20px', color: '#ef4444', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              ⚠️ Error: {errorMsg}
            </div>
          )}
          <pre style={{ margin: 0, padding: '20px', overflow: 'auto', flex: 1, color: '#e2e8f0', fontSize: '13px', lineHeight: '1.5' }}>
            {isProcessing ? 'Processing AST...' : skeletonCode}
          </pre>
        </div>
      </div>
    </div>
  )
}
