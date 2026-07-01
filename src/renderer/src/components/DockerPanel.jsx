import React, { useState, useEffect, useCallback } from 'react'
import { Box, Play, Square, Trash2, RefreshCw, AlertTriangle, Download, Image, Layers, ExternalLink } from 'lucide-react'

// Safe JSON parse helper — never throws
function safeParseJsonLines(text) {
  if (!text || typeof text !== 'string') return []
  const results = []
  for (const line of text.trim().split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      results.push(JSON.parse(trimmed))
    } catch {
      // skip malformed lines
    }
  }
  return results
}

export function DockerPanel({ width }) {
  const [installed, setInstalled] = useState(null) // null = checking, true/false
  const [versionText, setVersionText] = useState('')
  const [tab, setTab] = useState('containers') // 'containers' | 'images'
  const [containers, setContainers] = useState([])
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(null) // id of container being acted on
  const [error, setError] = useState(null)

  // ── Pre-flight check ──
  useEffect(() => {
    (async () => {
      try {
        const result = await window.api.runCommand('docker --version')
        if (result.error || !result.stdout) {
          setInstalled(false)
        } else {
          setInstalled(true)
          setVersionText(result.stdout.trim())
          fetchContainers()
          fetchImages()
        }
      } catch {
        setInstalled(false)
      }
    })()
  }, [])

  // ── Fetch containers ──
  const fetchContainers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.runCommand('docker ps -a --format "{{json .}}"')
      if (result.error) {
        setError(result.error)
        setContainers([])
      } else {
        setContainers(safeParseJsonLines(result.stdout))
      }
    } catch (e) {
      setError(e.message)
      setContainers([])
    }
    setLoading(false)
  }, [])

  // ── Fetch images ──
  const fetchImages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.runCommand('docker images --format "{{json .}}"')
      if (result.error) {
        setError(result.error)
        setImages([])
      } else {
        setImages(safeParseJsonLines(result.stdout))
      }
    } catch (e) {
      setError(e.message)
      setImages([])
    }
    setLoading(false)
  }, [])

  const handleRefresh = () => {
    if (tab === 'containers') fetchContainers()
    else fetchImages()
  }

  // ── Container actions ──
  const containerAction = async (id, action) => {
    setActionLoading(id)
    try {
      await window.api.runCommand(`docker ${action} ${id}`)
    } catch {
      // silently fail individual actions
    }
    setActionLoading(null)
    fetchContainers()
  }

  // ── Image delete ──
  const deleteImage = async (id) => {
    setActionLoading(id)
    try {
      await window.api.runCommand(`docker rmi -f ${id}`)
    } catch {
      // silently fail
    }
    setActionLoading(null)
    fetchImages()
  }

  const statusColor = (status) => {
    if (!status) return 'var(--text-muted)'
    const s = status.toLowerCase()
    if (s.includes('up')) return '#10a37f'
    if (s.includes('exited')) return '#ef4444'
    if (s.includes('created')) return '#f59e0b'
    if (s.includes('paused')) return '#f59e0b'
    return 'var(--text-muted)'
  }

  const statusDot = (status) => (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: statusColor(status), marginRight: 6, flexShrink: 0
    }} />
  )

  // ── Fallback: Docker not installed ──
  if (installed === null) {
    return (
      <aside className="sidebar" style={{ width: width ? `${width}px` : '260px' }}>
        <div className="sidebar-header" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-base)' }}>
          <h2 style={{ fontSize: '12px', letterSpacing: '0.5px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Box size={14} /> DOCKER
          </h2>
        </div>
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Checking Docker installation...
        </div>
      </aside>
    )
  }

  if (installed === false) {
    return (
      <aside className="sidebar" style={{ width: width ? `${width}px` : '260px' }}>
        <div className="sidebar-header" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-base)' }}>
          <h2 style={{ fontSize: '12px', letterSpacing: '0.5px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Box size={14} /> DOCKER
          </h2>
        </div>
        <div style={{ padding: '30px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <AlertTriangle size={32} color="#ef4444" />
          </div>
          <div>
            <div style={{ fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: 6, fontSize: '14px' }}>Docker Not Found</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: 1.5 }}>
              Docker Desktop is not installed or not in your system PATH. Install it to manage containers and images from the IDE.
            </div>
          </div>
          <button
            onClick={() => window.api.openUrl('https://docs.docker.com/get-docker/')}
            style={{
              padding: '8px 16px', background: '#2496ed', color: '#fff', border: 'none',
              borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px',
              display: 'flex', alignItems: 'center', gap: '6px'
            }}
          >
            <Download size={14} /> Install Docker
            <ExternalLink size={12} />
          </button>
        </div>
      </aside>
    )
  }

  // ── Main dashboard ──
  return (
    <aside className="sidebar" style={{ width: width ? `${width}px` : '260px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="sidebar-header" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-base)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '12px', letterSpacing: '0.5px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Box size={14} /> DOCKER
        </h2>
        <button
          onClick={handleRefresh}
          title="Refresh"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex' }}
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Version info */}
      <div style={{ padding: '4px 16px', fontSize: '10px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-base)' }}>
        {versionText}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-base)' }}>
        {[
          { id: 'containers', label: 'Containers', icon: Layers },
          { id: 'images', label: 'Images', icon: Image }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); t.id === 'containers' ? fetchContainers() : fetchImages() }}
            style={{
              flex: 1, padding: '8px 0', background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent-color)' : '2px solid transparent',
              color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: '11px', fontWeight: tab === t.id ? 'bold' : 'normal',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
              transition: 'all 0.2s'
            }}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="sidebar-content custom-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {error && (
          <div style={{ padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: '#ef4444', fontSize: '11px', marginBottom: '8px' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: '12px' }}>
            Loading...
          </div>
        ) : tab === 'containers' ? (
          containers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>
              No containers found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {containers.map((c, i) => {
                const isRunning = c.Status && c.Status.toLowerCase().includes('up')
                return (
                  <div
                    key={c.ID || i}
                    style={{
                      padding: '8px 10px', borderRadius: '6px', background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-base)', fontSize: '12px',
                      transition: 'border-color 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', color: 'var(--text-primary)', overflow: 'hidden' }}>
                        {statusDot(c.Status)}
                        <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {c.Names || c.ID?.slice(0, 12)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                        {isRunning ? (
                          <button onClick={() => containerAction(c.ID, 'stop')} title="Stop"
                            disabled={actionLoading === c.ID}
                            style={actionBtnStyle('#ef4444')}>
                            <Square size={12} />
                          </button>
                        ) : (
                          <button onClick={() => containerAction(c.ID, 'start')} title="Start"
                            disabled={actionLoading === c.ID}
                            style={actionBtnStyle('#10a37f')}>
                            <Play size={12} />
                          </button>
                        )}
                        <button onClick={() => containerAction(c.ID, 'rm -f')} title="Remove"
                          disabled={actionLoading === c.ID}
                          style={actionBtnStyle('#ef4444')}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                      {c.Image} • {c.Status}
                    </div>
                    {c.Ports && <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '2px' }}>🔌 {c.Ports}</div>}
                  </div>
                )
              })}
            </div>
          )
        ) : (
          images.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>
              No images found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {images.map((img, i) => (
                <div
                  key={img.ID || i}
                  style={{
                    padding: '8px 10px', borderRadius: '6px', background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-base)', fontSize: '12px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                  }}
                >
                  <div style={{ overflow: 'hidden', flex: 1 }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {img.Repository || '<none>'}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                      {img.Tag || 'latest'} • {img.Size}
                    </div>
                  </div>
                  <button onClick={() => deleteImage(img.ID)} title="Delete Image"
                    disabled={actionLoading === img.ID}
                    style={actionBtnStyle('#ef4444')}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </aside>
  )
}

const actionBtnStyle = (color) => ({
  background: 'transparent', border: 'none', color, cursor: 'pointer',
  padding: '4px', display: 'flex', borderRadius: '4px',
  opacity: 0.7, transition: 'opacity 0.2s'
})
