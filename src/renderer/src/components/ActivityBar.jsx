import React, { useEffect, useState } from 'react'
import { Files, Search, GitBranch, Blocks, Settings, Database, Box, Anchor, FolderHeart, Send, Bug } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export function ActivityBar({ projectRoot, onShowVisualizer, onOpenFile }) {
  const { activePanel, setActivePanel, extensions } = useAppStore()
  const [gitCount, setGitCount] = useState(0)

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
      </div>
      
      <div className="activity-bar-bottom">
        <div 
          className={`activity-item ${activePanel === 'settings' ? 'active' : ''}`}
          title="Settings"
          onClick={() => setActivePanel('settings')}
        >
          <Settings size={24} strokeWidth={1.5} />
        </div>
      </div>
    </div>
  )
}
