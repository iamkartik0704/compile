import React, { useEffect, useRef } from 'react'
import { SkipBack, SkipForward, Play, Pause } from 'lucide-react'

// Compact icon-button cluster matching the Codebase Visualizer's
// zoom control cluster: 32×32 buttons, --bg-activity background,
// --border-base outline, hover flips to --bg-elevated + --accent-color.
export function PlaybackControls({
  currentStep,
  totalSteps,
  isPlaying,
  onSetStep,
  onPlayPause,
  disabled
}) {
  const timerRef = useRef(null)

  useEffect(() => {
    if (isPlaying && totalSteps > 0) {
      timerRef.current = setInterval(() => {
        onSetStep(prev => {
          if (prev >= totalSteps - 1) {
            onPlayPause(false)
            return prev
          }
          return prev + 1
        })
      }, 600)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isPlaying, totalSteps, onSetStep, onPlayPause])

  const canBack = !disabled && currentStep > 0
  const canFwd = !disabled && currentStep < totalSteps - 1
  const canPlay = !disabled && totalSteps > 0

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag'
    }}>
      <div style={clusterStyle}>
        <IconBtn onClick={() => onSetStep(Math.max(0, currentStep - 1))} disabled={!canBack} title="Step Back">
          <SkipBack size={14} />
        </IconBtn>
        <IconBtn onClick={() => onPlayPause(!isPlaying)} disabled={!canPlay} title={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </IconBtn>
        <IconBtn onClick={() => onSetStep(Math.min(totalSteps - 1, currentStep + 1))} disabled={!canFwd} title="Step Forward" last>
          <SkipForward size={14} />
        </IconBtn>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '200px' }}>
        <input
          type="range"
          min={0}
          max={Math.max(0, totalSteps - 1)}
          value={currentStep}
          onChange={(e) => onSetStep(parseInt(e.target.value, 10))}
          disabled={!canPlay}
          style={{ flex: 1, accentColor: 'var(--accent-color)' }}
        />
        <span style={{
          fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace',
          minWidth: '52px', textAlign: 'right'
        }}>
          {totalSteps > 0 ? `${currentStep + 1}/${totalSteps}` : '0/0'}
        </span>
      </div>
    </div>
  )
}

const clusterStyle = {
  display: 'flex',
  background: 'var(--bg-activity)',
  border: '1px solid var(--border-base)',
  borderRadius: '8px',
  overflow: 'hidden',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)'
}

function IconBtn({ children, onClick, disabled, title, last }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: 'var(--bg-activity)',
        border: 'none',
        borderRight: last ? 'none' : '1px solid var(--border-base)',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        width: '32px', height: '32px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s ease, color 0.15s ease'
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.background = 'var(--bg-elevated)'
        e.currentTarget.style.color = 'var(--accent-color)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-activity)'
        e.currentTarget.style.color = disabled ? 'var(--text-muted)' : 'var(--text-primary)'
      }}
    >
      {children}
    </button>
  )
}
