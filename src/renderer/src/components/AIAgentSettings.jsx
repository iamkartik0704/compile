import React, { useState, useEffect } from 'react'

const PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    color: '#10a37f',
    prefixes: ['sk-proj-', 'sk-'],
    placeholder: 'sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    color: '#d4a574',
    prefixes: ['sk-ant-'],
    placeholder: 'sk-ant-api03-xxxxxxxxxxxxxxxx'
  },
  google: {
    id: 'google',
    name: 'Google',
    color: '#4285f4',
    prefixes: ['AIza'],
    placeholder: 'AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxx'
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    color: '#5b6ee1',
    prefixes: [],
    placeholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx'
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen',
    color: '#6c5ce7',
    prefixes: [],
    placeholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx'
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    color: '#f55036',
    prefixes: ['gsk_'],
    placeholder: 'gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    color: '#8e44ad',
    prefixes: [],
    placeholder: 'your-custom-api-key'
  },
  meta: {
    id: 'meta',
    name: 'Meta',
    color: '#0668e1',
    prefixes: [],
    placeholder: 'your-api-key-here'
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    color: '#f472b6',
    prefixes: [],
    placeholder: 'your-mistral-api-key'
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA',
    color: '#76b900',
    prefixes: ['nvapi-'],
    placeholder: 'nvapi-xxxxxxxxxxxxxxx'
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    color: '#ffcc4d',
    prefixes: ['hf_'],
    placeholder: 'hf_xxxxxxxxxxxxxxx'
  },
  oss: {
    id: 'oss',
    name: 'Open Source',
    color: '#f97316',
    prefixes: [],
    placeholder: 'your-api-key-here'
  }
}

const PROVIDER_LIST = Object.values(PROVIDERS)

export function AIAgentSettings() {
  const [providerKeys, setProviderKeys] = useState({})
  const [customBaseUrl, setCustomBaseUrl] = useState('https://openrouter.ai/api/v1')
  const [customName, setCustomName] = useState('')
  const [customModelId, setCustomModelId] = useState('')
  const [autoCompleteEnabled, setAutoCompleteEnabled] = useState(localStorage.getItem('editor-inlineSuggest') !== 'false')
  const [autoCompleteDelay, setAutoCompleteDelay] = useState(Number(localStorage.getItem('editor-inlineSuggestDelay')) || 300)
  const [selectedProvider, setSelectedProvider] = useState('openai')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [keyMessage, setKeyMessage] = useState('')
  const [autoDetectedProvider, setAutoDetectedProvider] = useState(null)
  const [deletingProvider, setDeletingProvider] = useState(null)

  useEffect(() => {
    const fetchKeys = async () => {
      if (window.api && window.api.getAllKeys) {
        const keys = await window.api.getAllKeys() || {}
        
        // Merge missing remote providers
        try {
          const remoteStr = localStorage.getItem('ide-sync-remote-providers')
          if (remoteStr) {
            const remoteProviders = JSON.parse(remoteStr)
            remoteProviders.forEach(p => {
              if (!keys[p] || !keys[p].exists) {
                keys[p] = { exists: false, remoteMissing: true }
              }
            })
          }
        } catch(e) {}
        
        setProviderKeys(keys)
      }
      if (window.api && window.api.getCustomConfig) {
        const config = await window.api.getCustomConfig()
        if (config) {
          if (config.customBaseUrl) setCustomBaseUrl(config.customBaseUrl)
          if (config.customModelId) setCustomModelId(config.customModelId)
          if (config.customName) setCustomName(config.customName)
        }
      }
    }
    
    fetchKeys()
    window.addEventListener('reload-ai-config', fetchKeys)
    return () => window.removeEventListener('reload-ai-config', fetchKeys)
  }, [])

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return
    setKeySaving(true)
    setKeyMessage('')
    try {
      const result = await window.api.saveApiKey(selectedProvider, apiKeyInput.trim())
      if (result.success) {
        setProviderKeys((prev) => ({ ...prev, [result.provider]: { exists: true, hint: result.hint } }))
        setApiKeyInput('')
        setAutoDetectedProvider(null)
        setKeyMessage(`${PROVIDERS[selectedProvider]?.name || selectedProvider} key encrypted and saved securely`)
        window.dispatchEvent(new Event('reload-ai-config'))
      } else {
        setKeyMessage(`Error: ${result.error}`)
      }
    } catch (err) {
      setKeyMessage(`Error: ${err.message}`)
    }
    setKeySaving(false)
  }

  const handleDeleteKey = async (providerId) => {
    try {
      const result = await window.api.deleteApiKey(providerId)
      if (result.success) {
        setProviderKeys((prev) => {
          const next = { ...prev }
          next[providerId] = { exists: false }
          return next
        })
        setDeletingProvider(null)
        window.dispatchEvent(new Event('reload-ai-config'))
      }
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (window.api && window.api.saveCustomConfig) {
      window.api.saveCustomConfig({ customBaseUrl, customModelId, customName })
      window.dispatchEvent(new Event('reload-ai-config'))
    }
  }, [customBaseUrl, customModelId, customName])

  useEffect(() => {
    localStorage.setItem('editor-inlineSuggest', autoCompleteEnabled.toString())
    window.dispatchEvent(new Event('reload-ai-config'))
  }, [autoCompleteEnabled])

  useEffect(() => {
    localStorage.setItem('editor-inlineSuggestDelay', autoCompleteDelay.toString())
    window.dispatchEvent(new Event('reload-ai-config'))
  }, [autoCompleteDelay])

  const keyCount = Object.values(providerKeys || {}).filter((k) => k?.exists).length
  const configuredProviders = Object.entries(providerKeys)
    .filter(([, v]) => v.exists)
    .map(([provider, data]) => ({ ...PROVIDERS[provider], ...data, id: provider }))




  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '32px 40px', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', background: 'transparent' }}>
      <div style={{ maxWidth: '680px' }}>
        
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '32px' }}>
          Manage the API keys for the AI models powering your coding assistant. Keys are encrypted securely by your operating system's credential manager.
        </p>

        {/* -- Configured Keys Overview -- */}
        <div style={{ marginBottom: '48px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border-base)', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Active Keys
            </h3>
            <span style={{ fontSize: '11px', background: 'var(--bg-input)', color: 'var(--text-primary)', padding: '2px 8px', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
              {configuredProviders.length} Configured
            </span>
          </div>

          <div>
            {configuredProviders.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '16px 0' }}>
                No keys currently configured.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {configuredProviders.map((p) => (
                  <div
                    key={p.id}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      padding: '12px 16px', 
                      backgroundColor: 'rgba(255, 255, 255, 0.02)', 
                      border: '1px solid var(--accent-color)', 
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)' }}>{PROVIDERS[p.id]?.name || p.id}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{p.hint}</span>
                    </div>
                    
                    {deletingProvider === p.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(244, 63, 94, 0.1)', padding: '6px 10px', borderRadius: 'var(--radius-sm)' }}>
                        <span style={{ fontSize: '11px', color: 'var(--accent-rose)', fontWeight: '500' }}>Remove key?</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button 
                            onClick={() => handleDeleteKey(p.id)}
                            style={{ padding: '4px 10px', fontSize: '11px', fontWeight: '500', backgroundColor: 'var(--accent-rose)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            Yes
                          </button>
                          <button 
                            onClick={() => setDeletingProvider(null)}
                            style={{ padding: '4px 10px', fontSize: '11px', fontWeight: '500', backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            No
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeletingProvider(p.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '6px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title={`Delete ${PROVIDERS[p.id]?.name || p.id} key`}
                        onMouseOver={(e) => { e.currentTarget.style.color = 'var(--accent-rose)'; e.currentTarget.style.background = 'rgba(244, 63, 94, 0.1)'; }}
                        onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* -- Add New Key -- */}
        <div style={{ marginBottom: '48px' }}>
          <div style={{ paddingBottom: '12px', borderBottom: '1px solid var(--border-base)', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Add a New Key
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Provider</label>
              <div style={{ position: 'relative', width: '250px' }}>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  style={{ 
                    width: '100%', padding: '8px 12px', fontSize: '13px', 
                    backgroundColor: 'rgba(255, 255, 255, 0.02)', color: 'var(--text-primary)', 
                    border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)',
                    appearance: 'none', cursor: 'pointer', outline: 'none'
                  }}
                >
                  {PROVIDER_LIST.map((p) => (
                    <option key={p.id} value={p.id} style={{ background: 'var(--bg-deep)' }}>
                      {p.name} {providerKeys[p.id]?.exists ? '(Set)' : ''}
                    </option>
                  ))}
                </select>
                <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                </div>
              </div>
            </div>

            {selectedProvider === 'custom' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Base URL</label>
                  <select
                    value={
                      ['https://openrouter.ai/api/v1', 'https://api.together.xyz/v1', 'http://localhost:1234/v1', 'http://localhost:11434/v1'].includes(customBaseUrl) ? customBaseUrl : 'other'
                    }
                    onChange={e => {
                      if (e.target.value === 'other') setCustomBaseUrl('')
                      else setCustomBaseUrl(e.target.value)
                    }}
                    style={{ padding: '8px 12px', fontSize: '13px', backgroundColor: 'var(--bg-deep)', color: 'var(--text-primary)', border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)', outline: 'none' }}
                  >
                    <option value="https://openrouter.ai/api/v1">OpenRouter</option>
                    <option value="https://api.together.xyz/v1">Together AI</option>
                    <option value="http://localhost:1234/v1">LM Studio</option>
                    <option value="http://localhost:11434/v1">Ollama</option>
                    <option value="https://api.groq.com/openai/v1">Groq</option>
                    <option value="other">Custom Endpoint...</option>
                  </select>
                  {!['https://openrouter.ai/api/v1', 'https://api.together.xyz/v1', 'http://localhost:1234/v1', 'http://localhost:11434/v1', 'https://api.groq.com/openai/v1'].includes(customBaseUrl) && (
                    <input
                      type="text"
                      value={customBaseUrl}
                      onChange={e => setCustomBaseUrl(e.target.value)}
                      placeholder="https://api.yourprovider.com/v1"
                      style={{ padding: '8px 12px', fontSize: '13px', backgroundColor: 'var(--bg-deep)', color: 'var(--text-primary)', border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)', outline: 'none', marginTop: '4px' }}
                    />
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Display Name</label>
                  <input
                    type="text"
                    value={customName}
                    onChange={e => setCustomName(e.target.value)}
                    placeholder="e.g. Local LLM"
                    style={{ padding: '8px 12px', fontSize: '13px', backgroundColor: 'var(--bg-deep)', color: 'var(--text-primary)', border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)', outline: 'none' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Default Model ID</label>
                  <input
                    type="text"
                    value={customModelId}
                    onChange={e => setCustomModelId(e.target.value)}
                    placeholder="llama3-70b"
                    style={{ padding: '8px 12px', fontSize: '13px', backgroundColor: 'rgba(255, 255, 255, 0.02)', color: 'var(--text-primary)', border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)', outline: 'none', width: '100%', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>API Key</label>
              <div style={{ display: 'flex', gap: '8px', maxWidth: '400px' }}>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={PROVIDERS[selectedProvider]?.placeholder || '••••••••••••••••'}
                  disabled={keySaving}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                  style={{ 
                    flex: 1, padding: '8px 12px', fontSize: '13px', fontFamily: 'var(--font-mono)',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)', color: 'var(--text-primary)', 
                    border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)',
                    outline: 'none', transition: 'border-color var(--duration-fast)'
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--border-focus)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--accent-color)'}
                />
                <button
                  onClick={handleSaveKey}
                  disabled={keySaving || !apiKeyInput.trim()}
                  style={{ 
                    padding: '0 16px', fontSize: '12px', fontWeight: '500',
                    background: 'var(--accent-purple)', color: 'white', 
                    border: 'none', borderRadius: 'var(--radius-sm)', 
                    cursor: (keySaving || !apiKeyInput.trim()) ? 'not-allowed' : 'pointer',
                    opacity: (keySaving || !apiKeyInput.trim()) ? 0.5 : 1,
                    transition: 'opacity var(--duration-fast)'
                  }}
                >
                  {keySaving ? 'Saving' : 'Save'}
                </button>
              </div>
            </div>

            {providerKeys[selectedProvider]?.exists && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                A key is already configured for this provider. Saving will overwrite it.
              </div>
            )}

            {keyMessage && (
              <div style={{ 
                fontSize: '12px', 
                color: keyMessage.includes('Error') ? 'var(--accent-rose)' : 'var(--accent-green)'
              }}>
                {keyMessage}
              </div>
            )}
          </div>
        </div>

        {/* -- AI Auto-Complete Settings -- */}
        <div style={{ marginBottom: '48px' }}>
          <div style={{ paddingBottom: '12px', borderBottom: '1px solid var(--border-base)', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Editor Auto-Complete
            </h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', cursor: 'pointer', color: 'var(--text-primary)', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={autoCompleteEnabled}
                onChange={e => setAutoCompleteEnabled(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Enable Inline Auto-Complete (Ghost Text)</span>
            </label>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', opacity: autoCompleteEnabled ? 1 : 0.5, pointerEvents: autoCompleteEnabled ? 'auto' : 'none', transition: 'opacity var(--duration-fast)', maxWidth: '300px' }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <span>Trigger Delay</span>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{autoCompleteDelay}ms</span>
              </label>
              <input
                type="range"
                min="100"
                max="2000"
                step="100"
                value={autoCompleteDelay}
                onChange={e => setAutoCompleteDelay(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
