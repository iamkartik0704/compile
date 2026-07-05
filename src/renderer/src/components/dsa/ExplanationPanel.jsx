import React, { useEffect, useRef } from 'react'

// Scrolls the paragraph matching the current step into view and
// highlights it. `steps` is a string[] parallel to trace.
export function ExplanationPanel({ steps, currentStep, loading }) {
  const containerRef = useRef(null)
  const activeRef = useRef(null)

  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentStep])

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={emptyTextStyle}>Generating explanation from trace…</div>
      </div>
    )
  }

  if (!steps || steps.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={emptyTextStyle}>No explanation yet. Run the code first.</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={containerStyle}>
      <div style={sectionTitleStyle}>Explanation</div>
      {steps.map((text, i) => {
        const isActive = i === currentStep
        return (
          <div
            key={i}
            ref={isActive ? activeRef : null}
            style={{
              padding: '10px 12px',
              marginBottom: '6px',
              borderRadius: '6px',
              background: isActive ? 'var(--bg-elevated)' : 'transparent',
              borderLeft: `3px solid ${isActive ? 'var(--accent-color)' : 'transparent'}`,
              color: isActive ? 'var(--text-bright)' : 'var(--text-muted)',
              fontSize: '13px',
              lineHeight: '1.55',
              transition: 'background 0.2s ease, color 0.2s ease'
            }}
          >
            <span style={{
              fontSize: '10px', fontWeight: 700, color: 'var(--accent-color)',
              marginRight: '8px', fontFamily: 'monospace'
            }}>#{i + 1}</span>
            {text}
          </div>
        )
      })}
    </div>
  )
}

const sectionTitleStyle = {
  fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px',
  color: 'var(--text-muted)', fontWeight: 700, marginBottom: '12px'
}

// Muted single-line empty state — matches the sidebar's "No files" style.
const emptyTextStyle = {
  color: 'var(--text-muted)', fontSize: '12px', padding: '4px 0'
}

const containerStyle = {
  height: '100%',
  width: '100%',
  overflow: 'auto',
  padding: '20px',
  background: 'var(--bg-surface)',
  borderTop: '1px solid var(--border-base)'
}
