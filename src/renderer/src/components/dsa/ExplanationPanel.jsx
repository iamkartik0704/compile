import React, { useEffect, useRef } from 'react'
import { Clock, Database, Lightbulb } from 'lucide-react'

// Scrolls the paragraph matching the current step into view and
// highlights it. `steps` is a string[] parallel to trace.
export function ExplanationPanel({ steps, currentStep, loading, runOutput, complexityData }) {
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
        {runOutput && (
          <div style={{ marginTop: '20px' }}>
            <div style={sectionTitleStyle}>Output</div>
            <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: '6px', fontSize: '12px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
              {runOutput}
            </pre>
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} style={containerStyle}>
      {runOutput && (
        <div style={{ marginBottom: '20px' }}>
          <div style={sectionTitleStyle}>Output</div>
          <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: '6px', fontSize: '12px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {runOutput}
          </pre>
        </div>
      )}

      {complexityData && (
        <div style={{ marginBottom: '20px' }}>
          <div style={sectionTitleStyle}>Complexity Analysis</div>
          <div style={{ display: 'flex', gap: '12px', marginBottom: complexityData.recommendation ? '12px' : '0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-elevated)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-base)', flex: 1 }}>
              <Clock size={16} color="var(--accent-color)" />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Time</span>
                <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'monospace' }}>{complexityData.timeComplexity}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-elevated)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-base)', flex: 1 }}>
              <Database size={16} color="var(--accent-color)" />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Space</span>
                <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'monospace' }}>{complexityData.spaceComplexity}</span>
              </div>
            </div>
          </div>
          {complexityData.recommendation && (
            <div style={{ display: 'flex', gap: '10px', background: 'rgba(16, 185, 129, 0.1)', padding: '12px', borderRadius: '6px', borderLeft: '3px solid #10b981' }}>
              <Lightbulb size={16} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '12.5px', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                <strong style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', color: '#10b981', marginBottom: '4px' }}>Optimization Tip</strong>
                {complexityData.recommendation}
              </div>
            </div>
          )}
        </div>
      )}

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
