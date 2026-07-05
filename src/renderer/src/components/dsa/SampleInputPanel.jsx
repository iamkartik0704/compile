import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Resizer } from '../Resizer'

// ============================================================
// Sample-Input dock — same chrome as the integrated terminal
// panel (.bottom-panel + top-edge Resizer + collapsible header).
// Content is a multi-line monospace textarea instead of an xterm.
// ============================================================
export function SampleInputPanel({
  hint,
  assumedNote,
  isOpen,
  onToggle,
  height,
  onResize,
  collapsedPreview,
  children
}) {
  if (!isOpen) {
    // Collapsed handle — same treatment as a closed terminal tab.
    return (
      <div
        onClick={() => onToggle(true)}
        style={{
          background: 'var(--bg-activity)',
          borderTop: '1px solid var(--border-base)',
          padding: '6px 16px',
          display: 'flex', alignItems: 'center', gap: '8px',
          cursor: 'pointer',
          fontSize: '12px',
          color: 'var(--text-muted)',
          userSelect: 'none'
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
        title="Show Sample Input"
      >
        <ChevronUp size={13} />
        <span style={{ fontWeight: 500 }}>Sample Input</span>
        {collapsedPreview && (
          <span style={{ opacity: 0.7, fontFamily: 'monospace', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '400px' }}>
            {collapsedPreview}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      className="bottom-panel"
      style={{
        height,
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-deep)',
        borderTop: '1px solid var(--border-base)',
        position: 'relative',
        boxShadow: '0 -4px 15px rgba(0,0,0,0.1)'
      }}
    >
      {/* Top drag handle — identical structure to the terminal's resizer */}
      <div style={{ position: 'absolute', top: -3, left: 0, right: 0, zIndex: 10, display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', width: '100%', height: '100%' }}>
          <Resizer
            orientation="horizontal"
            onResize={(_, y) => {
              const next = Math.max(80, Math.min(window.innerHeight - y - 24, window.innerHeight - 200))
              onResize(next)
            }}
          />
        </div>
        <div style={{
          width: '40px', height: '4px',
          background: 'rgba(255,255,255,0.2)', borderRadius: '2px',
          marginTop: '-2px', pointerEvents: 'none', zIndex: 11
        }} />
      </div>

      {/* Header row — mirrors .bottom-tabs shape/height */}
      <div style={{
        display: 'flex',
        padding: '0 16px',
        background: 'var(--bg-activity)',
        borderBottom: '1px solid var(--border-base)',
        alignItems: 'center',
        height: '35px',
        gap: '12px'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          color: 'var(--text-primary)', fontSize: '12px', fontWeight: 500
        }}>
          <span>Sample Input</span>
        </div>
        {hint && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            · {hint}
          </span>
        )}
        {assumedNote && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            · {assumedNote}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => onToggle(false)}
          title="Hide Sample Input"
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--text-muted)', cursor: 'pointer',
            padding: '4px', borderRadius: '4px',
            display: 'flex', alignItems: 'center'
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Body — receives ArgFields (or the fallback textarea) from parent */}
      <div style={{ flex: 1, minHeight: 0, padding: '10px 16px', background: 'var(--bg-deep)', overflow: 'auto' }}>
        {children}
      </div>
    </div>
  )
}
