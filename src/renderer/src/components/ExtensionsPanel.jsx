import React, { useState } from 'react'
import { getExtensionsByCategory } from '../utils/extensionRegistry'
import { Search, Settings, Download, Blocks } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export function ExtensionsPanel({ width, onOpenExtension }) {
  const [searchQuery, setSearchQuery] = useState('')
  const { extensions, toggleExtension, setActiveTheme } = useAppStore()

  // We need to re-group using the current global extensions state
  const grouped = {}
  extensions.forEach(ext => {
    if (!grouped[ext.category]) grouped[ext.category] = []
    grouped[ext.category].push(ext)
  })

  const handleToggle = (id, category) => {
    const ext = extensions.find(e => e.id === id)
    if (!ext) return
    const newEnabled = !ext.enabled
    toggleExtension(id, category)
    
    // Theme side-effect
    if (category === 'theme' && newEnabled) {
      setActiveTheme(id.replace('theme-', ''))
    }
  }

  return (
    <aside className="sidebar extensions-panel" style={{ width: width ? `${width}px` : '260px' }}>
      <div className="sidebar-header">
        <h2>EXTENSIONS</h2>
      </div>

      <div className="extensions-search">
        <div className="search-input-wrapper">
          <Search size={14} className="search-icon" />
          <input 
            type="text" 
            placeholder="Search Extensions in Marketplace"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="sidebar-content extensions-list" style={{ padding: '0 10px', overflowY: 'auto' }}>
        {Object.entries(grouped).map(([category, exts]) => {
          const filtered = exts.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
          if (filtered.length === 0) return null
          
          return (
            <div key={category} className="extension-category">
              <h3 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '15px 0 10px', letterSpacing: '0.5px' }}>
                {category}
              </h3>
              
              {filtered.map(ext => (
                <div 
                  key={ext.id} 
                  className="extension-item" 
                  style={{ display: 'flex', gap: '10px', marginBottom: '15px', cursor: 'pointer', padding: '4px', borderRadius: '4px', transition: 'background 0.2s' }}
                  onClick={() => onOpenExtension && onOpenExtension(ext.id)}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div className="ext-icon" style={{ width: '40px', height: '40px', backgroundColor: 'var(--bg-elevated)', borderRadius: '6px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Blocks size={20} color="var(--text-muted)" />
                  </div>
                  
                  <div className="ext-details" style={{ flexGrow: 1, minWidth: 0 }}>
                    <div className="ext-name" style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ext.name}</div>
                    <div className="ext-author" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{ext.author}</div>
                    <div className="ext-desc" style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{ext.description}</div>
                    
                    <div className="ext-actions" style={{ marginTop: '8px' }}>
                      {ext.enabled ? (
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleToggle(ext.id, ext.category); }}
                          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-base)', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Settings size={12} /> Manage
                        </button>
                      ) : (
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleToggle(ext.id, ext.category); }}
                          style={{ background: '#0e639c', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Download size={12} /> Install
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
