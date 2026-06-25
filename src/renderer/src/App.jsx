import { useState, useEffect, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { CodeEditor } from './components/CodeEditor'
import './assets/sidebar.css'
import './assets/editor.css'

// ============================================================
// PROVIDER REGISTRY — Known API providers with detection patterns
// ============================================================
const PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    emoji: '🤖',
    color: '#10a37f',
    prefixes: ['sk-proj-', 'sk-'],
    placeholder: 'sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    emoji: '🧠',
    color: '#d4a574',
    prefixes: ['sk-ant-'],
    placeholder: 'sk-ant-api03-xxxxxxxxxxxxxxxx'
  },
  google: {
    id: 'google',
    name: 'Google',
    emoji: '✦',
    color: '#4285f4',
    prefixes: ['AIza'],
    placeholder: 'AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxx'
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    emoji: '🔍',
    color: '#5b6ee1',
    prefixes: [],
    placeholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx'
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen',
    emoji: '☁️',
    color: '#6c5ce7',
    prefixes: [],
    placeholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx'
  },
  meta: {
    id: 'meta',
    name: 'Meta',
    emoji: '∞',
    color: '#0668e1',
    prefixes: [],
    placeholder: 'your-api-key-here'
  },
  oss: {
    id: 'oss',
    name: 'Open Source',
    emoji: '🔓',
    color: '#f97316',
    prefixes: [],
    placeholder: 'your-api-key-here'
  }
}

const PROVIDER_LIST = Object.values(PROVIDERS)

/**
 * Auto-detect provider from key prefix.
 * Checks most specific prefixes first (sk-ant- before sk-).
 * Returns provider id or null if ambiguous.
 */
function detectProviderFromKey(key) {
  if (!key || key.length < 3) return null
  // Check Anthropic first (sk-ant- is more specific than sk-)
  if (key.startsWith('sk-ant-')) return 'anthropic'
  // Check Google
  if (key.startsWith('AIza')) return 'google'
  // sk-proj- is OpenAI-specific
  if (key.startsWith('sk-proj-')) return 'openai'
  // Generic sk- is ambiguous (OpenAI, DeepSeek, etc.) — don't auto-detect
  return null
}

// ============================================================
// MODEL REGISTRY — Categorized by capability tier
// ============================================================
const MODEL_GROUPS = [
  {
    label: '⚡ Fast',
    models: [
      { id: 'auto', name: 'Auto Mode', badge: 'DEFAULT' },
      { id: 'gemini-flash', name: 'Gemini Flash', provider: 'google' },
      { id: 'deepseek-chat', name: 'DeepSeek', provider: 'deepseek' }
    ]
  },
  {
    label: '🧠 Balanced',
    models: [
      { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic' },
      { id: 'gemini-pro', name: 'Gemini Pro', provider: 'google' },
      { id: 'qwen-plus', name: 'Qwen', provider: 'qwen' }
    ]
  },
  {
    label: '🚀 Deep Reasoning',
    models: [
      { id: 'claude-opus', name: 'Claude Opus', provider: 'anthropic' },
      { id: 'deepseek-r1', name: 'DeepSeek R1', provider: 'deepseek' }
    ]
  },
  {
    label: '🔓 Open Source',
    models: [
      { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'oss' },
      { id: 'llama-4', name: 'Llama 4', provider: 'meta' }
    ]
  }
]

// Flat lookup for display names
const MODEL_MAP = {}
MODEL_GROUPS.forEach((g) => g.models.forEach((m) => (MODEL_MAP[m.id] = m)))

function App() {
  // ── Chat State ──
  const [messages, setMessages] = useState([])
  const [prompt, setPrompt] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const streamRef = useRef('')

  // ── Model State ──
  const [selectedModel, setSelectedModel] = useState('auto')
  const [resolvedModel, setResolvedModel] = useState(null)

  // ── Multi-Provider API Key State ──
  const [providerKeys, setProviderKeys] = useState({})
  // e.g. { anthropic: { exists: true, hint: '••••xyz' }, google: { exists: true, hint: '••••abc' } }
  const [selectedProvider, setSelectedProvider] = useState('openai')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [keyMessage, setKeyMessage] = useState(null)

  // ── File Explorer State ──
  const [projectRoot, setProjectRoot] = useState(null)
  const [deletingProvider, setDeletingProvider] = useState(null) // which provider is pending delete confirmation
  const [autoDetectedProvider, setAutoDetectedProvider] = useState(null)

  // ── UI State ──
  const [showExplorer, setShowExplorer] = useState(true)
  const [rightPanel, setRightPanel] = useState('chat') // chat | settings | null
  const chatEndRef = useRef(null)

  // ── Editor State ──
  const [openFiles, setOpenFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  
  const handleOpenFile = (path, name) => {
    if (!openFiles.find(f => f.path === path)) {
      setOpenFiles([...openFiles, { path, name, isDirty: false }])
    }
    setActiveFile(path)
  }

  const closeFile = (path) => {
    const newFiles = openFiles.filter(f => f.path !== path)
    setOpenFiles(newFiles)
    if (activeFile === path) {
      setActiveFile(newFiles.length > 0 ? newFiles[newFiles.length - 1].path : null)
    }
  }

  const markFileDirty = (path) => setOpenFiles(prev => prev.map(f => f.path === path ? { ...f, isDirty: true } : f))
  const markFileClean = (path) => setOpenFiles(prev => prev.map(f => f.path === path ? { ...f, isDirty: false } : f))

  // ── Load all saved keys on mount ──
  useEffect(() => {
    window.api.getAllKeys().then((result) => {
      setProviderKeys(result)
      const count = Object.keys(result).length
      if (count > 0) {
        console.log(`Loaded ${count} API key(s):`, Object.keys(result).join(', '))
      }
    })
  }, [])

  // ── Subscribe to AI stream chunks ──
  useEffect(() => {
    window.api.onAIStream((chunk) => {
      streamRef.current += chunk
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: streamRef.current }
        }
        return updated
      })
    })
  }, [])

  // ── Subscribe to model resolution ──
  useEffect(() => {
    window.api.onModelResolved((model) => {
      setResolvedModel(model)
    })
  }, [])

  // ── Auto-scroll chat ──
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Auto-detect provider from key input ──
  useEffect(() => {
    const detected = detectProviderFromKey(apiKeyInput)
    setAutoDetectedProvider(detected)
    if (detected) {
      setSelectedProvider(detected)
    }
  }, [apiKeyInput])

  // ── Send Prompt ──
  const handleSend = async () => {
    const trimmed = prompt.trim()
    if (!trimmed || isStreaming) return

    // Reset stream accumulator
    streamRef.current = ''
    setResolvedModel(null)

    // Add user message + empty assistant placeholder
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed },
      { role: 'assistant', content: '' }
    ])
    setPrompt('')
    setIsStreaming(true)

    try {
      await window.api.sendAIPrompt(trimmed, { model: selectedModel })
      // Stream chunks arrive via onAIStream callback
      // Wait a bit for final chunks then mark done
      setTimeout(() => setIsStreaming(false), 800)
    } catch (err) {
      console.error('Send error:', err)
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: `// Error: ${err.message}` }
      ])
      setIsStreaming(false)
    }
  }

  // ── Handle Enter key ──
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Save API Key for selected provider ──
  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return
    setKeySaving(true)
    setKeyMessage('')

    try {
      const result = await window.api.saveApiKey(selectedProvider, apiKeyInput.trim())
      if (result.success) {
        setProviderKeys((prev) => ({
          ...prev,
          [result.provider]: { exists: true, hint: result.hint }
        }))
        setApiKeyInput('')
        setAutoDetectedProvider(null)
        setKeyMessage(`${PROVIDERS[selectedProvider]?.name || selectedProvider} key encrypted and saved securely ✓`)
      } else {
        setKeyMessage(`Error: ${result.error}`)
      }
    } catch (err) {
      setKeyMessage(`Error: ${err.message}`)
    }
    setKeySaving(false)
  }

  // ── Delete API Key ──
  const handleDeleteKey = async (provider) => {
    try {
      const result = await window.api.deleteApiKey(provider)
      if (result.success) {
        setProviderKeys((prev) => {
          const updated = { ...prev }
          delete updated[provider]
          return updated
        })
        setDeletingProvider(null)
        setKeyMessage(`${PROVIDERS[provider]?.name || provider} key deleted successfully ✓`)
      } else {
        setKeyMessage(`Error: ${result.error}`)
      }
    } catch (err) {
      setKeyMessage(`Error: ${err.message}`)
    }
  }

  // ── Get display name for model ──
  const getModelName = (id) => MODEL_MAP[id]?.name || id

  // ── Check if a model's provider has a key ──
  const hasKeyForModel = (modelId) => {
    const model = MODEL_MAP[modelId]
    if (!model || modelId === 'auto') return null // auto doesn't need a specific key
    return providerKeys[model.provider]?.exists || false
  }

  // ── Count configured keys ──
  const keyCount = Object.values(providerKeys).filter((k) => k.exists).length

  // ── Get providers that already have keys ──
  const configuredProviders = Object.entries(providerKeys)
    .filter(([, v]) => v.exists)
    .map(([provider, data]) => ({ ...PROVIDERS[provider], ...data, id: provider }))

  return (
    <div className="ide-layout">
      {/* ── Activity Bar (left icons) ── */}
      <aside className="activity-bar">
        <div className="activity-top">
          <button
            className={`activity-btn ${showExplorer ? 'active' : ''}`}
            onClick={() => setShowExplorer(!showExplorer)}
            title="File Explorer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
          <button
            className={`activity-btn ${rightPanel === 'chat' ? 'active' : ''}`}
            onClick={() => setRightPanel(rightPanel === 'chat' ? null : 'chat')}
            title="AI Chat"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </button>
          <button
            className={`activity-btn ${rightPanel === 'settings' ? 'active' : ''}`}
            onClick={() => setRightPanel(rightPanel === 'settings' ? null : 'settings')}
            title="API Key Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
        <div className="activity-bottom">
          <div className="activity-logo" title="comπle">π</div>
        </div>
      </aside>

      {/* ── Sidebar Pane ── */}
      {showExplorer && (
        <Sidebar projectRoot={projectRoot} setProjectRoot={setProjectRoot} onOpenFile={handleOpenFile} />
      )}

      {/* ── Main Content Area ── */}
      <div className="main-area">
        {/* ── Title Bar ── */}
        <header className="title-bar">
          <div className="title-left">
            <span className="title-name">comπle</span>
            <span className="title-sep">—</span>
            <span className="title-context">AI Assistant</span>
          </div>
          <div className="title-center">
            <div className="model-selector-wrapper">
              <select
                id="model-selector"
                className="model-selector"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isStreaming}
              >
                {MODEL_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.badge ? ` (${m.badge})` : ''}
                        {m.provider && providerKeys[m.provider]?.exists ? ' ✓' : ''}
                        {m.provider && !providerKeys[m.provider]?.exists ? ' ⚠' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="selector-chevron">▾</span>
            </div>
          </div>
          <div className="title-right">
            <div
              className={`key-indicator ${keyCount > 0 ? 'key-loaded' : 'key-missing'}`}
              onClick={() => setRightPanel('settings')}
              title={keyCount > 0 ? `${keyCount} API key(s) configured` : 'No API keys set'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="key-icon">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              <span className="key-label">
                {keyCount > 0 ? `${keyCount} key${keyCount > 1 ? 's' : ''}` : 'No Keys'}
              </span>
            </div>
          </div>
        </header>

        {/* ── Content Split Area ── */}
        <div className="content-split">
          <div className="editor-pane">
            <CodeEditor 
              openFiles={openFiles}
              activeFile={activeFile}
              setActiveFile={setActiveFile}
              closeFile={closeFile}
              markFileDirty={markFileDirty}
              markFileClean={markFileClean}
            />
          </div>

          {rightPanel && (
            <div className="right-pane">
              {/* ── Chat Panel ── */}
              {rightPanel === 'chat' && (
                <div className="chat-panel">
            {/* ── Message List ── */}
            <div className="message-list">
              {messages.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon">π</div>
                  <h2>comπle AI</h2>
                  <p>Send a prompt to start a conversation.</p>
                  <p className="empty-hint">
                    Try: &quot;Write a function to sort an array&quot; or &quot;Fix this bug in my auth logic&quot;
                  </p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`message message-${msg.role}`}>
                  <div className="message-avatar">
                    {msg.role === 'user' ? (
                      <span className="avatar-user">U</span>
                    ) : (
                      <span className="avatar-ai">π</span>
                    )}
                  </div>
                  <div className="message-body">
                    <div className="message-header">
                      <span className="message-sender">
                        {msg.role === 'user' ? 'You' : getModelName(resolvedModel || selectedModel)}
                      </span>
                      {msg.role === 'assistant' && resolvedModel && selectedModel === 'auto' && (
                        <span className="auto-badge">Auto → {getModelName(resolvedModel)}</span>
                      )}
                    </div>
                    <div className="message-content">
                      {msg.role === 'assistant' ? (
                        <pre className="code-block">
                          <code>
                            {msg.content || (isStreaming && i === messages.length - 1 ? '' : '...')}
                            {isStreaming && i === messages.length - 1 && (
                              <span className="cursor-blink">▌</span>
                            )}
                          </code>
                        </pre>
                      ) : (
                        <p>{msg.content}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* ── Input Bar ── */}
            <div className="input-bar">
              <div className="input-wrapper">
                <textarea
                  id="prompt-input"
                  className="prompt-input"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Send a message..."
                  rows={1}
                  disabled={isStreaming}
                />
                <button
                  id="send-btn"
                  className={`send-btn ${isStreaming ? 'streaming' : ''}`}
                  onClick={handleSend}
                  disabled={isStreaming || !prompt.trim()}
                  title="Send (Enter)"
                >
                  {isStreaming ? (
                    <span className="send-loader"></span>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="input-meta">
                <span className="meta-model">
                  {getModelName(selectedModel)}
                  {selectedModel === 'auto' && resolvedModel && ` → ${getModelName(resolvedModel)}`}
                  {selectedModel !== 'auto' && (
                    <span className={`meta-key-status ${hasKeyForModel(selectedModel) ? 'has-key' : 'no-key'}`}>
                      {hasKeyForModel(selectedModel) ? ' ✓' : ' ⚠ no key'}
                    </span>
                  )}
                </span>
                <span className="meta-hint">Enter to send · Shift+Enter for new line</span>
              </div>
            </div>
              </div>
            )}

            {/* ── Settings Panel ── */}
            {rightPanel === 'settings' && (
              <div className="settings-panel">
            <div className="settings-content">
              <h2 className="settings-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="settings-icon">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
                API Key Management
              </h2>
              <p className="settings-description">
                Add API keys for each provider you use. Keys are encrypted using your operating system&apos;s
                credential manager (Windows DPAPI / macOS Keychain / Linux Secret Service) and stored
                securely on disk. The raw key never leaves the Node.js process.
              </p>

              {/* ── Configured Keys Overview ── */}
              <div className="keys-overview-section">
                <h3 className="section-label">
                  Configured Keys
                  <span className="key-count-badge">{keyCount}</span>
                </h3>

                {configuredProviders.length === 0 ? (
                  <div className="no-keys-message">
                    <span className="no-keys-icon">🔑</span>
                    <p>No API keys configured yet. Add one below to get started.</p>
                  </div>
                ) : (
                  <div className="provider-keys-grid">
                    {configuredProviders.map((p) => (
                      <div
                        key={p.id}
                        className={`provider-key-card ${deletingProvider === p.id ? 'deleting' : ''}`}
                        style={{ '--provider-color': PROVIDERS[p.id]?.color || '#888' }}
                      >
                        <div className="provider-key-main">
                          <div className="provider-key-info">
                            <span className="provider-key-emoji">{PROVIDERS[p.id]?.emoji || '🔑'}</span>
                            <div>
                              <span className="provider-key-name">{PROVIDERS[p.id]?.name || p.id}</span>
                              <span className="provider-key-hint">{p.hint}</span>
                            </div>
                          </div>
                          <button
                            className="provider-delete-btn"
                            onClick={() => setDeletingProvider(p.id)}
                            title={`Delete ${PROVIDERS[p.id]?.name || p.id} key`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </div>

                        {/* ── Delete Confirmation ── */}
                        {deletingProvider === p.id && (
                          <div className="confirm-delete-row">
                            <span className="confirm-delete-text">Delete this key?</span>
                            <div className="confirm-delete-actions">
                              <button
                                className="confirm-delete-yes"
                                onClick={() => handleDeleteKey(p.id)}
                              >
                                Delete
                              </button>
                              <button
                                className="confirm-delete-no"
                                onClick={() => setDeletingProvider(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Add New Key ── */}
              <div className="key-input-section">
                <label className="key-label" htmlFor="provider-selector">
                  Add API Key
                </label>

                {/* Provider Selector */}
                <div className="provider-selector-row">
                  <div className="provider-selector-wrapper">
                    <select
                      id="provider-selector"
                      className="provider-selector"
                      value={selectedProvider}
                      onChange={(e) => setSelectedProvider(e.target.value)}
                    >
                      {PROVIDER_LIST.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.emoji} {p.name}
                          {providerKeys[p.id]?.exists ? ' (configured)' : ''}
                        </option>
                      ))}
                    </select>
                    <span className="selector-chevron">▾</span>
                  </div>

                  {autoDetectedProvider && (
                    <span className="auto-detect-badge">
                      ✨ Auto-detected: {PROVIDERS[autoDetectedProvider]?.name}
                    </span>
                  )}
                </div>

                {/* Key Input + Save */}
                <div className="key-input-row">
                  <input
                    id="api-key-input"
                    type="password"
                    className={`key-input ${autoDetectedProvider ? 'auto-detected' : ''}`}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={PROVIDERS[selectedProvider]?.placeholder || 'your-api-key-here'}
                    disabled={keySaving}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                  />
                  <button
                    id="save-key-btn"
                    className="key-save-btn"
                    onClick={handleSaveKey}
                    disabled={keySaving || !apiKeyInput.trim()}
                  >
                    {keySaving ? (
                      <span className="save-loader"></span>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="save-icon">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <polyline points="17 21 17 13 7 13 7 21" />
                          <polyline points="7 3 7 8 15 8" />
                        </svg>
                        Save
                      </>
                    )}
                  </button>
                </div>

                {providerKeys[selectedProvider]?.exists && (
                  <p className="key-replace-hint">
                    ⚠ {PROVIDERS[selectedProvider]?.name} already has a key configured. Saving will replace it.
                  </p>
                )}

                {keyMessage && (
                  <p className={`key-message ${keyMessage.includes('Error') ? 'error' : 'success'}`}>
                    {keyMessage}
                  </p>
                )}
              </div>

              {/* ── Security Info ── */}
              <div className="security-info">
                <h3>Security Architecture</h3>
                <div className="security-grid">
                  <div className="security-item">
                    <span className="security-badge">🔐</span>
                    <div>
                      <strong>Encrypted at Rest</strong>
                      <p>safeStorage.encryptString() → OS credential manager</p>
                    </div>
                  </div>
                  <div className="security-item">
                    <span className="security-badge">🛡️</span>
                    <div>
                      <strong>Isolated from Renderer</strong>
                      <p>Key never crosses the contextBridge — stays in Node.js memory</p>
                    </div>
                  </div>
                  <div className="security-item">
                    <span className="security-badge">🔒</span>
                    <div>
                      <strong>Context Isolation</strong>
                      <p>contextIsolation: true · nodeIntegration: false</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )}
  </div>
        {/* ── Status Bar ── */}
        <footer className="status-bar">
          <div className="status-left">
            <span className="status-item">
              <span className={`status-dot-sm ${isStreaming ? 'streaming' : 'ready'}`}></span>
              {isStreaming ? 'Streaming' : 'Ready'}
            </span>
            <span className="status-item status-model">
              {getModelName(selectedModel)}
              {selectedModel === 'auto' && resolvedModel && (
                <span className="status-resolved"> → {getModelName(resolvedModel)}</span>
              )}
            </span>
          </div>
          <div className="status-right">
            <span className="status-item">
              {keyCount > 0 ? (
                <span className="status-key-ok">🔑 {keyCount} key{keyCount > 1 ? 's' : ''}</span>
              ) : (
                <span className="status-key-none">⚠ No API Keys</span>
              )}
            </span>
            <span className="status-item status-security">
              contextIsolation: <span className="on">true</span>
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default App
