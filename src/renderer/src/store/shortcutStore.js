import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const defaultShortcuts = [
  {
    category: 'General',
    items: [
      { id: 'general.commandPalette', name: 'Command Palette', keys: ['Ctrl', 'Shift', 'P'] },
      { id: 'general.settings', name: 'Show Settings', keys: ['Ctrl', ','] },
      { id: 'general.extensions', name: 'Show Extensions', keys: ['Ctrl', 'Shift', 'X'] },
      { id: 'general.shortcuts', name: 'Show Keyboard Shortcuts', keys: ['Ctrl', 'K', 'Ctrl', 'S'] },
      { id: 'general.terminal', name: 'Toggle Terminal', keys: ['Ctrl', 'Shift', '`'] },
      { id: 'general.sidebar', name: 'Toggle Sidebar', keys: ['Ctrl', 'B'] },
      { id: 'general.zen', name: 'Toggle Zen Mode', keys: ['Ctrl', 'K', 'Z'] },
      { id: 'general.fullscreen', name: 'Toggle Full Screen', keys: ['F11'] },
      { id: 'general.split', name: 'Split Editor', keys: ['Ctrl', '\\'] },
      { id: 'general.closeWindow', name: 'Close Window', keys: ['Alt', 'F4'] },
      { id: 'general.run', name: 'Run File', keys: ['Ctrl', 'Alt', 'N'] },
    ]
  },
  {
    category: 'File Management',
    items: [
      { id: 'file.new', name: 'New File', keys: ['Ctrl', 'N'] },
      { id: 'file.open', name: 'Open File', keys: ['Ctrl', 'O'] },
      { id: 'file.openFolder', name: 'Open Folder', keys: ['Ctrl', 'K', 'Ctrl', 'O'] },
      { id: 'file.save', name: 'Save', keys: ['Ctrl', 'S'] },
      { id: 'file.saveAs', name: 'Save As', keys: ['Ctrl', 'Shift', 'S'] },
      { id: 'file.saveAll', name: 'Save All', keys: ['Ctrl', 'K', 'S'] },
      { id: 'file.close', name: 'Close File', keys: ['Ctrl', 'W'] },
      { id: 'file.closeAll', name: 'Close All Files', keys: ['Ctrl', 'K', 'W'] },
      { id: 'file.reopen', name: 'Reopen Closed File', keys: ['Ctrl', 'Shift', 'T'] },
      { id: 'file.newWindow', name: 'New Window', keys: ['Ctrl', 'Shift', 'N'] },
    ]
  },
  {
    category: 'Edit',
    items: [
      { id: 'edit.undo', name: 'Undo', keys: ['Ctrl', 'Z'] },
      { id: 'edit.redo', name: 'Redo', keys: ['Ctrl', 'Y'] },
      { id: 'edit.cut', name: 'Cut', keys: ['Ctrl', 'X'] },
      { id: 'edit.copy', name: 'Copy', keys: ['Ctrl', 'C'] },
      { id: 'edit.paste', name: 'Paste', keys: ['Ctrl', 'V'] },
      { id: 'edit.find', name: 'Find', keys: ['Ctrl', 'F'] },
      { id: 'edit.replace', name: 'Replace', keys: ['Ctrl', 'H'] },
      { id: 'edit.findInFiles', name: 'Find in Files', keys: ['Ctrl', 'Shift', 'F'] },
      { id: 'edit.selectAll', name: 'Select All', keys: ['Ctrl', 'A'] },
      { id: 'edit.multiCursor', name: 'Multi-cursor', keys: ['Alt', 'Click'] },
      { id: 'edit.duplicateLine', name: 'Duplicate Line', keys: ['Shift', 'Alt', 'Down'] },
      { id: 'edit.moveLineUp', name: 'Move Line Up', keys: ['Alt', 'Up'] },
      { id: 'edit.moveLineDown', name: 'Move Line Down', keys: ['Alt', 'Down'] },
      { id: 'edit.commentLine', name: 'Comment Line', keys: ['Ctrl', '/'] },
      { id: 'edit.format', name: 'Format Document', keys: ['Shift', 'Alt', 'F'] },
      { id: 'edit.inlineAi', name: 'Inline AI Edit', keys: ['Ctrl', 'I'] },
    ]
  },
  {
    category: 'Navigation',
    items: [
      { id: 'nav.goToFile', name: 'Go to File', keys: ['Ctrl', 'P'] },
      { id: 'nav.goToLine', name: 'Go to Line', keys: ['Ctrl', 'G'] },
      { id: 'nav.goToDef', name: 'Go to Definition', keys: ['F12'] },
      { id: 'nav.goToRef', name: 'Go to References', keys: ['Shift', 'F12'] },
      { id: 'nav.goBack', name: 'Go Back', keys: ['Alt', 'Left'] },
      { id: 'nav.goForward', name: 'Go Forward', keys: ['Alt', 'Right'] },
      { id: 'nav.switchTab', name: 'Switch Editor Tab', keys: ['Ctrl', 'Tab'] },
      { id: 'nav.focusExplorer', name: 'Focus Explorer', keys: ['Ctrl', 'Shift', 'E'] },
      { id: 'nav.focusTerminal', name: 'Focus Terminal', keys: ['Ctrl', '`'] },
    ]
  },
  {
    category: 'AI / Pilot',
    items: [
      { id: 'ai.autocomplete', name: 'Trigger Autocomplete', keys: ['Alt', '\\'] },
      { id: 'ai.accept', name: 'Accept Suggestion', keys: ['Tab'] },
      { id: 'ai.dismiss', name: 'Dismiss Suggestion', keys: ['Esc'] },
      { id: 'ai.chat', name: 'Open Pilot Chat', keys: ['Ctrl', 'L'] },
    ]
  },
  {
    category: 'Debug/Run',
    items: [
      { id: 'debug.run', name: 'Run File', keys: ['Ctrl', 'Alt', 'N'] },
      { id: 'debug.start', name: 'Start Debugging', keys: ['F5'] },
      { id: 'debug.breakpoint', name: 'Toggle Breakpoint', keys: ['F9'] },
      { id: 'debug.stepOver', name: 'Step Over', keys: ['F10'] },
      { id: 'debug.stepInto', name: 'Step Into', keys: ['F11'] },
      { id: 'debug.stepOut', name: 'Step Out', keys: ['Shift', 'F11'] },
      { id: 'debug.stop', name: 'Stop', keys: ['Shift', 'F5'] },
    ]
  },
  {
    category: 'View',
    items: [
    ]
  }
];

// Predefined registry of common Monaco native bindings to detect conflicts.
// REVISIT: Audit this list whenever the `monaco-editor` dependency is upgraded.
export const monacoNativeBindings = [
  { id: 'editor.action.addSelectionToNextFindMatch', name: 'Add Selection To Next Find Match', keys: ['Ctrl', 'D'] },
  { id: 'editor.action.deleteLines', name: 'Delete Line', keys: ['Ctrl', 'Shift', 'K'] },
  { id: 'editor.action.insertCursorBelow', name: 'Add Cursor Below', keys: ['Ctrl', 'Alt', 'Down'] },
  { id: 'editor.action.insertCursorAbove', name: 'Add Cursor Above', keys: ['Ctrl', 'Alt', 'Up'] },
  // Adding more common conflicting Monaco defaults if necessary.
];

export const useShortcutStore = create(
  persist(
    (set, get) => ({
      shortcuts: defaultShortcuts,
      isEditing: false,
      setIsEditing: (val) => set({ isEditing: val }),

      setShortcuts: (newShortcuts) => set({ shortcuts: newShortcuts }),

      updateShortcut: (id, newKeys) => set((state) => {
        const newShortcuts = state.shortcuts.map(group => ({
          ...group,
          items: group.items.map(item => 
            item.id === id ? { ...item, keys: newKeys } : item
          )
        }))
        return { shortcuts: newShortcuts }
      }),

      // Helper to retrieve a specific binding
      getShortcut: (id) => {
        const { shortcuts } = get();
        for (const group of shortcuts) {
          const item = group.items.find(i => i.id === id);
          if (item) return item.keys;
        }
        return null;
      },

      // Check for conflicts
      detectConflict: (keys) => {
        const keysStr = keys.join('+').toLowerCase();
        
        // 1. Check in our customized store
        const { shortcuts } = get();
        for (const group of shortcuts) {
          for (const item of group.items) {
            if (item.keys.join('+').toLowerCase() === keysStr) {
              return { type: 'custom', name: item.name, id: item.id };
            }
          }
        }

        // 2. Check Monaco native registry
        for (const native of monacoNativeBindings) {
          if (native.keys.join('+').toLowerCase() === keysStr) {
            return { type: 'monaco', name: native.name, id: native.id };
          }
        }

        return null; // No conflict
      }
    }),
    {
      name: 'shortcut-storage',
      merge: (persistedState, currentState) => {
        if (!persistedState || !persistedState.shortcuts) return currentState;
        const mergedShortcuts = currentState.shortcuts.map(defaultGroup => {
          const persistedGroup = persistedState.shortcuts.find(g => g.category === defaultGroup.category);
          if (!persistedGroup) return defaultGroup;
          
          return {
            ...defaultGroup,
            items: defaultGroup.items.map(defaultItem => {
              const persistedItem = persistedGroup.items.find(i => i.id === defaultItem.id);
              if (persistedItem) {
                return { ...defaultItem, keys: persistedItem.keys };
              }
              return defaultItem;
            })
          };
        });
        return { ...currentState, ...persistedState, shortcuts: mergedShortcuts };
      }
    }
  )
);

// Normalizes an event's modifier keys to an array format matching our keys array
export const normalizeEventToKeys = (e) => {
  const keys = [];
  if (e.ctrlKey) keys.push('Ctrl');
  if (e.shiftKey) keys.push('Shift');
  if (e.altKey) keys.push('Alt');
  if (e.metaKey) keys.push('Meta');
  
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    let keyName = e.key;
    if (keyName === ' ') keyName = 'Space';
    if (keyName.length === 1) keyName = keyName.toUpperCase();
    keys.push(keyName);
  }
  return keys;
};

// Check if an event matches a keys array
export const matchKeys = (e, keysArray) => {
  if (!keysArray || keysArray.length === 0) return false;
  const eventKeys = normalizeEventToKeys(e);
  return eventKeys.join('+').toLowerCase() === keysArray.join('+').toLowerCase();
};
