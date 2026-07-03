import React, { useState, useEffect } from 'react'
import { Search, ChevronRight, Wand2, Filter, Settings2 } from 'lucide-react'
import { useAppStore } from '../store/appStore'

const CATEGORIES = [
  { id: 'text-editor', label: 'Text Editor' },
  { id: 'workbench', label: 'Workbench' }
]

export function SettingsEditor() {
  const { autoSave, setAutoSave, activeTheme, setActiveTheme } = useAppStore()
  const [activeCategory, setActiveCategory] = useState('text-editor')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('user') // 'user' or 'workspace'

  // Local settings state (persisted via localStorage)
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('editor-fontSize') || '14'))
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('editor-fontFamily') || "'JetBrains Mono', 'Fira Code', monospace")
  const [tabSize, setTabSize] = useState(() => parseInt(localStorage.getItem('editor-tabSize') || '2'))
  const [wordWrap, setWordWrap] = useState(() => localStorage.getItem('editor-wordWrap') || 'on')
  const [formatOnSave, setFormatOnSave] = useState(() => localStorage.getItem('editor-formatOnSave') === 'true')
  const [minimap, setMinimap] = useState(() => localStorage.getItem('editor-minimap') === 'true')

  // Persist settings to localStorage and dispatch change events
  const updateSetting = (key, value, setter) => {
    setter(value)
    localStorage.setItem(key, String(value))
    window.dispatchEvent(new CustomEvent('settings-changed', { detail: { key, value } }))
  }

  const autoSaveOptions = [
    { value: 'off', label: 'off' },
    { value: 'afterDelay', label: 'afterDelay' },
    { value: 'onFocusChange', label: 'onFocusChange' },
    { value: 'onWindowChange', label: 'onWindowChange' }
  ]

  const themeOptions = [
    { value: 'compile-dark', label: 'Compile Dark' },
    { value: 'dark-plus', label: 'Dark+' },
    { value: 'dracula', label: 'Dracula' },
    { value: 'light-modern', label: 'Light Modern' }
  ]

  // Settings definitions per category
  const allSettings = {
    'text-editor': [
      {
        id: 'editor.fontSize',
        title: 'Editor: Font Size',
        description: 'Controls the font size in pixels.',
        type: 'number',
        value: fontSize,
        onChange: (v) => updateSetting('editor-fontSize', parseInt(v) || 14, setFontSize)
      },
      {
        id: 'editor.fontFamily',
        title: 'Editor: Font Family',
        description: 'Controls the font family.',
        type: 'text',
        value: fontFamily,
        onChange: (v) => updateSetting('editor-fontFamily', v, setFontFamily)
      },
      {
        id: 'files.autoSave',
        title: 'Files: Auto Save',
        description: 'Controls auto save of editors that have unsaved changes.',
        type: 'select',
        value: autoSave ? 'afterDelay' : 'off',
        options: autoSaveOptions,
        onChange: (v) => { setAutoSave(v !== 'off'); updateSetting('files-autoSave', v, () => {}) }
      },
      {
        id: 'editor.tabSize',
        title: 'Editor: Tab Size',
        description: 'The number of spaces a tab is equal to.',
        type: 'number',
        value: tabSize,
        onChange: (v) => updateSetting('editor-tabSize', parseInt(v) || 2, setTabSize)
      },
      {
        id: 'editor.wordWrap',
        title: 'Editor: Word Wrap',
        description: 'Controls how lines should wrap.',
        type: 'select',
        value: wordWrap,
        options: [
          { value: 'off', label: 'off' },
          { value: 'on', label: 'on' },
          { value: 'wordWrapColumn', label: 'wordWrapColumn' },
          { value: 'bounded', label: 'bounded' }
        ],
        onChange: (v) => updateSetting('editor-wordWrap', v, setWordWrap)
      },
      {
        id: 'editor.minimap',
        title: 'Editor: Minimap Enabled',
        description: 'Controls whether the minimap is shown.',
        type: 'checkbox',
        value: minimap,
        onChange: (v) => updateSetting('editor-minimap', v, setMinimap)
      },
      {
        id: 'editor.formatOnSave',
        title: 'Editor: Format On Save',
        description: 'Format a file on save. A formatter must be available and the editor must not be shutting down.',
        type: 'checkbox',
        value: formatOnSave,
        onChange: (v) => updateSetting('editor-formatOnSave', v, setFormatOnSave)
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
  }

  // Filter settings based on search query
  const getFilteredSettings = () => {
    if (!searchQuery.trim()) {
      return allSettings[activeCategory] || []
    }
    const q = searchQuery.toLowerCase()
    const results = []
    Object.values(allSettings).forEach(settings => {
      settings.forEach(s => {
        if (s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) {
          if (!results.find(r => r.id === s.id)) results.push(s)
        }
      })
    })
    return results
  }

  const filteredSettings = getFilteredSettings()
  const activeCategoryLabel = searchQuery.trim()
    ? `Search Results (${filteredSettings.length})`
    : CATEGORIES.find(c => c.id === activeCategory)?.label || ''

  const renderSetting = (setting) => (
    <div key={setting.id} style={{ padding: '12px 0 24px 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '13px', color: 'var(--text-bright)', marginBottom: '4px' }}>
            {setting.title}
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
            {setting.type === 'checkbox' ? (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={setting.value}
                  onChange={(e) => setting.onChange(e.target.checked)}
                  style={{ 
                    marginTop: '2px', 
                    width: '16px', 
                    height: '16px', 
                    accentColor: 'var(--accent-color)',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-base)',
                    cursor: 'pointer' 
                  }}
                />
                <span>{setting.description}</span>
              </label>
            ) : (
              setting.description
            )}
          </div>
          {setting.type === 'number' && (
            <input
              type="number"
              value={setting.value}
              onChange={(e) => setting.onChange(e.target.value)}
              style={{
                width: '180px',
                padding: '6px 8px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-base)',
                borderRadius: '3px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)'
              }}
            />
          )}
          {setting.type === 'text' && (
            <input
              type="text"
              value={setting.value}
              onChange={(e) => setting.onChange(e.target.value)}
              style={{
                width: '280px',
                padding: '6px 8px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-base)',
                borderRadius: '3px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)'
              }}
            />
          )}
          {setting.type === 'select' && (
            <div style={{ position: 'relative', width: '280px' }}>
              <select
                value={setting.value}
                onChange={(e) => setting.onChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-base)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                  cursor: 'pointer',
                  appearance: 'none'
                }}
              >
                {setting.options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div style={{ 
                position: 'absolute', 
                right: '8px', 
                top: '50%', 
                transform: 'translateY(-50%)', 
                pointerEvents: 'none',
                color: 'var(--text-muted)'
              }}>
                <ChevronRight size={14} style={{ transform: 'rotate(90deg)' }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: 'var(--bg-deep)',
      display: 'flex',
      flexDirection: 'column',
      color: 'var(--text-primary)',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Top Search Bar */}
      <div style={{ padding: '12px 16px', paddingBottom: '0' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'var(--bg-input)',
          border: '1px solid var(--border-base)',
          borderRadius: '3px',
          padding: '4px 8px',
          width: '100%',
          maxWidth: '800px',
          height: '32px'
        }}>
          <input
            type="text"
            placeholder="Search settings"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none'
            }}
          />
          <div style={{ display: 'flex', gap: '10px', color: 'var(--text-muted)' }}>
            <Wand2 size={15} style={{ cursor: 'pointer' }} title="AI Settings Search" />
            <Settings2 size={15} style={{ cursor: 'pointer' }} title="Show modified settings" />
            <Filter size={15} style={{ cursor: 'pointer' }} title="Filter settings" />
          </div>
        </div>
      </div>

      {/* Tabs and Action Button */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-base)',
        maxWidth: '1200px'
      }}>
        <div style={{ display: 'flex', gap: '24px' }}>
          <div 
            onClick={() => setActiveTab('user')}
            style={{ 
              fontSize: '13px', 
              cursor: 'pointer',
              color: activeTab === 'user' ? 'var(--text-bright)' : 'var(--text-muted)',
              borderBottom: activeTab === 'user' ? '1px solid var(--text-bright)' : '1px solid transparent',
              paddingBottom: '4px'
            }}
          >
            User
          </div>
          <div 
            onClick={() => setActiveTab('workspace')}
            style={{ 
              fontSize: '13px', 
              cursor: 'pointer',
              color: activeTab === 'workspace' ? 'var(--text-bright)' : 'var(--text-muted)',
              borderBottom: activeTab === 'workspace' ? '1px solid var(--text-bright)' : '1px solid transparent',
              paddingBottom: '4px'
            }}
          >
            Workspace
          </div>
        </div>
        <button style={{
          background: 'var(--accent-color)',
          color: 'var(--text-bright)',
          border: 'none',
          padding: '4px 12px',
          fontSize: '12px',
          borderRadius: '3px',
          cursor: 'pointer'
        }}>
          Backup and Sync Settings
        </button>
      </div>

      {/* Main Layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', maxWidth: '1200px', width: '100%' }}>
        {/* Sidebar Categories */}
        <div style={{
          width: '240px',
          minWidth: '240px',
          overflowY: 'auto',
          padding: '12px 0 12px 16px',
        }}>
          {CATEGORIES.map(cat => (
            <div
              key={cat.id}
              onClick={() => { setActiveCategory(cat.id); setSearchQuery('') }}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '4px 0px 4px 0px',
                fontSize: '13px',
                cursor: 'pointer',
                color: activeCategory === cat.id && !searchQuery ? 'var(--text-bright)' : 'var(--text-muted)',
                fontWeight: activeCategory === cat.id && !searchQuery ? '600' : '400',
              }}
            >
              {cat.id !== 'text-editor' && cat.id !== 'workbench' && (
                <ChevronRight size={14} style={{ marginRight: '4px', opacity: 0.7 }} />
              )}
              <span style={{ 
                marginLeft: 0 
              }}>
                {cat.label}
              </span>
            </div>
          ))}
        </div>

        {/* Settings Content */}
        <div style={{ 
          flex: 1, 
          overflowY: 'auto', 
          padding: '12px 40px 40px 16px',
          borderLeft: '1px solid var(--border-base)' 
        }}>
          <h2 style={{
            fontSize: '22px',
            fontWeight: 600,
            color: 'var(--text-bright)',
            marginBottom: '24px',
            marginTop: '0'
          }}>
            {activeCategoryLabel}
          </h2>

          {filteredSettings.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {searchQuery ? 'No settings found matching your search.' : 'No settings in this category.'}
            </div>
          ) : (
            filteredSettings.map(renderSetting)
          )}
        </div>
      </div>
    </div>
  )
}
