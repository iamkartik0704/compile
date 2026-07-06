import React, { useState, useEffect } from 'react'

export function CppCompilerSettings() {
  const [compilers, setCompilers] = useState([])
  const [selectedCompiler, setSelectedCompiler] = useState('')
  const [manualOverride, setManualOverride] = useState('')
  const [loading, setLoading] = useState(true)

  const loadConfig = async () => {
    try {
      setLoading(true)
      if (window.api.getCppCompilers) {
        const { compilers, config } = await window.api.getCppCompilers()
        setCompilers(compilers || [])
        setSelectedCompiler(config?.selectedCompiler?.label || '')
        setManualOverride(config?.manualOverride || '')
      }
    } catch (e) {
      console.error('Failed to load compiler config', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  const handleSelectCompiler = async (label) => {
    setSelectedCompiler(label)
    setManualOverride('')
    const compilerObj = compilers.find(c => c.label === label)
    try {
      if (window.api.setCppCompiler) {
        await window.api.setCppCompiler({ 
          selectedCompiler: compilerObj,
          manualOverride: ''
        })
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleManualBlur = async () => {
    try {
      if (window.api.setCppCompiler) {
        await window.api.setCppCompiler({ 
          manualOverride
        })
      }
    } catch (e) {
      console.error(e)
    }
  }
  
  const handleManualKeyDown = async (e) => {
    if (e.key === 'Enter') {
      await handleManualBlur()
    }
  }

  if (loading) return <div className="settings-empty">Loading compiler information...</div>

  return (
    <div className="settings-group">
      <div className="settings-item">
        <div className="settings-item-header">
          <div className="settings-item-title">Auto-detected Compilers</div>
          <div className="settings-item-desc">Select a C/C++ compiler detected on your system.</div>
        </div>
        <div className="settings-item-control">
          {compilers.length === 0 ? (
            <div className="settings-empty" style={{ margin: 0, padding: '8px 0', color: 'var(--accent-purple)' }}>No compiler detected. Install one or enter path manually.</div>
          ) : (
            <div className="settings-select-wrapper">
              <select 
                className="settings-select" 
                value={selectedCompiler}
                onChange={(e) => handleSelectCompiler(e.target.value)}
                disabled={!!manualOverride}
              >
                <option value="" disabled>Select a compiler</option>
                {compilers.map(c => {
                  const displayName = c.label
                    .replace(/^gcc\/g\+\+ \((.*)\)$/, 'GCC/G++  —  $1')
                    .replace(/^clang \((.*)\)$/, 'Clang  —  $1');
                  return (
                    <option key={c.label} value={c.label}>{displayName}</option>
                  );
                })}
              </select>
              <svg className="settings-select-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          )}
        </div>
      </div>

      <div className="settings-item">
        <div className="settings-item-header">
          <div className="settings-item-title">Manual Override</div>
          <div className="settings-item-desc">Provide the absolute path to the 'bin' directory containing your compiler (e.g. C:\MinGW\bin). This overrides auto-detection.</div>
        </div>
        <div className="settings-item-control">
          <input 
            type="text" 
            className="settings-input" 
            placeholder="/usr/bin"
            value={manualOverride}
            onChange={(e) => setManualOverride(e.target.value)}
            onBlur={handleManualBlur}
            onKeyDown={handleManualKeyDown}
          />
        </div>
      </div>
      
      <div className="settings-item">
        <button className="settings-button" onClick={loadConfig}>Rescan System</button>
      </div>
    </div>
  )
}
