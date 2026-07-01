import React, { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { Folder, FolderOpen, Trash2, Clock, FolderHeart } from 'lucide-react'

export function ProjectManagerPanel({ width, setProjectRoot, projectRoot }) {
  const [recentProjects, setRecentProjects] = useState([])
  const { setActivePanel } = useAppStore()

  useEffect(() => {
    loadProjects()
  }, [projectRoot])

  const loadProjects = () => {
    try {
      const stored = localStorage.getItem('recent-projects')
      if (stored) {
        setRecentProjects(JSON.parse(stored))
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleOpenProject = (path) => {
    setProjectRoot(path)
    setActivePanel('explorer')
  }

  const handleRemoveProject = (e, path) => {
    e.stopPropagation()
    const updated = recentProjects.filter(p => p.path !== path)
    setRecentProjects(updated)
    localStorage.setItem('recent-projects', JSON.stringify(updated))
  }

  const handleOpenNewFolder = async () => {
    const folderPath = await window.api.selectFolder()
    if (folderPath) {
      setProjectRoot(folderPath)
      setActivePanel('explorer')
    }
  }

  return (
    <aside className="sidebar" style={{ width: width ? `${width}px` : '260px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-header" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-base)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '12px', letterSpacing: '0.5px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <FolderHeart size={14} /> PROJECT MANAGER
        </h2>
      </div>
      
      <div className="sidebar-content custom-scroll" style={{ padding: '12px', flex: 1, overflowY: 'auto' }}>
        <button 
          onClick={handleOpenNewFolder}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: 'var(--accent-color)',
            color: 'var(--accent-text)',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            fontWeight: 'bold',
            marginBottom: '16px'
          }}
        >
          <FolderOpen size={16} />
          Open Project...
        </button>

        <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Clock size={12} /> Recent Projects
        </div>

        {recentProjects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>
            No recent projects found.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {recentProjects.map((proj, i) => (
              <li 
                key={i}
                onClick={() => handleOpenProject(proj.path)}
                style={{
                  padding: '8px 10px',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  background: proj.path === projectRoot ? 'var(--bg-elevated)' : 'transparent',
                  border: proj.path === projectRoot ? '1px solid var(--border-base)' : '1px solid transparent',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'background 0.2s, border 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-elevated)'
                }}
                onMouseLeave={(e) => {
                  if (proj.path !== projectRoot) e.currentTarget.style.background = 'transparent'
                }}
              >
                <div style={{ overflow: 'hidden', flex: 1 }}>
                  <div style={{ fontWeight: 'bold', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Folder size={14} color="var(--accent-color)" />
                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{proj.name}</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', marginTop: '2px', paddingLeft: '20px' }} title={proj.path}>
                    {proj.path}
                  </div>
                </div>
                <button 
                  onClick={(e) => handleRemoveProject(e, proj.path)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', opacity: 0.7 }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = 'var(--error-color)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.7; e.currentTarget.style.color = 'var(--text-muted)' }}
                  title="Remove from recents"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
