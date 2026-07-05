import React, { useEffect, useState, useRef } from 'react'
import { Files, Search, GitBranch, Blocks, Settings, Database, Box, Anchor, FolderHeart, Send, Bug, User, ChevronRight, PlayCircle } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export function ActivityBar({ projectRoot, onShowVisualizer, onShowDsaExplainer, onOpenFile }) {
  const { activePanel, setActivePanel, extensions } = useAppStore()
  const [gitCount, setGitCount] = useState(0)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [showThemeSubmenu, setShowThemeSubmenu] = useState(false)
  const settingsMenuRef = useRef(null)

  useEffect(() => {
    if (!projectRoot) {
      setGitCount(0)
      return
    }
    
    let isSubscribed = true
    const checkGit = async () => {
      try {
        if (!window.api || !window.api.gitStatus) return
        const res = await window.api.gitStatus(projectRoot)
        if (isSubscribed && res && typeof res.status === 'string') {
          const count = res.status.trim().split('\n').filter(line => line.length > 0).length
          setGitCount(count)
        }
      } catch (err) {}
    }
    
    checkGit()
    const interval = setInterval(checkGit, 5000) // Poll every 5s
    return () => {
      isSubscribed = false
      clearInterval(interval)
    }
  }, [projectRoot])

  // Close settings menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target)) {
        setShowSettingsMenu(false)
        setShowThemeSubmenu(false)
      }
    }
    if (showSettingsMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSettingsMenu])

  const isDebuggerEnabled = extensions.find(e => e.id === 'ext-dbg-chrome')?.enabled
  const isDockerEnabled = extensions.find(e => e.id === 'ext-prod-docker')?.enabled
  const isK8sEnabled = extensions.find(e => e.id === 'ext-prod-k8s')?.enabled
  const isProjMgrEnabled = extensions.find(e => e.id === 'ext-prod-projmgr')?.enabled
  const isPostmanEnabled = extensions.find(e => e.id === 'ext-prod-postman')?.enabled

  const panels = [
    { id: 'explorer', icon: Files, title: 'Explorer' },
    { id: 'search', icon: Search, title: 'Search' },
    { id: 'git', icon: GitBranch, title: 'Source Control' },
    ...(isDebuggerEnabled ? [{ id: 'debug', icon: Bug, title: 'Run and Debug' }] : []),
    ...(isProjMgrEnabled ? [{ id: 'projects', icon: FolderHeart, title: 'Project Manager' }] : []),
    ...(isDockerEnabled ? [{ id: 'docker', icon: Box, title: 'Docker' }] : []),
    ...(isK8sEnabled ? [{ id: 'k8s', icon: Anchor, title: 'Kubernetes' }] : []),
    { id: 'extensions', icon: Blocks, title: 'Extensions' }
  ]

  const handleSettingsAction = (action) => {
    setShowSettingsMenu(false)
    setShowThemeSubmenu(false)
    action()
  }

  const settingsMenuItems = [
    { label: 'Settings', shortcut: 'Ctrl+,', action: () => onOpenFile('settings:main', 'Settings') },
    { label: 'Extensions', shortcut: 'Ctrl+Shift+X', action: () => setActivePanel('extensions') },
    { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+K Ctrl+S', action: () => onOpenFile('settings:shortcuts', 'Keyboard Shortcuts') },
    { type: 'separator' },
    { label: 'Check for Updates...', action: () => window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: 'comπle is up to date.', type: 'success' } })) }
  ]

  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        {panels.map((panel) => {
          const Icon = panel.icon
          const isActive = activePanel === panel.id

          return (
            <div
              key={panel.id}
              className={`activity-item ${isActive ? 'active' : ''}`}
              title={panel.title}
              onClick={() => setActivePanel(isActive ? null : panel.id)}
            >
              <Icon size={24} strokeWidth={isActive ? 2 : 1.5} />
              {panel.id === 'git' && gitCount > 0 && (
                <div className="activity-badge">{gitCount > 99 ? '99+' : gitCount}</div>
              )}
            </div>
          )
        })}
        {isPostmanEnabled && (
          <div
            className="activity-item"
            title="Postman"
            onClick={() => onOpenFile && onOpenFile('postman:main', 'Postman')}
          >
            <Send size={24} strokeWidth={1.5} />
          </div>
        )}
        <div
          className="activity-item"
          title="Visualize Codebase"
          onClick={() => onShowVisualizer && onShowVisualizer()}
        >
          <Database size={24} strokeWidth={1.5} />
        </div>
        <div
          className="activity-item"
          title="DSA Explainer"
          onClick={() => onShowDsaExplainer && onShowDsaExplainer()}
        >
          <PlayCircle size={24} strokeWidth={1.5} />
        </div>
      </div>
      
      <div className="activity-bar-bottom">
        <div 
          className={`activity-item ${activePanel === 'auth' ? 'active' : ''}`}
          title="Account"
          onClick={() => setActivePanel('auth')}
        >
          <User size={24} strokeWidth={1.5} />
        </div>
        <div style={{ position: 'relative' }} ref={settingsMenuRef}>
          <div 
            className={`activity-item ${showSettingsMenu ? 'active' : ''}`}
            title="Manage"
            onClick={() => { setShowSettingsMenu(!showSettingsMenu); setShowThemeSubmenu(false) }}
          >
            <Settings size={24} strokeWidth={showSettingsMenu ? 2 : 1.5} />
          </div>
          {showSettingsMenu && (
            <div style={{
              position: 'absolute',
              bottom: '0',
              left: '52px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-base)',
              borderRadius: '6px',
              padding: '6px 0',
              minWidth: '280px',
              zIndex: 9999,
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              display: 'flex',
              flexDirection: 'column',
              whiteSpace: 'nowrap'
            }}>
              {settingsMenuItems.map((item, idx) => (
                item.type === 'separator' ? (
                  <div key={idx} style={{ height: '1px', background: 'var(--border-base)', margin: '4px 0' }} />
                ) : (
                  <div
                    key={idx}
                    className="submenu-item"
                    style={{ position: 'relative' }}
                    onMouseEnter={() => { if (item.hasSubmenu) setShowThemeSubmenu(true); else setShowThemeSubmenu(false) }}
                    onClick={() => {
                      if (!item.hasSubmenu && item.action) {
                        handleSettingsAction(item.action)
                      } else if (!item.hasSubmenu && !item.action) {
                        setShowSettingsMenu(false)
                        window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: `${item.label} is not yet implemented.`, type: 'info' } }))
                      }
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span style={{ opacity: 0.5, fontSize: '11px', letterSpacing: '0.2px', marginLeft: 'auto' }}>{item.shortcut}</span>}
                    {item.hasSubmenu && <ChevronRight size={14} style={{ opacity: 0.6, marginLeft: 'auto' }} />}
                    {item.hasSubmenu && showThemeSubmenu && (
                      <div style={{
                        position: 'absolute',
                        bottom: '-6px',
                        left: '100%',
                        marginLeft: '4px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-base)',
                        borderRadius: '6px',
                        padding: '6px 0',
                        minWidth: '200px',
                        zIndex: 10000,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                        display: 'flex',
                        flexDirection: 'column'
                      }}>
                        {item.submenu.map((sub, subIdx) => (
                          <div
                            key={subIdx}
                            className="submenu-item"
                            onClick={(e) => { e.stopPropagation(); handleSettingsAction(sub.action) }}
                          >
                            <span>{sub.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
