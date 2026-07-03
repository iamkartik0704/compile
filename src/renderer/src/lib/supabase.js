import { createClient } from '@supabase/supabase-js'

// IMPORTANT: Replace with your actual Supabase URL and Anon Key
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key'

// Custom storage adapter that uses Electron IPC (safeStorage via Main process)
// This ensures refresh tokens are encrypted on disk and not exposed in renderer localStorage.
const secureStorageAdapter = {
  getItem: async (key) => {
    try {
      const res = await window.api.getAuthToken(key)
      return res.success ? res.value : null
    } catch (e) {
      console.error('Failed to get token:', e)
      return null
    }
  },
  setItem: async (key, value) => {
    try {
      await window.api.saveAuthToken(key, value)
    } catch (e) {
      console.error('Failed to save token:', e)
    }
  },
  removeItem: async (key) => {
    try {
      await window.api.deleteAuthToken(key)
    } catch (e) {
      console.error('Failed to delete token:', e)
    }
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false // We will handle deep links manually via the auth-callback IPC event
  }
})
