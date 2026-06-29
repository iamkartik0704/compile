import { create } from 'zustand'
import { EXTENSIONS } from '../utils/extensionRegistry'

export const useAppStore = create((set) => ({
  activePanel: 'explorer', // 'explorer', 'search', 'git', 'extensions', 'settings'
  activeTheme: 'dark-plus', // 'dark-plus', 'light-modern', 'dracula'
  extensions: EXTENSIONS,
  
  setActivePanel: (panel) => set({ activePanel: panel }),
  setActiveTheme: (theme) => set({ activeTheme: theme }),
  
  toggleExtension: (id, category) => set((state) => ({
    extensions: state.extensions.map(ext => {
      if (ext.id === id) {
        const newEnabled = !ext.enabled
        // If it's a theme, activate it instantly via side-effect (handled in App.jsx or below)
        // We just update the state here.
        return { ...ext, enabled: newEnabled, installed: newEnabled ? true : ext.installed }
      }
      
      // If we just enabled a theme, disable other themes
      if (category === 'theme' && ext.category === 'theme') {
        return { ...ext, enabled: false }
      }
      
      return ext
    })
  }))
}))
