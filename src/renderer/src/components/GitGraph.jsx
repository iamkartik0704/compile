import React, { useState, useEffect } from 'react'

export function GitGraph({ projectRoot }) {
  const [logLines, setLogLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchLog = async () => {
      setLoading(true)
      try {
        const res = await window.api.gitAction(projectRoot, 'log')
        if (res.error) {
          setError(res.error)
        } else {
          setLogLines(res.stdout.split('\n').filter(Boolean))
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    fetchLog()
  }, [projectRoot])

  if (loading) {
    return (
      <div style={{ padding: '20px', color: 'var(--text-muted)' }}>
        Loading Git Graph...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '20px', color: '#ef4444' }}>
        Failed to load Git Graph: {error}
      </div>
    )
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      overflow: 'auto',
      backgroundColor: 'var(--bg-surface)',
      padding: '20px',
      color: 'var(--text-primary)',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: '13px',
      lineHeight: '1.6'
    }}>
      <h2 style={{ marginBottom: '20px', color: 'var(--text-bright)' }}>Git History</h2>
      
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {logLines.map((line, idx) => {
          // line could be just graph characters, or graph + ||| + commit info
          const parts = line.split('|||')
          if (parts.length >= 4) {
            // It has commit info!
            const graphAndHash = parts[0]
            // split graph characters and hash
            // usually hash is the last word
            const match = graphAndHash.match(/^(.*?)([0-9a-fA-F]{7,})$/)
            let graphChars = graphAndHash
            let hash = ''
            if (match) {
              graphChars = match[1]
              hash = match[2]
            }

            const author = parts[1]
            const time = parts[2]
            const message = parts[3]

            return (
              <div key={idx} style={{ display: 'flex', gap: '16px', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
                <div style={{ whiteSpace: 'pre', color: 'var(--accent-color)', flexShrink: 0 }}>
                  {graphChars}
                </div>
                {hash && (
                  <div style={{ color: '#60a5fa', fontWeight: 'bold', width: '60px', flexShrink: 0 }}>
                    {hash}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-bright)' }}>
                  {message}
                </div>
                <div style={{ color: 'var(--text-muted)', width: '120px', flexShrink: 0, textAlign: 'right' }}>
                  {time}
                </div>
                <div style={{ color: 'var(--text-secondary)', width: '120px', flexShrink: 0, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {author}
                </div>
              </div>
            )
          } else {
            // Just graph chars
            return (
              <div key={idx} style={{ display: 'flex', padding: '0 0' }}>
                <div style={{ whiteSpace: 'pre', color: 'var(--accent-color)' }}>
                  {line}
                </div>
              </div>
            )
          }
        })}
      </div>
    </div>
  )
}
