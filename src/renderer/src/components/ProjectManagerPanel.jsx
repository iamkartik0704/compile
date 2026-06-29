import React, { useState, useEffect } from 'react'

export function ProjectManagerPanel({ width }) {
  const [recentProjects, setRecentProjects] = useState([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem('recent-projects')
      if (stored) {
        setRecentProjects(JSON.parse(stored))
      }
    } catch (e) {
      console.error(e)
    }
  }, [])

  return (
    <aside className="sidebar" style={{ width: width ? `${width}px` : '260px' }}>
      <div className="sidebar-header">
        <h2>PROJECTS</h2>
      </div>
      <div className="sidebar-content" style={{ padding: '10px' }}>
        {recentProjects.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No recent projects found.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {recentProjects.map((proj, i) => (
              <li 
                key={i}
                style={{
                  padding: '8px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  marginBottom: '4px',
                  background: 'var(--bg-elevated)',
                  fontSize: '13px'
                }}
              >
                <div style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{proj.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{proj.path}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
