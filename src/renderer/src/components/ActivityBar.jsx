import React from 'react'
import { Files, Search, GitBranch, Blocks, Settings } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export function ActivityBar() {
  const { activePanel, setActivePanel } = useAppStore()

  const panels = [
    { id: 'explorer', icon: Files, title: 'Explorer' },
    { id: 'search', icon: Search, title: 'Search' },
    { id: 'git', icon: GitBranch, title: 'Source Control' },
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
              {panel.id === 'git' && (
                <div className="activity-badge">42</div>
              )}
            </div>
          )
        })}
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
