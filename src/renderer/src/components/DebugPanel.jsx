import { useState, useEffect } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Play,
  Square,
  RotateCcw,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Pause,
  Bug,
  Plus,
  Trash2,
  XCircle
} from 'lucide-react'
import { useAppStore } from '../store/appStore'

export default function DebugPanel({ activeFile }) {
  const { activeTheme, breakpoints: globalBreakpoints } = useAppStore()
  
  const pathToUri = (p) => {
    if (!p) return ''
    let formatted = p.replace(/\\/g, '/')
    if (!formatted.startsWith('/')) formatted = '/' + formatted
    // Lowercase the drive letter for Monaco compatibility (e.g. /C:/ -> /c:/)
    formatted = formatted.replace(/^\/([A-Z]):\//, (match, drive) => `/${drive.toLowerCase()}:/`)
    
    // Monaco encodes every segment of the path, including the drive colon (c: -> c%3A)
    const encoded = formatted.split('/').map(part => encodeURIComponent(part)).join('/')
    return `file://${encoded}`
  }
  
  // Breakpoints for the active file
  const activeUri = pathToUri(activeFile)
  const breakpoints = globalBreakpoints[activeUri] || []

  const getLanguageFromPath = (path) => {
    if (!path) return 'javascript'
    const ext = path.split('.').pop().toLowerCase()
    if (ext === 'py') return 'python'
    if (ext === 'cpp' || ext === 'c' || ext === 'cc' || ext === 'h') return 'cpp'
    return 'javascript'
  }
  const [activeSection, setActiveSection] = useState('variables')
  const [isDebugging, setIsDebugging] = useState(false)
  const [variables, setVariables] = useState([])
  const [callStack, setCallStack] = useState([])
  const [watchExpressions, setWatchExpressions] = useState([])
  const [watchResults, setWatchResults] = useState([])
  const [isAddingWatch, setIsAddingWatch] = useState(false)

  useEffect(() => {
    
    // Listen for DAP paused event
    if (window.api && window.api.onDapPaused) {
      window.api.onDapPaused(async (body) => {
        setIsDebugging(true)
        setActiveSection('variables') // Automatically expand the Variables panel!
        if (body.callFrames) {
          setCallStack(body.callFrames)
        } else {
          setCallStack([{ id: 1, name: 'Main Thread Paused', line: body.line }])
        }
        const vars = await window.api.dapGetVariables()
        if (vars) setVariables(vars)
        window.dispatchEvent(new CustomEvent('dap-paused-internal'))
      })
      window.api.onDapError((msg) => {
        window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: `Debug Error: ${msg}`, type: 'error' } }))
      })
      window.api.onDapExit && window.api.onDapExit(() => {
        setIsDebugging(false)
        setCallStack([])
        setVariables([])
        setWatchResults([])
      })
    }
    
    return () => {
      // cleaned up
    }
  }, [])

  useEffect(() => {
    const handlePausedInternal = async () => {
      const results = []
      for (const expr of watchExpressions) {
        const res = await window.api.dapEvaluate(expr)
        results.push({ expr, value: res })
      }
      setWatchResults(results)
    }
    window.addEventListener('dap-paused-internal', handlePausedInternal)
    return () => window.removeEventListener('dap-paused-internal', handlePausedInternal)
  }, [watchExpressions])

  const toggleSection = (section) => {
    setActiveSection(activeSection === section ? null : section)
  }

  const handleStartDebug = async () => {
    if (!activeFile) return
    setIsDebugging(true)
    setVariables([])
    setCallStack([])
    const lang = getLanguageFromPath ? getLanguageFromPath(activeFile) : 'javascript'
    console.log('[DEBUG_PANEL] Starting DAP. activeUri:', activeUri, 'breakpoints:', breakpoints)
    const res = await window.api.dapStart(activeFile, lang, breakpoints)
    if (!res.success) {
      setIsDebugging(false)
      window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: res.error, type: 'error' } }))
    }
  }

  useEffect(() => {
    window.addEventListener('start-debugging', handleStartDebug)
    return () => window.removeEventListener('start-debugging', handleStartDebug)
  }, [activeFile, breakpoints, isDebugging])

  const handleStop = async () => {
    await window.api.dapStop()
    setIsDebugging(false)
    setVariables([])
    setCallStack([])
    window.dispatchEvent(new Event('dap-stop'))
  }

  const handleStep = async () => {
    await window.api.dapStep()
  }

  const handleContinue = async () => {
    await window.api.dapContinue()
    window.dispatchEvent(new Event('dap-continue'))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: 'var(--text-primary)', background: 'var(--bg-sidebar)', userSelect: 'none' }}>
      {/* Header & Controls */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', borderBottom: '1px solid var(--border-base)' }}>
        <h2 style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-bright)' }}>RUN AND DEBUG</h2>
        
        {!isDebugging ? (
          <div 
            style={{
              width: '100%',
              padding: '8px 16px',
              background: 'var(--accent-color)',
              color: 'var(--accent-text)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'opacity 0.2s',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
            onClick={handleStartDebug}
          >
            <Play size={14} fill="currentColor" />
            Run and Debug
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', padding: '4px', background: 'var(--bg-elevated)', borderRadius: '4px', border: '1px solid var(--border-base)' }}>
            <button onClick={handleContinue} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px', borderRadius: '4px' }} title="Continue">
              <Play size={16} fill="currentColor" />
            </button>
            <button onClick={handleStep} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px', borderRadius: '4px' }} title="Step Over">
              <ArrowRight size={16} />
            </button>
            <button onClick={handleStop} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px', borderRadius: '4px' }} title="Restart">
              <RotateCcw size={16} />
            </button>
            <button onClick={handleStop} style={{ background: 'transparent', border: 'none', color: '#f48771', cursor: 'pointer', padding: '4px', borderRadius: '4px' }} title="Stop">
              <Square size={16} fill="currentColor" />
            </button>
          </div>
        )}
      </div>

      {/* Accordions */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        
        {/* Variables */}
        <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div 
            style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', background: 'var(--bg-surface)' }}
            onClick={() => toggleSection('variables')}
          >
            {activeSection === 'variables' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span style={{ fontSize: '11px', fontWeight: 600 }}>VARIABLES</span>
          </div>
          {activeSection === 'variables' && (
            <div style={{ padding: '8px 16px', fontSize: '13px' }}>
              {variables.length === 0 ? (
                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not paused</span>
              ) : (
                variables.map((v, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', padding: '2px 0' }}>
                    <span style={{ color: '#9cdcfe' }}>{v.name}:</span>
                    <span style={{ color: '#ce9178' }}>{v.value}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Watch */}
        <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div 
            style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: 'var(--bg-surface)' }}
            onClick={() => toggleSection('watch')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {activeSection === 'watch' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span style={{ fontSize: '11px', fontWeight: 600 }}>WATCH</span>
            </div>
            <Plus 
              size={14} 
              style={{ color: 'var(--text-muted)' }} 
              onClick={(e) => {
                e.stopPropagation()
                setActiveSection('watch')
                setIsAddingWatch(true)
              }}
            />
          </div>
          {activeSection === 'watch' && (
            <div style={{ padding: '8px 16px', fontSize: '13px' }}>
              {isAddingWatch && (
                <div style={{ padding: '2px 0', marginBottom: '4px' }}>
                  <input
                    autoFocus
                    style={{ background: 'var(--bg-editor)', color: 'var(--text-bright)', border: '1px solid var(--border-subtle)', padding: '2px 4px', width: '100%', fontSize: '12px' }}
                    placeholder="Expression to watch..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const expr = e.target.value.trim()
                        if (expr && !watchExpressions.includes(expr)) {
                          const newWatchList = [...watchExpressions, expr]
                          setWatchExpressions(newWatchList)
                          
                          if (isDebugging && window.api.dapEvaluate) {
                            window.api.dapEvaluate(expr).then(res => {
                              setWatchResults(prev => [...prev, { expr, value: res }])
                            })
                          } else {
                            setWatchResults(prev => [...prev, { expr, value: '...' }])
                          }
                        }
                        setIsAddingWatch(false)
                      } else if (e.key === 'Escape') {
                        setIsAddingWatch(false)
                      }
                    }}
                    onBlur={() => setIsAddingWatch(false)}
                  />
                </div>
              )}
              {watchExpressions.length === 0 && !isAddingWatch ? (
                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No expressions to watch</span>
              ) : (
                watchExpressions.map((expr, i) => {
                   const res = watchResults.find(r => r.expr === expr)
                   return (
                     <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                       <span style={{ color: '#9cdcfe' }}>{expr}:</span>
                       <span style={{ color: res ? '#ce9178' : 'var(--text-muted)' }}>{res ? res.value : '...'}</span>
                     </div>
                   )
                })
              )}
            </div>
          )}
        </div>

        {/* Call Stack */}
        <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div 
            style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', background: 'var(--bg-surface)' }}
            onClick={() => toggleSection('callstack')}
          >
            {activeSection === 'callstack' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span style={{ fontSize: '11px', fontWeight: 600 }}>CALL STACK</span>
          </div>
          {activeSection === 'callstack' && (
            <div style={{ padding: '8px 16px', fontSize: '13px' }}>
              {callStack.length === 0 ? (
                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not paused</span>
              ) : (
                callStack.map((f, i) => (
                  <div key={i} style={{ padding: '2px 0', color: 'var(--text-bright)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                     {f.name} {f.line ? `(line ${f.line})` : ''}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Breakpoints */}
        <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div 
            style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: 'var(--bg-surface)' }}
            onClick={() => toggleSection('breakpoints')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {activeSection === 'breakpoints' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span style={{ fontSize: '11px', fontWeight: 600 }}>BREAKPOINTS</span>
            </div>
            <Plus size={14} style={{ color: 'var(--text-muted)' }} />
          </div>
          {activeSection === 'breakpoints' && (
            <div style={{ padding: '8px 16px', fontSize: '13px' }}>
              {breakpoints.length === 0 ? (
                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No breakpoints</span>
              ) : (
                breakpoints.map((bp, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', padding: '2px 0', alignItems: 'center' }}>
                    <div style={{ width: '8px', height: '8px', background: '#ea5c00', borderRadius: '50%' }} />
                    <span>Line {bp}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
