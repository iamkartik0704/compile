import React, { useState, useEffect } from 'react'
import { Search, ChevronRight, Settings2, SearchX } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import '../assets/settings.css'
import { AIAgentSettings } from './AIAgentSettings'
import { CppCompilerSettings } from './CppCompilerSettings'
import { AuthPanel } from './AuthPanel'
import { supabase } from '../lib/supabase'
import { collectLocalSettings, pullFromCloud, syncToCloud, mergeSettings, applySettingsLocally } from '../services/settingsSyncService'


const CATEGORIES = [
  { id: 'text-editor', label: 'Text Editor' },
  { id: 'workbench', label: 'Workbench' },
  { id: 'ai-agent', label: 'AI Agent' },
  { id: 'cpp', label: 'C/C++' }
]

export function SettingsEditor() {
  const { autoSave, setAutoSave, activeTheme, setActiveTheme } = useAppStore()
  const [activeCategory, setActiveCategory] = useState('text-editor')
  const [searchQuery, setSearchQuery] = useState('')
  const [showModifiedOnly, setShowModifiedOnly] = useState(false)
  const [activeTab, setActiveTab] = useState('user')
  const [syncStatus, setSyncStatus] = useState('idle') // idle, syncing, success, error
  const [showAuth, setShowAuth] = useState(false)
  const [syncConflict, setSyncConflict] = useState(null) // { local, remote }

  const handleSyncSettings = async () => {
    try {
      setSyncStatus('syncing')
      
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setSyncStatus('idle')
        setShowAuth(true)
        return
      }

      // 1. Collect local settings
      const localSettings = await collectLocalSettings()
      
      // 2. Fetch remote settings
      let remoteSettings = null
      try {
        remoteSettings = await pullFromCloud()
      } catch (err) {
        console.warn('Could not pull from cloud, will treat as empty', err)
      }

      // 3. Merge logic
      if (remoteSettings) {
        const { action, merged } = mergeSettings(localSettings, remoteSettings)
        if (action === 'prompt_conflict') {
          setSyncConflict({ local: localSettings, remote: remoteSettings })
          setSyncStatus('idle')
          return
        } else if (action === 'apply_remote') {
          applySettingsLocally(merged)
          setSyncStatus('success')
          setTimeout(() => setSyncStatus('idle'), 2000)
          return
        }
      }

      // 4. Push to cloud (if remote is older, missing, or just no conflict)
      await syncToCloud(localSettings)
      setSyncStatus('success')
      setTimeout(() => setSyncStatus('idle'), 2000)

    } catch (err) {
      console.error('Sync failed:', err)
      setSyncStatus('error')
    }
  }

  const resolveConflict = async (resolution) => {
    if (!syncConflict) return
    try {
      setSyncStatus('syncing')
      setSyncConflict(null)
      if (resolution === 'remote') {
        applySettingsLocally(syncConflict.remote)
        setSyncStatus('success')
      } else {
        await syncToCloud(syncConflict.local)
        setSyncStatus('success')
      }
      setTimeout(() => setSyncStatus('idle'), 2000)
    } catch (err) {
      console.error('Conflict resolution sync failed:', err)
      setSyncStatus('error')
    }
  }


  // Local settings state (persisted via localStorage)
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('editor-fontSize') || '14'))
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('editor-fontFamily') || "'JetBrains Mono', monospace")
  const [tabSize, setTabSize] = useState(() => parseInt(localStorage.getItem('editor-tabSize') || '2'))
  const [wordWrap, setWordWrap] = useState(() => localStorage.getItem('editor-wordWrap') || 'on')
  const [formatOnSave, setFormatOnSave] = useState(() => localStorage.getItem('editor-formatOnSave') === 'true')
  const [minimap, setMinimap] = useState(() => localStorage.getItem('editor-minimap') === 'true')
  const [inlineSuggest, setInlineSuggest] = useState(() => localStorage.getItem('editor-inlineSuggest') !== 'false')
  const [lineNumbers, setLineNumbers] = useState(() => localStorage.getItem('editor-lineNumbers') || 'on')
  const [cursorBlinking, setCursorBlinking] = useState(() => localStorage.getItem('editor-cursorBlinking') || 'blink')
  const [cursorStyle, setCursorStyle] = useState(() => localStorage.getItem('editor-cursorStyle') || 'line')
  const [bracketPairs, setBracketPairs] = useState(() => localStorage.getItem('editor-bracketPairs') !== 'false')
  const [smoothScrolling, setSmoothScrolling] = useState(() => localStorage.getItem('editor-smoothScrolling') === 'true')
  const [stickyScroll, setStickyScroll] = useState(() => localStorage.getItem('editor-stickyScroll') !== 'false')
  const [zoomLevel, setZoomLevel] = useState(() => parseFloat(localStorage.getItem('editor-zoomLevel') || '0'))
  const [renderWhitespace, setRenderWhitespace] = useState(() => localStorage.getItem('editor-renderWhitespace') || 'none')

  // Persist settings to localStorage and dispatch change events
  const updateSetting = (key, value, setter) => {
    setter(value)
    localStorage.setItem(key, String(value))
    window.dispatchEvent(new CustomEvent('settings-changed', { detail: { key, value } }))
  }

  const autoSaveOptions = [
    { value: 'off', label: 'Off' },
    { value: 'afterDelay', label: 'After Delay' },
    { value: 'onFocusChange', label: 'On Focus Change' },
    { value: 'onWindowChange', label: 'On Window Change' }
  ]

  const themeOptions = [
    { value: 'compile-dark', label: 'Compile Dark' },
    { value: 'dark-plus', label: 'Dark+' },
    { value: 'dracula', label: 'Dracula' },
    { value: 'light-modern', label: 'Light Modern' }
  ]

  const allSettings = {
    'text-editor': [
      {
        id: 'editor.fontSize',
        default: 14,
        title: 'Editor: Font Size',
        description: 'Controls the font size in pixels.',
        type: 'number',
        value: fontSize,
        onChange: (v) => updateSetting('editor-fontSize', parseInt(v) || 14, setFontSize)
      },
      {
        id: 'editor.fontFamily',
        default: "'JetBrains Mono', monospace",
        title: 'Editor: Font Family',
        description: 'Controls the font family used in the editor.',
        type: 'select',
        value: fontFamily,
        options: [
          { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono' },
          { value: "'Fira Code', monospace", label: 'Fira Code' },
          { value: "'Cascadia Code', monospace", label: 'Cascadia Code' },
          { value: "Consolas, monospace", label: 'Consolas' },
          { value: "'Source Code Pro', monospace", label: 'Source Code Pro' }
        ],
        onChange: (v) => updateSetting('editor-fontFamily', v, setFontFamily)
      },
      {
        id: 'editor.tabSize',
        default: 2,
        title: 'Editor: Tab Size',
        description: 'The number of spaces a tab is equal to.',
        type: 'number',
        value: tabSize,
        onChange: (v) => updateSetting('editor-tabSize', parseInt(v) || 2, setTabSize)
      },
      {
        id: 'editor.wordWrap',
        default: 'on',
        title: 'Editor: Word Wrap',
        description: 'Controls how lines should wrap.',
        type: 'select',
        value: wordWrap,
        options: [
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
          { value: 'wordWrapColumn', label: 'Word Wrap Column' },
          { value: 'bounded', label: 'Bounded' }
        ],
        onChange: (v) => updateSetting('editor-wordWrap', v, setWordWrap)
      },
      {
        id: 'editor.lineNumbers',
        title: 'Editor: Line Numbers',
        description: 'Controls the display of line numbers.',
        type: 'select',
        value: lineNumbers,
        options: [
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
          { value: 'relative', label: 'Relative' },
          { value: 'interval', label: 'Interval' }
        ],
        onChange: (v) => updateSetting('editor-lineNumbers', v, setLineNumbers)
      },
      {
        id: 'editor.cursorStyle',
        default: 'line',
        title: 'Editor: Cursor Style',
        description: 'Controls the cursor style.',
        type: 'select',
        value: cursorStyle,
        options: [
          { value: 'line', label: 'Line' },
          { value: 'block', label: 'Block' },
          { value: 'underline', label: 'Underline' },
          { value: 'line-thin', label: 'Line Thin' },
          { value: 'block-outline', label: 'Block Outline' },
          { value: 'underline-thin', label: 'Underline Thin' }
        ],
        onChange: (v) => updateSetting('editor-cursorStyle', v, setCursorStyle)
      },
      {
        id: 'editor.cursorBlinking',
        default: 'blink',
        title: 'Editor: Cursor Blinking',
        description: 'Controls the cursor animation style.',
        type: 'select',
        value: cursorBlinking,
        options: [
          { value: 'blink', label: 'Blink' },
          { value: 'smooth', label: 'Smooth' },
          { value: 'phase', label: 'Phase' },
          { value: 'expand', label: 'Expand' },
          { value: 'solid', label: 'Solid' }
        ],
        onChange: (v) => updateSetting('editor-cursorBlinking', v, setCursorBlinking)
      },
      {
        id: 'editor.renderWhitespace',
        default: 'none',
        title: 'Editor: Render Whitespace',
        description: 'Controls how whitespace is rendered in the editor.',
        type: 'select',
        value: renderWhitespace,
        options: [
          { value: 'none', label: 'None' },
          { value: 'boundary', label: 'Boundary' },
          { value: 'selection', label: 'Selection' },
          { value: 'trailing', label: 'Trailing' },
          { value: 'all', label: 'All' }
        ],
        onChange: (v) => updateSetting('editor-renderWhitespace', v, setRenderWhitespace)
      },
      {
        id: 'editor.minimap',
        default: true,
        title: 'Editor: Minimap Enabled',
        description: 'Controls whether the minimap is shown.',
        type: 'toggle',
        value: minimap,
        onChange: (v) => updateSetting('editor-minimap', v, setMinimap)
      },
      {
        id: 'editor.formatOnSave',
        default: false,
        title: 'Editor: Format On Save',
        description: 'Format a file on save. A formatter must be available.',
        type: 'toggle',
        value: formatOnSave,
        onChange: (v) => updateSetting('editor-formatOnSave', v, setFormatOnSave)
      },
      {
        id: 'editor.bracketPairs',
        title: 'Editor: Bracket Pair Colorization',
        description: 'Controls whether bracket pair colorization is enabled.',
        type: 'toggle',
        value: bracketPairs,
        onChange: (v) => updateSetting('editor-bracketPairs', v, setBracketPairs)
      },
      {
        id: 'editor.smoothScrolling',
        title: 'Editor: Smooth Scrolling',
        description: 'Controls whether the editor will scroll using an animation.',
        type: 'toggle',
        value: smoothScrolling,
        onChange: (v) => updateSetting('editor-smoothScrolling', v, setSmoothScrolling)
      },
      {
        id: 'editor.stickyScroll',
        title: 'Editor: Sticky Scroll',
        description: 'Shows nested current scopes during scrolling at the top of the editor.',
        type: 'toggle',
        value: stickyScroll,
        onChange: (v) => updateSetting('editor-stickyScroll', v, setStickyScroll)
      },
      {
        id: 'editor.zoomLevel',
        type: 'range',
        title: 'Editor: Zoom Level',
        description: 'Adjust the zoom level of the editor.',
        min: -3,
        max: 5,
        step: 0.5,
        value: zoomLevel,
        onChange: (v) => updateSetting('editor-zoomLevel', parseFloat(v), setZoomLevel)
      },
      {
        id: 'files.autoSave',
        type: 'select',
        title: 'Files: Auto Save',
        description: 'Controls auto save of editors that have unsaved changes.',
        default: 'afterDelay',
        value: autoSave ? 'afterDelay' : 'off',
        options: autoSaveOptions,
        onChange: (v) => { setAutoSave(v !== 'off'); updateSetting('files-autoSave', v, () => {}) }
      }
    ],
    'workbench': [
      {
        id: 'workbench.colorTheme',
        title: 'Workbench: Color Theme',
        description: 'Specifies the color theme used in the workbench.',
        type: 'select',
        value: activeTheme,
        options: themeOptions,
        onChange: (v) => setActiveTheme(v)
      }
    ],
    'features': [
      {
        id: 'ai.inlineSuggest',
        title: 'AI: Inline Suggestions (Pilot)',
        description: 'Controls whether AI-powered inline suggestions appear as ghost text while you type.',
        type: 'toggle',
        value: inlineSuggest,
        onChange: (v) => {
          updateSetting('editor-inlineSuggest', v, setInlineSuggest)
          window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: `AI Autocomplete is now ${v ? 'ON' : 'OFF'}`, type: 'info' } }))
        }
      }
    ],
    'extensions': []
  }


  useEffect(() => {
    const handleOpenSettings = (e) => {
      if (e.detail) {
        setActiveCategory(e.detail)
        setSearchQuery('')
      }
    }
    window.addEventListener('open-settings', handleOpenSettings)
    return () => window.removeEventListener('open-settings', handleOpenSettings)
  }, [])

  // Listen for external settings changes (from keyboard shortcuts, footer toggle, etc.)
  useEffect(() => {
    const handleExternal = (e) => {
      if (e.detail.key === 'editor-inlineSuggest') setInlineSuggest(e.detail.value)
      if (e.detail.key === 'editor-fontSize') setFontSize(parseInt(e.detail.value) || 14)
      if (e.detail.key === 'editor-minimap') setMinimap(e.detail.value === true || e.detail.value === 'true')
    }
    window.addEventListener('settings-changed', handleExternal)
    return () => window.removeEventListener('settings-changed', handleExternal)
  }, [])

  // Filter settings based on search query and modified flag
  const getFilteredSettings = () => {
    let settingsToFilter = allSettings[activeCategory] || []
    
    // If searching, search across all categories
    if (searchQuery.trim()) {
      settingsToFilter = []
      Object.values(allSettings).forEach(cats => {
        settingsToFilter.push(...cats)
      })
    }
    
    const q = searchQuery.toLowerCase()
    const results = []
    
    settingsToFilter.forEach(s => {
      // Check modified
      if (showModifiedOnly && s.value === s.default) return
      
      // Check search
      if (q) {
        if (!s.title.toLowerCase().includes(q) && 
            !s.description.toLowerCase().includes(q) && 
            !s.id.toLowerCase().includes(q)) {
          return
        }
      }
      
      if (!results.find(r => r.id === s.id)) results.push(s)
    })
    
    return results
  }

  const filteredSettings = getFilteredSettings()
  const activeCategoryLabel = searchQuery.trim()
    ? `Search Results (${filteredSettings.length})`
    : CATEGORIES.find(c => c.id === activeCategory)?.label || ''

  const renderSetting = (setting, index) => (
    <div key={setting.id} className="settings-item" style={{ animationDelay: `${index * 0.04}s` }}>
      <div className="settings-item-title">{setting.title}</div>

      {setting.type === 'toggle' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label className="settings-toggle-label">
            <input
              type="checkbox"
              className="settings-toggle-input"
              checked={setting.value}
              onChange={(e) => setting.onChange(e.target.checked)}
            />
            <div className="settings-toggle-switch" />
            <span className="settings-item-desc" style={{ margin: 0 }}>{setting.description}</span>
          </label>
        </div>
      ) : (
        <>
          <div className="settings-item-desc">{setting.description}</div>
          {setting.type === 'number' && (
            <input
              type="number"
              className="settings-input"
              value={setting.value}
              onChange={(e) => setting.onChange(e.target.value)}
              style={{ width: '180px' }}
            />
          )}
          {setting.type === 'text' && (
            <input
              type="text"
              className="settings-input"
              value={setting.value}
              onChange={(e) => setting.onChange(e.target.value)}
            />
          )}
          {setting.type === 'select' && (
            <div className="settings-select-wrapper">
              <select
                className="settings-select"
                value={setting.value}
                onChange={(e) => setting.onChange(e.target.value)}
              >
                {setting.options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="settings-select-arrow">
                <ChevronRight size={14} />
              </div>
            </div>
          )}
          {setting.type === 'range' && (
            <div className="settings-range-wrapper">
              <input
                type="range"
                className="settings-range"
                min={setting.min}
                max={setting.max}
                step={setting.step}
                value={setting.value}
                onChange={(e) => setting.onChange(e.target.value)}
              />
              <span className="settings-range-value">{setting.value > 0 ? `+${setting.value}` : setting.value}</span>
            </div>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="settings-container">
      {/* Top Search Bar */}
      <div className="settings-topbar">
        <div className="settings-search-wrapper">
          <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            className="settings-search-input"
            placeholder="Search settings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="settings-search-icons">
            <div 
              className="settings-search-icon" 
              title="Show modified settings"
              style={{ color: showModifiedOnly ? 'var(--accent-purple)' : undefined }}
              onClick={() => setShowModifiedOnly(!showModifiedOnly)}
            >
              <Settings2 size={15} />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs and Action Button */}
      <div className="settings-tabs-header">
        <div className="settings-tabs">
          <div
            className={`settings-tab ${activeTab === 'user' ? 'active' : ''}`}
            onClick={() => setActiveTab('user')}
          >
            User
          </div>
          <div
            className={`settings-tab ${activeTab === 'workspace' ? 'active' : ''}`}
            onClick={() => setActiveTab('workspace')}
          >
            Workspace
          </div>
        </div>
        
        <button 
          className={`settings-sync-btn ${syncStatus}`}
          onClick={handleSyncSettings}
          disabled={syncStatus === 'syncing'}
        >
          {syncStatus === 'syncing' ? 'Syncing...' :
           syncStatus === 'success' ? 'Synced ✓' :
           syncStatus === 'error' ? 'Sync failed — retry' :
           'Backup and Sync Settings'}
        </button>

      </div>

      {/* Main Layout */}
      <div className="settings-layout">
        {/* Sidebar Categories */}
        <div className="settings-sidebar">
          {CATEGORIES.map(cat => (
            <div
              key={cat.id}
              className={`settings-category ${activeCategory === cat.id && !searchQuery ? 'active' : ''}`}
              onClick={() => { setActiveCategory(cat.id); setSearchQuery('') }}
            >
              {cat.label}
            </div>
          ))}
        </div>

        {/* Settings Content */}
        <div className="settings-content">
          <h2 className="settings-section-title">{activeCategoryLabel}</h2>

          {activeCategory === 'ai-agent' ? (
            <AIAgentSettings />
          ) : activeCategory === 'cpp' ? (
            <CppCompilerSettings />
          ) : filteredSettings.length === 0 ? (
            <div className="settings-empty">
              <SearchX size={18} />
              {searchQuery ? 'No settings found matching your search.' : 'No settings in this category yet.'}
            </div>
          ) : (
            filteredSettings.map((s, i) => renderSetting(s, i))
          )}
        </div>
      </div>

      {/* Auth Modal */}
      {showAuth && (
        <div className="settings-modal-overlay">
          <div className="settings-modal-content">
            <button className="settings-modal-close" onClick={() => setShowAuth(false)}>×</button>
            <AuthPanel />
          </div>
        </div>
      )}

      {/* Conflict Modal */}
      {syncConflict && (
        <div className="settings-modal-overlay">
          <div className="settings-modal-content conflict-modal">
            <h3>Sync Conflict</h3>
            <p>Your local settings were modified more recently than the cloud version.</p>
            <div className="conflict-actions">
              <button className="conflict-btn primary" onClick={() => resolveConflict('local')}>Overwrite Cloud</button>
              <button className="conflict-btn secondary" onClick={() => resolveConflict('remote')}>Keep Cloud Version</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
