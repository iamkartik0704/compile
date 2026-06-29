import React, { useState, useEffect } from 'react'
import { RefreshCw, Check, Plus, Minus, FileText, GitCommit } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export function SourceControlPanel({ projectRoot, width, onOpenFile }) {
  const [files, setFiles] = useState([])
  const [commitMessage, setCommitMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  const extensions = useAppStore(state => state.extensions)
  const isGitGraphEnabled = extensions.some(ext => ext.id === 'ext-git-graph' && ext.enabled)

  const fetchStatus = async () => {
    if (!projectRoot) return
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.gitStatus(projectRoot)
      if (res.error) {
        if (res.error === 'Not a git repository') {
           setError('Not a git repository. Run "git init" in your terminal.')
        } else {
           setError(res.error)
        }
        setFiles([])
      } else {
        const parsedFiles = res.status
          .split('\n')
          .filter(line => line.trim())
          .map(line => {
            const status = line.substring(0, 2)
            const file = line.substring(3).replace(/"/g, '') // remove quotes from file path if any
            return { status, file }
          })
        setFiles(parsedFiles)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [projectRoot])

  const handleAction = async (action, file) => {
    setLoading(true)
    await window.api.gitAction(projectRoot, action, file)
    await fetchStatus()
  }

  const handleCommit = async () => {
    if (!commitMessage.trim()) return
    setLoading(true)
    const res = await window.api.gitAction(projectRoot, 'commit', commitMessage)
    if (!res.error) {
      setCommitMessage('')
      await fetchStatus()
    } else {
      setError(res.error)
      setLoading(false)
    }
  }

  return (
    <aside className="sidebar" style={{ width: width ? `${width}px` : '260px' }}>
      <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>SOURCE CONTROL</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isGitGraphEnabled && (
            <button className="icon-btn" onClick={() => onOpenFile('git-graph://view', 'Git Graph', {})} title="View Git Graph">
              <GitCommit size={14} />
            </button>
          )}
          <button className="icon-btn" onClick={fetchStatus} title="Refresh" disabled={loading}>
            <RefreshCw size={14} />
          </button>
          <button className="icon-btn" onClick={() => handleAction('push')} title="Push" disabled={loading}>
            <Check size={14} />
          </button>
        </div>
      </div>

      <div className="sidebar-content" style={{ padding: '10px', display: 'flex', flexDirection: 'column', height: '100%' }}>
        {error ? (
          <div style={{ color: '#ef4444', fontSize: '12px', padding: '10px' }}>{error}</div>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <textarea
                value={commitMessage}
                onChange={e => setCommitMessage(e.target.value)}
                placeholder="Message (Enter to commit)"
                style={{
                  width: '100%',
                  minHeight: '60px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-base)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  padding: '8px',
                  fontSize: '12px',
                  resize: 'vertical'
                }}
              />
              <button
                onClick={handleCommit}
                disabled={loading || !commitMessage.trim() || files.length === 0}
                style={{
                  marginTop: '8px',
                  width: '100%',
                  padding: '6px',
                  background: 'var(--accent-color)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  opacity: (loading || !commitMessage.trim() || files.length === 0) ? 0.5 : 1
                }}
              >
                Commit
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '20px' }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.5px' }}>
                Changes ({files.length})
              </div>
              
              {files.map((f, i) => {
                const isStaged = f.status[0] !== ' ' && f.status[0] !== '?'
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      fontSize: '13px',
                      color: isStaged ? 'var(--text-primary)' : 'var(--text-muted)',
                      marginBottom: '2px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                      const absolutePath = [projectRoot, f.file].join('/').replace(/\\/g, '/').replace(/\/+/g, '/')
                      onOpenFile(absolutePath, f.file.split(/[\\/]/).pop(), { diff: true, relPath: f.file })
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                      <FileText size={14} color={isStaged ? '#4ade80' : 'var(--text-muted)'} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'bold' }}>{f.status.trim()}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {isStaged ? (
                        <Minus size={14} onClick={(e) => { e.stopPropagation(); handleAction('unstage', f.file) }} title="Unstage Changes" style={{ cursor: 'pointer', color: 'var(--text-muted)' }} />
                      ) : (
                        <Plus size={14} onClick={(e) => { e.stopPropagation(); handleAction('add', f.file) }} title="Stage Changes" style={{ cursor: 'pointer', color: 'var(--text-muted)' }} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
