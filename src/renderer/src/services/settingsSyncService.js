import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/appStore'

// Keys in localStorage that we want to sync
const EDITOR_SETTING_KEYS = [
  'editor-fontSize',
  'editor-fontFamily',
  'editor-tabSize',
  'editor-wordWrap',
  'editor-formatOnSave',
  'editor-minimap',
  'editor-inlineSuggest',
  'editor-lineNumbers',
  'editor-cursorBlinking',
  'editor-cursorStyle',
  'editor-bracketPairs',
  'editor-smoothScrolling',
  'editor-stickyScroll',
  'editor-zoomLevel',
  'editor-renderWhitespace'
]

const SYNC_UPDATED_AT_KEY = 'ide-sync-updated-at'

export async function collectLocalSettings() {
  const settings = {
    editorSettings: {},
    appSettings: {
      activeTheme: useAppStore.getState().activeTheme,
      autoSave: useAppStore.getState().autoSave,
    },
    configured_providers: [],
    updated_at: localStorage.getItem(SYNC_UPDATED_AT_KEY) || new Date(0).toISOString()
  }

  // Collect editor settings from localStorage
  for (const key of EDITOR_SETTING_KEYS) {
    const val = localStorage.getItem(key)
    if (val !== null) {
      settings.editorSettings[key] = val
    }
  }

  // Collect configured AI providers
  if (window.api && window.api.getAllKeys) {
    try {
      const keys = await window.api.getAllKeys()
      settings.configured_providers = Object.keys(keys).filter(k => keys[k]?.exists)
    } catch (e) {
      console.error('Failed to read configured API keys', e)
    }
  }

  // Collect keyboard shortcuts (excluding 'Custom' category)
  const shortcutsVal = localStorage.getItem('shortcut-storage')
  if (shortcutsVal) {
    try {
      const parsedShortcuts = JSON.parse(shortcutsVal)
      if (parsedShortcuts && parsedShortcuts.state && parsedShortcuts.state.shortcuts) {
        // Exclude Custom category explicitly so arbitrary commands are not synced
        const syncedShortcuts = parsedShortcuts.state.shortcuts.filter(g => g.category !== 'Custom')
        settings.shortcuts = syncedShortcuts
      }
    } catch (e) {
      console.error('Failed to parse shortcuts for sync', e)
    }
  }

  return settings
}

export async function pullFromCloud() {
  const { data, error } = await supabase.auth.getUser()
  
  if (error) throw error
  if (!data?.user) throw new Error('Not authenticated')
    
  return data.user.user_metadata?.ide_settings || null
}

export async function syncToCloud(payload) {
  // Ensure we update the timestamp before pushing to the cloud
  const newTimestamp = new Date().toISOString()
  payload.updated_at = newTimestamp
  
  const { error } = await supabase.auth.updateUser({
    data: { ide_settings: payload }
  })
  
  if (error) throw error
  
  // Update local sync time to match the exact time we pushed
  localStorage.setItem(SYNC_UPDATED_AT_KEY, newTimestamp)
  return payload
}

export function mergeSettings(local, remote) {
  /*
   * NOTE: Timestamp comparison is client-side and racy if two devices sync
   * within the exact same short window. This is acceptable for v1.
   */
  const localTime = new Date(local.updated_at).getTime()
  const remoteTime = new Date(remote.updated_at || 0).getTime()

  // Equal or no history case
  if (localTime === remoteTime || !local.updated_at || local.updated_at === new Date(0).toISOString()) {
    return { action: 'apply_remote', merged: remote }
  }

  if (remoteTime > localTime) {
    return { action: 'apply_remote', merged: remote }
  }

  if (localTime > remoteTime) {
    return { action: 'prompt_conflict' }
  }

  return { action: 'none' }
}

export function applySettingsLocally(settings) {
  if (!settings) return

  // 1. Apply editor settings
  if (settings.editorSettings) {
    for (const [key, value] of Object.entries(settings.editorSettings)) {
      localStorage.setItem(key, value)
      window.dispatchEvent(new CustomEvent('settings-changed', { detail: { key, value } }))
    }
  }

  // 2. Apply app settings
  if (settings.appSettings) {
    if (settings.appSettings.activeTheme) {
      useAppStore.getState().setActiveTheme(settings.appSettings.activeTheme)
    }
    if (settings.appSettings.autoSave !== undefined) {
      useAppStore.getState().setAutoSave(settings.appSettings.autoSave)
    }
  }
  
  // 3. Keep cloud configured_providers around for UI lookup
  if (settings.configured_providers) {
    localStorage.setItem('ide-sync-remote-providers', JSON.stringify(settings.configured_providers))
  }

  // 4. Apply synced keyboard shortcuts (merging with local Custom)
  if (settings.shortcuts) {
    const localShortcutsStr = localStorage.getItem('shortcut-storage');
    let mergedState = { state: { shortcuts: settings.shortcuts }, version: 0 };
    if (localShortcutsStr) {
      try {
        const localParsed = JSON.parse(localShortcutsStr);
        if (localParsed && localParsed.state && localParsed.state.shortcuts) {
          const localCustom = localParsed.state.shortcuts.find(g => g.category === 'Custom');
          if (localCustom) {
            mergedState.state.shortcuts.push(localCustom);
          }
        }
      } catch(e) {}
    }
    localStorage.setItem('shortcut-storage', JSON.stringify(mergedState));
    // Dispatch an event so shortcutStore can rehydrate if needed
    window.dispatchEvent(new Event('shortcuts-changed'));
  }

  // 5. Update sync timestamp
  if (settings.updated_at) {
    localStorage.setItem(SYNC_UPDATED_AT_KEY, settings.updated_at)
  }

  // Force re-renders for AI UI
  window.dispatchEvent(new Event('reload-ai-config'))
}
