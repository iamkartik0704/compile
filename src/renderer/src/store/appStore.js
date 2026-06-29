import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { EXTENSIONS } from '../utils/extensionRegistry'

export const useAppStore = create(
  persist(
    (set) => ({
      activePanel: 'explorer', // 'explorer', 'search', 'git', 'extensions', 'settings'
      activeTheme: 'compile-dark', // 'compile-dark', 'dark-plus', 'light-modern', 'dracula'
      extensions: EXTENSIONS,
      
      setActivePanel: (panel) => set({ activePanel: panel }),
      setActiveTheme: (theme) => set({ activeTheme: theme }),
      
      toggleExtension: (id, category) => set((state) => ({
        extensions: state.extensions.map(ext => {
          if (ext.id === id) {
            const newEnabled = !ext.enabled
            return { ...ext, enabled: newEnabled, installed: newEnabled ? true : ext.installed }
          }
          if (category === 'theme' && ext.category === 'theme') {
            return { ...ext, enabled: false }
          }
          return ext
        })
      }))
    }),
    {
      name: 'app-storage',
      partialize: (state) => ({
        activeTheme: state.activeTheme,
        enabledExtensions: state.extensions.filter(e => e.enabled).map(e => e.id)
      }),
      merge: (persistedState, currentState) => {
        const mergedExtensions = currentState.extensions.map(ext => {
          // If enabledExtensions is undefined, we use the default ext.enabled
          const isEnabled = persistedState.enabledExtensions 
            ? persistedState.enabledExtensions.includes(ext.id) 
            : ext.enabled
            
          return {
            ...ext,
            enabled: isEnabled,
            installed: isEnabled ? true : ext.installed
          }
        })
        return {
          ...currentState,
          activeTheme: persistedState.activeTheme || currentState.activeTheme,
          extensions: mergedExtensions
        }
      }
    }
  )
)
