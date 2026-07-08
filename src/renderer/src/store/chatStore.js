import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// Custom debounced storage to avoid hammering localStorage during streaming
const debouncedStorage = () => {
  const baseStorage = createJSONStorage(() => localStorage)
  let timeoutId = null
  let pendingWrites = new Map()

  return {
    getItem: (name) => baseStorage.getItem(name),
    setItem: (name, value) => {
      pendingWrites.set(name, value)
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        for (const [k, v] of pendingWrites.entries()) {
          baseStorage.setItem(k, v)
        }
        pendingWrites.clear()
        timeoutId = null
      }, 500)
    },
    removeItem: (name) => baseStorage.removeItem(name),
  }
}

export const useChatStore = create(
  persist(
    (set, get) => ({
      _hasHydrated: false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      
      sessions: [], // array of { id, title, messages, updatedAt }
      activeSessionId: null,

      createSession: () => {
        const newSession = {
          id: `chat_${Date.now()}`,
          title: 'New Chat',
          messages: [],
          updatedAt: Date.now()
        }
        set(state => ({
          sessions: [newSession, ...state.sessions],
          activeSessionId: newSession.id
        }))
        return newSession.id
      },

      deleteSession: (id) => {
        set(state => {
          const newSessions = state.sessions.filter(s => s.id !== id)
          let newActiveId = state.activeSessionId
          if (state.activeSessionId === id) {
            newActiveId = newSessions.length > 0 ? newSessions[0].id : null
          }
          return {
            sessions: newSessions,
            activeSessionId: newActiveId
          }
        })
      },

      setActiveSession: (id) => {
        set({ activeSessionId: id })
      },

      updateMessages: (sessionId, updater) => {
        set(state => {
          const sessions = state.sessions.map(s => {
            if (s.id === sessionId) {
              const newMessages = typeof updater === 'function' ? updater(s.messages) : updater;
              let title = s.title;
              // Generate title if it's the first user message
              if (s.title === 'New Chat' && newMessages.length > 0) {
                const firstUserMsg = newMessages.find(m => m.role === 'user');
                if (firstUserMsg && firstUserMsg.content) {
                  title = firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
                }
              }
              return { ...s, messages: newMessages, title, updatedAt: Date.now() }
            }
            return s;
          })
          // Sort by updatedAt descending
          sessions.sort((a, b) => b.updatedAt - a.updatedAt)
          return { sessions }
        })
      }
    }),
    {
      name: 'chat-storage',
      version: 1, // Schema versioning
      storage: debouncedStorage(),
      onRehydrateStorage: () => (state) => {
        if (state) state.setHasHydrated(true)
      }
    }
  )
)
