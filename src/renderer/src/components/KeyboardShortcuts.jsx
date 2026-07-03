import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Keyboard, Search, Edit2, Check, X } from 'lucide-react'

import { useShortcutStore, normalizeEventToKeys } from '../store/shortcutStore'

export function KeyboardShortcuts() {
  const shortcuts = useShortcutStore(state => state.shortcuts)
  const updateShortcut = useShortcutStore(state => state.updateShortcut)
  const detectConflict = useShortcutStore(state => state.detectConflict)
  const setIsEditing = useShortcutStore(state => state.setIsEditing)

  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  
  const [recordedKeys, setRecordedKeys] = useState([])
  const recordedKeysRef = useRef([])

  const handleEditClick = (id, currentKeys) => {
    setEditingId(id)
    setRecordedKeys(currentKeys)
    recordedKeysRef.current = currentKeys
    setIsEditing(true)
  }

  const saveShortcut = useCallback(() => {
    if (editingId && recordedKeysRef.current.length > 0) {
      const keys = recordedKeysRef.current;
      
      const conflict = detectConflict(keys);
      if (conflict && conflict.id !== editingId) {
        const confirmMsg = `These keys are already bound to "${conflict.name}"${conflict.type === 'monaco' ? ' (Native)' : ''}. Do you want to overwrite it?`;
        if (!window.confirm(confirmMsg)) {
          return;
        }
        if (conflict.type === 'custom') {
          updateShortcut(conflict.id, []);
        }
      }
      
      updateShortcut(editingId, keys);
    }
    setEditingId(null)
    setIsEditing(false)
  }, [editingId, updateShortcut, detectConflict, setIsEditing])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setIsEditing(false)
  }, [setIsEditing])

  const lastKeyTimeRef = useRef(0)

  const handleKeyDown = useCallback((e) => {
    if (!editingId) return;
    
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape' && recordedKeysRef.current.length === 0) {
      cancelEdit();
      return;
    }

    // Ignore pure modifier presses (wait for the actual key)
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
      return;
    }

    const currentKeys = normalizeEventToKeys(e);

    const now = Date.now();
    // If pressed within 1000ms of the last key, and we already have recorded keys, it's a chord! Appending...
    if (now - lastKeyTimeRef.current < 1000 && recordedKeysRef.current.length > 0) {
      const newKeys = [...recordedKeysRef.current, ...currentKeys];
      setRecordedKeys(newKeys);
      recordedKeysRef.current = newKeys;
    } else {
      setRecordedKeys(currentKeys);
      recordedKeysRef.current = currentKeys;
    }
    
    lastKeyTimeRef.current = now;
  }, [editingId, saveShortcut, cancelEdit]);

  useEffect(() => {
    if (editingId) {
      window.addEventListener('keydown', handleKeyDown, { capture: true });
      return () => {
        window.removeEventListener('keydown', handleKeyDown, { capture: true });
      }
    }
  }, [editingId, handleKeyDown]);

  const filteredShortcuts = (shortcuts || []).map(group => {
    return {
      ...group,
      items: (group.items || []).filter(item => 
        (item.name || '').toLowerCase().includes((searchQuery || '').toLowerCase()) || 
        (item.keys || []).join(' ').toLowerCase().includes((searchQuery || '').toLowerCase())
      )
    }
  }).filter(group => group.items.length > 0)

  const totalShortcuts = (shortcuts || []).reduce((acc, group) => acc + (group.items || []).length, 0)
  const showingShortcuts = filteredShortcuts.reduce((acc, group) => acc + (group.items || []).length, 0)

  return (
    <div className="shortcuts-container">
      <style>{`
        .shortcuts-container {
          padding: 32px 48px;
          color: var(--text-primary, #e0e0e0);
          width: 100%;
          max-width: 1100px;
          overflow-y: auto;
          height: 100%;
          font-family: var(--font-sans, system-ui, sans-serif);
          background-color: var(--bg-deep, #0a0a0a);
          box-sizing: border-box;
        }

        /* Header */
        .shortcuts-header {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 24px;
        }
        .header-icon {
          width: 44px;
          height: 44px;
          background-color: var(--bg-surface, #141414);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05));
          color: var(--accent-color, #e0a96d);
        }
        .header-title {
          font-size: 22px;
          margin: 0 0 2px 0;
          color: var(--text-bright, #f0f0f0);
          font-weight: 600;
          letter-spacing: -0.02em;
        }
        .header-subtitle {
          font-size: 13px;
          color: var(--text-muted, #888);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .shortcut-counter {
          background-color: var(--bg-input, #1a1a1a);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
          color: var(--text-secondary, #a0a0a0);
          border: 1px solid var(--border-base, #2a2a2a);
          font-weight: 500;
        }

        /* Search */
        .search-wrapper {
          position: relative;
          margin-bottom: 32px;
        }
        .search-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted, #666);
        }
        .search-input {
          width: 100%;
          padding: 10px 14px 10px 38px;
          background-color: var(--bg-input, #141414);
          border: 1px solid var(--border-base, #222);
          border-radius: 6px;
          color: var(--text-primary, #e0e0e0);
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s ease, background-color 0.15s ease;
        }
        .search-input:focus {
          border-color: var(--accent-color, #e0a96d);
          background-color: var(--bg-surface, #1a1a1a);
        }
        .search-input::placeholder {
          color: var(--text-muted, #555);
        }

        /* Grouping */
        .shortcut-group {
          background-color: var(--bg-surface, #141414);
          border-radius: 8px;
          border-left: 3px solid var(--accent-color, #e0a96d);
          margin-bottom: 24px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }
        .group-header {
          padding: 14px 20px 10px;
          font-size: 12px;
          font-weight: 600;
          color: var(--accent-color, #e0a96d);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid var(--border-subtle, #1f1f1f);
        }

        /* Grid for items */
        .group-items {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
        }

        /* Rows */
        .shortcut-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px;
          background-color: var(--bg-surface, #141414);
          transition: background-color 0.1s ease;
          border-top: 1px solid var(--border-subtle, #1f1f1f);
          border-right: 1px solid var(--border-subtle, #1f1f1f);
        }
        .shortcut-row:nth-child(even) {
          border-right: none;
        }
        .shortcut-row:hover {
          background-color: var(--bg-elevated, #1c1c1c);
        }
        .shortcut-row.editing {
          background-color: var(--bg-input, #1a1a1a);
          box-shadow: inset 2px 0 0 var(--accent-color, #e0a96d);
        }
        .row-label {
          font-size: 13px;
          color: var(--text-primary, #d0d0d0);
          font-weight: 500;
        }

        /* Actions & Keys */
        .row-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .edit-btn {
          opacity: 0;
          color: var(--text-muted, #666);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .shortcut-row:hover .edit-btn {
          opacity: 1;
        }
        .edit-btn:hover {
          color: var(--accent-color, #e0a96d);
          background-color: var(--bg-activity, rgba(255, 255, 255, 0.05));
        }
        
        .key-container {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .key-cap {
          background-color: var(--bg-elevated, #242424);
          border: 1px solid var(--border-base, #111);
          border-top-color: var(--border-subtle, #333);
          border-bottom: 2px solid var(--bg-deep, #0a0a0a);
          border-radius: 5px;
          padding: 3px 8px;
          min-width: 28px;
          text-align: center;
          font-size: 11px;
          color: var(--text-primary, #e0e0e0);
          font-family: var(--font-mono, "JetBrains Mono", Consolas, monospace);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 1px 2px rgba(0, 0, 0, 0.1);
          font-weight: 500;
        }
        .key-plus {
          color: var(--text-muted, #555);
          font-size: 12px;
          font-weight: 600;
          font-family: var(--font-mono, "JetBrains Mono", Consolas, monospace);
        }

        /* Recording State */
        .recording-container {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .recording-prompt {
          font-size: 11px;
          color: var(--accent-color, #e0a96d);
          animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
        .highlight-cap {
          border-color: var(--accent-color, #e0a96d) !important;
          color: var(--accent-color, #e0a96d) !important;
        }
        .edit-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .icon-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.15s ease;
        }
        .save-btn {
          color: #4CAF50;
        }
        .save-btn:hover {
          background-color: rgba(76, 175, 80, 0.1);
        }
        .cancel-btn {
          color: #F44336;
        }
        .cancel-btn:hover {
          background-color: rgba(244, 67, 54, 0.1);
        }
      `}</style>

      <div className="shortcuts-header">
        <div className="header-icon">
          <Keyboard size={22} />
        </div>
        <div>
          <h1 className="header-title">Keyboard Shortcuts</h1>
          <div className="header-subtitle">
            Manage and view your IDE shortcuts
            <span className="shortcut-counter">
              {showingShortcuts !== totalShortcuts ? `${showingShortcuts} / ${totalShortcuts} bindings` : `${totalShortcuts} bindings`}
            </span>
          </div>
        </div>
      </div>

      <div className="search-wrapper">
        <Search size={14} className="search-icon" />
        <input 
          type="text" 
          className="search-input"
          placeholder="Search shortcuts..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="shortcuts-list">
        {filteredShortcuts.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: '#666', fontSize: '13px' }}>
            No shortcuts found matching "{searchQuery}"
          </div>
        )}
        
        {filteredShortcuts.map((group, gIdx) => (
          <div key={gIdx} className="shortcut-group">
            <div className="group-header">
              {group.category}
            </div>
            
            <div className="group-items">
              {group.items.map((item, iIdx) => (
                <div key={iIdx} className={`shortcut-row ${editingId === item.id ? 'editing' : ''}`}>
                  <span className="row-label">{item.name}</span>
                  
                  {editingId === item.id ? (
                    <div className="recording-container">
                      <span className="recording-prompt">Press keys...</span>
                      <div className="key-container">
                        {recordedKeys.length === 0 ? (
                          <kbd className="key-cap highlight-cap" style={{ opacity: 0.8, borderStyle: 'dashed' }}>Listening...</kbd>
                        ) : (
                          recordedKeys.map((key, kIdx) => (
                            <React.Fragment key={kIdx}>
                              <kbd className="key-cap highlight-cap">{key}</kbd>
                              {kIdx < recordedKeys.length - 1 && <span className="key-plus">+</span>}
                            </React.Fragment>
                          ))
                        )}
                      </div>
                      <div className="edit-actions">
                        <button className="icon-btn save-btn" onClick={saveShortcut} title="Save (Enter)"><Check size={16} /></button>
                        <button className="icon-btn cancel-btn" onClick={cancelEdit} title="Cancel (Esc)"><X size={16} /></button>
                      </div>
                    </div>
                  ) : (
                    <div className="row-actions">
                      <div className="edit-btn" title="Rebind shortcut" onClick={() => handleEditClick(item.id, item.keys)}>
                        <Edit2 size={14} />
                      </div>
                      <div className="key-container">
                        {(!item.keys || item.keys.length === 0) ? (
                          <kbd className="key-cap" style={{ opacity: 0.5, fontStyle: 'italic' }}>Unbound</kbd>
                        ) : (
                          item.keys.map((key, kIdx) => (
                            <React.Fragment key={kIdx}>
                              <kbd className="key-cap">{key}</kbd>
                              {kIdx < item.keys.length - 1 && <span className="key-plus">+</span>}
                            </React.Fragment>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
