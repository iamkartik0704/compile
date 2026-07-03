import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useAppStore } from '../store/appStore'
import { LogOut, X } from 'lucide-react'

export function AuthPanel({ width }) {
  const { session, user } = useAuthStore()
  const setActivePanel = useAppStore(state => state.setActivePanel)
  const [loading, setLoading] = useState(false)
  const [showConfirmLogout, setShowConfirmLogout] = useState(false)
  
  const handleLogin = async (provider) => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: 'comiple://auth-callback',
          skipBrowserRedirect: true
        }
      })
      if (error) throw error
      
      // Since we are in Electron, we MUST open the external system browser 
      // otherwise Google will block the embedded WebContents view.
      if (data?.url && window.api?.openUrl) {
        await window.api.openUrl(data.url)
      }
    } catch (err) {
      console.error('Login error:', err)
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  return (
    <aside className="sidebar auth-panel" style={{ width, display: 'flex', flexDirection: 'column' }}>
      <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: '8px' }}>
        <h2>ACCOUNT</h2>
        <button 
          onClick={() => setActivePanel('explorer')} 
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Close Account Panel"
        >
          <X size={18} />
        </button>
      </div>
      <div className="sidebar-content" style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
        {session && user ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
            
            {/* Professional, clean horizontal profile card */}
            <div style={{ 
              display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px', 
              padding: '8px 12px', background: 'transparent',
              borderBottom: '1px solid var(--border-base)', paddingBottom: '16px'
            }}>
              
              <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
                <div 
                  style={{ 
                    width: '100%', height: '100%', borderRadius: '50%', 
                    background: 'var(--accent-color)', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--bg-deep)', fontWeight: 'bold', fontSize: '16px'
                  }}
                >
                  {(user.user_metadata?.full_name || user.email || '?').charAt(0).toUpperCase()}
                </div>
                {user.user_metadata?.avatar_url && (
                  <img 
                    src={user.user_metadata.avatar_url} 
                    alt="avatar" 
                    onError={(e) => { e.target.style.display = 'none'; }}
                    style={{ 
                      width: '100%', height: '100%', borderRadius: '50%', 
                      position: 'absolute', top: 0, left: 0,
                      objectFit: 'cover'
                    }} 
                  />
                )}
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <strong style={{ 
                  fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', 
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' 
                }}>
                  {user.user_metadata?.full_name || user.email}
                </strong>
                <span style={{ 
                  fontSize: '12px', color: 'var(--text-muted)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  marginTop: '2px'
                }}>
                  {user.email}
                </span>
                <span style={{ 
                  fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', 
                  marginTop: '4px', opacity: 0.7
                }}>
                  Logged in via {user.app_metadata?.provider || 'Auth'}
                </span>
              </div>
            </div>
            
            {/* Custom Inline Confirmation or Sign Out Button */}
            <div style={{ marginTop: 'auto' }}>
              {showConfirmLogout ? (
                <div style={{ 
                  padding: '12px', background: 'transparent', 
                  borderTop: '1px solid var(--border-base)',
                  display: 'flex', flexDirection: 'column', gap: '12px'
                }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', textAlign: 'center' }}>
                    Are you sure you want to sign out?
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => setShowConfirmLogout(false)}
                      style={{ 
                        flex: 1, padding: '6px', background: 'transparent', 
                        color: 'var(--text-primary)', border: '1px solid var(--border-base)', 
                        borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
                      }}
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={() => {
                        setShowConfirmLogout(false)
                        handleLogout()
                      }}
                      style={{ 
                        flex: 1, padding: '6px', background: '#ef4444', 
                        color: 'white', border: '1px solid #dc2626', 
                        borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
                      }}
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => setShowConfirmLogout(true)}
                  style={{ 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', 
                    width: '100%', padding: '8px', background: 'transparent', 
                    color: 'var(--text-muted)', border: '1px solid var(--border-base)', 
                    borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
                >
                  <LogOut size={16} />
                  Sign Out
                </button>
              )}
            </div>
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', justifyContent: 'center', padding: '32px 0' }}>
            <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border-base)', borderTopColor: 'var(--text-main)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Waiting for authentication in browser...</p>
            <button 
              onClick={() => setLoading(false)}
              style={{ marginTop: '8px', padding: '6px 12px', background: 'transparent', color: 'var(--text-main)', border: '1px solid var(--border-base)', borderRadius: '4px', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Sign in to sync your settings, extensions, and access premium AI models.
            </p>
            
            <button 
              onClick={() => handleLogin('github')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px', background: '#24292e', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              Continue with GitHub
            </button>
            
            <button 
              onClick={() => handleLogin('google')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px', background: '#ffffff', color: '#757575', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
