import React, { useEffect, useRef } from 'react'
import { Clock, Database, Lightbulb, CheckCircle2 } from 'lucide-react'

// Scrolls the paragraph matching the current step into view and
// highlights it. `steps` is a string[] parallel to trace.
export function ExplanationPanel({ steps, currentStep, loading, runOutput, complexityData }) {
  const containerRef = useRef(null)
  const activeRef = useRef(null)
  const stepsRef = useRef(null)

  useEffect(() => {
    // Only scroll within the steps area, not the entire container
    if (activeRef.current && stepsRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentStep])

  if (loading) {
    return (
      <div style={outerStyle}>
        <div style={{ padding: '20px' }}>
          <div style={emptyTextStyle}>Generating explanation from trace…</div>
        </div>
      </div>
    )
  }

  if (!steps || steps.length === 0) {
    return (
      <div style={outerStyle}>
        <div style={{ padding: '20px' }}>
          <div style={emptyTextStyle}>No explanation yet. Run the code first.</div>
          {runOutput && (
            <div style={{ marginTop: '20px' }}>
              <div style={sectionTitleStyle}>Output</div>
              <pre style={outputPreStyle}>{runOutput}</pre>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={outerStyle}>
      {/* ── Fixed header area: Output + Complexity (non-scrollable) ── */}
      {(runOutput || complexityData) && (
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-base)',
          background: 'var(--bg-surface)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          {runOutput && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '6px 10px',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(59, 130, 246, 0.08))',
              borderRadius: '6px',
              border: '1px solid rgba(16, 185, 129, 0.25)'
            }}>
              <CheckCircle2 size={14} color="#10b981" style={{ flexShrink: 0 }} />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#10b981', fontWeight: 700, flexShrink: 0 }}>
                  Output
                </span>
                <pre style={{
                  margin: 0, padding: 0, background: 'transparent',
                  fontSize: '12px', color: 'var(--text-bright)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace', fontWeight: 600
                }}>
                  {runOutput}
                </pre>
              </div>
            </div>
          )}

          {complexityData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-elevated)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-base)', flex: 1 }}>
                  <Clock size={12} color="var(--accent-color)" />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Time</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'monospace', marginLeft: 'auto' }}>{complexityData.timeComplexity}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-elevated)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-base)', flex: 1 }}>
                  <Database size={12} color="var(--accent-color)" />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Space</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'monospace', marginLeft: 'auto' }}>{complexityData.spaceComplexity}</span>
                </div>
              </div>
              {complexityData.recommendation && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '6px', alignItems: 'flex-start', padding: '0 4px' }}>
                  <Lightbulb size={12} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span style={{ lineHeight: 1.4 }}>{complexityData.recommendation}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Scrollable explanation steps ── */}
      <div ref={containerRef} style={{
        flex: 1, overflow: 'auto', padding: '16px 20px'
      }}>
        <div style={sectionTitleStyle}>Explanation</div>
        <div ref={stepsRef}>
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
      </div>
    </div>
  )
}

const sectionTitleStyle = {
  fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px',
  color: 'var(--text-muted)', fontWeight: 700, marginBottom: '12px'
}

const emptyTextStyle = {
  color: 'var(--text-muted)', fontSize: '12px', padding: '4px 0'
}

const outputPreStyle = {
  margin: 0, padding: '10px 12px', background: 'var(--bg-elevated)',
  borderRadius: '6px', fontSize: '12px', color: 'var(--text-primary)',
  whiteSpace: 'pre-wrap', fontFamily: 'monospace'
}

const complexityBadgeStyle = {
  display: 'flex', alignItems: 'center', gap: '8px',
  background: 'var(--bg-elevated)', padding: '8px 12px',
  borderRadius: '6px', border: '1px solid var(--border-base)', flex: 1
}

const complexityLabelStyle = {
  fontSize: '10px', color: 'var(--text-muted)',
  textTransform: 'uppercase', fontWeight: 600
}

const complexityValueStyle = {
  fontSize: '13px', color: 'var(--text-primary)',
  fontWeight: 500, fontFamily: 'monospace'
}

// Outer container is a flexbox column — header stays fixed, steps scroll
const outerStyle = {
  height: '100%',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-surface)',
  borderTop: '1px solid var(--border-base)'
}
