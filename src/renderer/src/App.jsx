import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Sidebar } from './components/Sidebar'
import { CodeEditor } from './components/CodeEditor'
import { TerminalPanel } from './components/TerminalPanel'
import { Resizer } from './components/Resizer'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { applyDiff, unescapeXml } from './diffUtils'
import { X } from 'lucide-react'
import './assets/sidebar.css'
import './assets/editor.css'

const renderMessageParts = (content) => {
  const parts = []
  // Matches <edit_file path="xyz"> ... </edit_file>
  // using [\s\S]*? to match across newlines
  const regex = /<edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/g
  let lastIndex = 0
  let match
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'edit', path: match[1], body: match[2], full: match[0] })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) })
  }
  return parts
}

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
  groq: {
    id: 'groq',
    name: 'Groq',
    emoji: '⚡',
    color: '#f55036',
    prefixes: ['gsk_'],
    placeholder: 'gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    emoji: '🔌',
    color: '#8e44ad',
    prefixes: [],
    placeholder: 'your-custom-api-key'
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
  // Check Groq
  if (key.startsWith('gsk_')) return 'groq'
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
      { id: 'deepseek-chat', name: 'DeepSeek', provider: 'deepseek' },
      { id: 'groq-llama-3', name: 'Llama 3.3 (Groq)', provider: 'groq' }
    ]
  },
  {
    label: '🧠 Balanced',
    models: [
      { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic' },
      { id: 'gemini-pro', name: 'Gemini Pro', provider: 'google' },
      { id: 'qwen-plus', name: 'Qwen', provider: 'qwen' },
      { id: 'groq-mixtral', name: 'Mixtral (Groq)', provider: 'groq' }
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
  },
  {
    label: '🔌 Custom',
    models: [
      { id: 'custom', name: 'Custom Model', provider: 'custom' }
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
  const [attachments, setAttachments] = useState([])
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
  const [rightPanel, setRightPanel] = useState(null)
  
  // Custom Provider State
  const [customBaseUrl, setCustomBaseUrl] = useState('https://openrouter.ai/api/v1')
  const [customModelId, setCustomModelId] = useState('qwen/qwen-2.5-coder-32b-instruct')
  const [customName, setCustomName] = useState('')
  const [customConfigLoaded, setCustomConfigLoaded] = useState(false)
  
  useEffect(() => {
    window.api.getCustomConfig().then(config => {
      if (config) {
        if (config.customBaseUrl) setCustomBaseUrl(config.customBaseUrl)
        if (config.customModelId) setCustomModelId(config.customModelId)
        if (config.customName !== undefined) setCustomName(config.customName)
      }
      setCustomConfigLoaded(true)
    })
  }, [])
  
  useEffect(() => {
    if (customConfigLoaded) {
      window.api.saveCustomConfig({ customBaseUrl, customModelId, customName })
    }
  }, [customBaseUrl, customModelId, customName, customConfigLoaded])

  // Refs
  const chatEndRef = useRef(null)

  // ── Editor State ──
  const [openFiles, setOpenFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  
  // ── Terminal State ──
  const [showTerminal, setShowTerminal] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(250)

  // ── Layout State ──
  const terminalPanelRef = useRef(null)
  const [bottomTab, setBottomTab] = useState('terminal') // 'terminal' | 'ai-debugger'
  const [aiDebugger, setAiDebugger] = useState({ explanation: '', codeFix: '', loading: false })

  const [autoCompleteEnabled, setAutoCompleteEnabled] = useState(true)
  const [autoCompleteDelay, setAutoCompleteDelay] = useState(500)

  const handleRunFile = () => {
    if (!activeFile) return
    let cmd = ''
    
    const isWindows = navigator.userAgent.toLowerCase().includes('win')

    if (activeFile.endsWith('.js')) cmd = `node "${activeFile}"`
    else if (activeFile.endsWith('.py')) cmd = `python "${activeFile}"`
    else if (activeFile.endsWith('.cpp') || activeFile.endsWith('.c++') || activeFile.endsWith('.c')) {
      cmd = isWindows 
        ? `g++ "${activeFile}" -o out.exe && out.exe`
        : `g++ "${activeFile}" -o out && ./out`
    } else {
      console.log('Unsupported file type for running')
      return
    }
    
    setShowTerminal(true)
    setTimeout(() => {
      if (terminalPanelRef.current) {
        terminalPanelRef.current.executeCommand(cmd)
      }
    }, 100)
  }

  // Global Keyboard Shortcut: Ctrl+Enter or Cmd+Enter to Run File
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleRunFile()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleRunFile])

  const handleFixWithAi = async () => {
    if (!terminalPanelRef.current || !activeFile) return
    const bufferText = terminalPanelRef.current.getBuffer()
    
    // Switch to AI Debugger Tab
    setBottomTab('ai-debugger')
    setAiDebugger({ explanation: '', codeFix: '', loading: true })
    
    let activeFileContent = ''
    try {
      const fileRes = await window.api.getFileContents(activeFile)
      activeFileContent = fileRes.content || fileRes || ''
    } catch (e) {
      console.error('Could not read active file contents for AI', e)
    }
    
const promptText = `The user encountered a terminal error.
Terminal Output:
${bufferText.substring(Math.max(0, bufferText.length - 2000))}

Active File (${activeFile}):
${activeFileContent.substring(0, 3000)}

Analyze the error and provide a fix. Return your response in exactly this format:
EXPLANATION: <brief explanation of the error in 1-2 short sentences>
FIX:
<edit_file path="${activeFile}">
<search_replace>
<search>
the exact code to be replaced
</search>
<replace>
the new code
</replace>
</search_replace>
</edit_file>`
    
    try {
      const res = await window.api.getAiCompletion(promptText, { model: selectedModel, customConfig: { baseURL: customBaseUrl, modelId: customModelId } })
      if (res && res.success && res.text) {
        const parts = res.text.split('FIX:')
        const explanation = parts[0].replace('EXPLANATION:', '').trim()
        
        let codeFix = parts[1] ? parts[1].trim() : ''
        // Strip markdown backticks around XML if the AI included them
        codeFix = codeFix.replace(/^```[a-zA-Z0-9+#-]*\n/, '').replace(/```$/, '').trim()
        
        setAiDebugger({ explanation, codeFix, loading: false })
      } else {
        setAiDebugger({ explanation: 'Failed to generate a fix.', codeFix: '', loading: false })
      }
    } catch (e) {
      setAiDebugger({ explanation: `Error during AI analysis: ${e.message}`, codeFix: '', loading: false })
    }
  }

  const applyAiDebuggerFix = async () => {
    if (!activeFile || !aiDebugger.codeFix) return
    window.dispatchEvent(new CustomEvent('auto-apply-diff', {
      detail: { body: aiDebugger.codeFix, path: activeFile }
    }))
    setBottomTab('terminal')
  }

  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [rightPanelWidth, setRightPanelWidth] = useState(320)
  
  const handleOpenFile = (path, name) => {
    setOpenFiles((prev) => {
      if (!prev.find(f => f.path === path)) {
        return [...prev, { path, name, isDirty: false }]
      }
      return prev
    })
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
      if (chunk === undefined) return
      streamRef.current += chunk
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: streamRef.current || '' }
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

  // ── Global Hotkeys ──
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Ctrl + Shift + ` (backtick) toggles terminal
      if (e.ctrlKey && e.shiftKey && e.code === 'Backquote') {
        e.preventDefault()
        setShowTerminal((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  // ── Auto-detect provider from key input ──
  useEffect(() => {
    const detected = detectProviderFromKey(apiKeyInput)
    setAutoDetectedProvider(detected)
    if (detected) {
      setSelectedProvider(detected)
    }
  }, [apiKeyInput])

  // ── Send Prompt ──
  const handleSend = async (directPromptOverride = null) => {
    const isDirectOverride = typeof directPromptOverride === 'string'
    const trimmed = isDirectOverride ? directPromptOverride.trim() : prompt.trim()
    if (!trimmed || isStreaming) return

    // Reset stream accumulator
    streamRef.current = ''
    setResolvedModel(null)

    // Add user message + empty assistant placeholder
    const currentAttachments = [...attachments]
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed, images: isDirectOverride ? [] : currentAttachments },
      { role: 'assistant', content: '' }
    ])
    
    if (!isDirectOverride) {
      setPrompt('')
      setAttachments([])
    }
    
    setIsStreaming(true)

    try {
      let finalPrompt = trimmed
      let contextBlocks = []

      if (projectRoot) {
        contextBlocks.push(`Workspace Root: ${projectRoot}\nIf you need to create a new file or edit a background file, construct an absolute path using this root directory.`)
      }

      const diffInstructions = `If you want to modify a file or create a new file, DO NOT output a standard markdown code block. Instead, output an edit block using this EXACT XML format:
<edit_file path="ABSOLUTE_PATH_TO_FILE">
<search>
the exact old code to be replaced
</search>
<replace>
the new code
</replace>
</edit_file>
You can output multiple <search>/<replace> blocks if needed.
CRITICAL RULE: If the file is empty, or you are creating a new file from scratch, or you want to entirely replace the file contents, you MUST leave the <search> block completely empty (i.e., <search></search>).`

      contextBlocks.push(diffInstructions)

      if (activeFile) {
        try {
          const fileContent = await window.api.getFileContents(activeFile)
          
          let fileText = fileContent.content || fileContent
          if (typeof window.getEditorValue === 'function') {
            fileText = window.getEditorValue()
          }

          let diagnosticsText = ""
          if (typeof window.getEditorDiagnostics === 'function') {
            const markers = window.getEditorDiagnostics()
            if (markers && markers.length > 0) {
              const severityMap = { 1: 'Hint', 2: 'Info', 4: 'Warning', 8: 'Error' }
              diagnosticsText = "\n\nLSP Diagnostics (Compiler/Linter feedback for the active file):\n" + markers.map(m => `[Line ${m.startLineNumber}, Col ${m.startColumn}] ${severityMap[m.severity] || 'Error'}: ${m.message}`).join('\n')
            }
          }

          contextBlocks.push(`The user is currently working on this active file: ${activeFile}\n\nFile Content:\n\`\`\`\n${fileText}\n\`\`\`${diagnosticsText}\n\nYou should default to editing this file unless requested otherwise.`)
        } catch (e) {
          console.warn("Could not load active file context:", e)
        }
      }

      if (contextBlocks.length > 0) {
        finalPrompt = `[SYSTEM CONTEXT]\n${contextBlocks.join('\n\n')}\n[END SYSTEM CONTEXT]\n\n${trimmed}`
      }

      const res = await window.api.sendAIPrompt(finalPrompt, {
        model: selectedModel,
        images: currentAttachments,
        customConfig: selectedModel === 'custom' ? {
          baseURL: customBaseUrl.trim(),
          modelId: customModelId.trim()
        } : undefined
      })
      
      // Stream is now fully finished
      setIsStreaming(false)
      const finalMsg = streamRef.current
      const regex = /<edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/g
      let match
      while ((match = regex.exec(finalMsg)) !== null) {
        const editPath = match[1]
        const editBody = match[2]
        
        const normalize = (p) => (p || '').replace(/\\/g, '/').toLowerCase()
        if (normalize(activeFile) === normalize(editPath)) {
          window.dispatchEvent(new CustomEvent('auto-apply-diff', {
            detail: { path: editPath, body: editBody }
          }))
        } else {
          try {
            let oldContent = ''
            try {
              const fileContext = await window.api.getFileContents(editPath)
              oldContent = fileContext.content || fileContext || ''
            } catch (e) {
              // File doesn't exist yet
            }
            
            const { newText, hasChanges } = applyDiff(oldContent, editBody)
            if (hasChanges) {
              await window.api.saveFileContents(editPath, newText)
              handleOpenFile(editPath, editPath.split(/[\\/]/).pop())
              window.dispatchEvent(new Event('refresh-sidebar'))
            }
          } catch (err) {
            console.error("Failed to auto-apply to background file", err)
          }
        }
      }
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

  // ── Handle Image Attachment ──
  const fileInputRef = useRef(null)
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files)
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (event) => {
          setAttachments(prev => [...prev, event.target.result])
        }
        reader.readAsDataURL(file)
      }
    })
    e.target.value = null // reset input
  }
  const removeAttachment = (idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Handle Paste Events ──
  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData.items)
    let pastedImage = false
    
    items.forEach(item => {
      if (item.type.indexOf('image/') !== -1) {
        pastedImage = true
        const file = item.getAsFile()
        const reader = new FileReader()
        reader.onload = (event) => {
          setAttachments(prev => [...prev, event.target.result])
        }
        reader.readAsDataURL(file)
      }
    })
    
    // Optional: if we only pasted an image (no text), we can prevent default
    // to avoid weird behaviors, but usually pasting an image into textarea does nothing anyway.
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
  const getModelName = (id) => id === 'custom' ? (customName || 'Custom Model') : (MODEL_MAP[id]?.name || id)

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

      {/* ── Sidebar (File Explorer) ── */}
      {showExplorer && (
        <>
          <Sidebar 
            projectRoot={projectRoot} 
            setProjectRoot={setProjectRoot}
            onOpenFile={handleOpenFile}
            width={sidebarWidth}
          />
          <Resizer 
            orientation="vertical" 
            onResize={(x) => setSidebarWidth(Math.max(150, Math.min(x - 48, 600)))} 
          />
        </>
      )}

      {/* ── Main Area ── */}
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
                        {m.id === 'custom' ? (customName || 'Custom Model') : m.name}
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
          <div className="editor-pane" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <CodeEditor 
                openFiles={openFiles}
                setOpenFiles={setOpenFiles}
                activeFile={activeFile}
                setActiveFile={setActiveFile}
                closeFile={closeFile}
                markFileDirty={markFileDirty}
                markFileClean={markFileClean}
                projectRoot={projectRoot}
                aiConfig={{ 
                  model: selectedModel, 
                  customConfig: { baseURL: customBaseUrl, modelId: customModelId },
                  autoCompleteEnabled,
                  autoCompleteDelay
                }}
                onRun={handleRunFile}
              />
            </div>
            {showTerminal && (
              <div className="bottom-panel" style={{ height: terminalHeight, display: 'flex', flexDirection: 'column', background: 'var(--bg-main)', borderTop: '1px solid rgba(255,255,255,0.15)', position: 'relative', boxShadow: '0 -4px 15px rgba(0,0,0,0.3)' }}>
                <div style={{ position: 'absolute', top: -3, left: 0, right: 0, zIndex: 10, display: 'flex', justifyContent: 'center' }}>
                  <div style={{ position: 'absolute', width: '100%', height: '100%' }}>
                    <Resizer 
                      orientation="horizontal" 
                      onResize={(_, y) => setTerminalHeight(Math.max(100, Math.min(window.innerHeight - y - 24, window.innerHeight - 150)))} 
                    />
                  </div>
                  <div style={{ width: '40px', height: '4px', background: 'rgba(255,255,255,0.2)', borderRadius: '2px', marginTop: '-2px', pointerEvents: 'none', zIndex: 11 }} />
                </div>
                
                <div className="bottom-tabs" style={{ display: 'flex', padding: '0 16px', background: 'var(--bg-dark)', borderBottom: '1px solid var(--border-light)', alignItems: 'center', height: '35px', gap: '20px' }}>
                  <button 
                    onClick={() => setBottomTab('terminal')}
                    style={{ background: 'transparent', border: 'none', color: bottomTab === 'terminal' ? 'var(--text-main)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '11px', textTransform: 'uppercase', padding: '0', borderBottom: bottomTab === 'terminal' ? '1px solid var(--accent-color)' : '1px solid transparent', height: '100%', fontWeight: bottomTab === 'terminal' ? 'bold' : 'normal' }}
                  >Terminal</button>
                  <button 
                    onClick={() => setBottomTab('ai-debugger')}
                    style={{ background: 'transparent', border: 'none', color: bottomTab === 'ai-debugger' ? 'var(--accent-color)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '11px', textTransform: 'uppercase', padding: '0', borderBottom: bottomTab === 'ai-debugger' ? '1px solid var(--accent-color)' : '1px solid transparent', height: '100%', fontWeight: bottomTab === 'ai-debugger' ? 'bold' : 'normal', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >✨ AI Debugger</button>
                  <div style={{ flex: 1 }} />
                  <button 
                    onClick={handleFixWithAi} 
                    style={{ background: 'var(--accent-color)', color: 'var(--bg-main)', border: 'none', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                  >
                    ✨ Fix with AI
                  </button>
                </div>

                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, opacity: bottomTab === 'terminal' ? 1 : 0, pointerEvents: bottomTab === 'terminal' ? 'auto' : 'none', zIndex: bottomTab === 'terminal' ? 1 : 0 }}>
                    <TerminalPanel ref={terminalPanelRef} key={projectRoot || 'default'} height={terminalHeight - 36} cwd={projectRoot} hideHeader={true} />
                  </div>
                  
                  {bottomTab === 'ai-debugger' && (
                     <div className="ai-debugger-panel" style={{ position: 'absolute', inset: 0, zIndex: 2, padding: '16px', background: '#0c0c14', display: 'flex', flexDirection: 'column' }}>
                       {aiDebugger.loading ? (
                         <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                           <div className="loading-spinner" style={{ marginBottom: '16px', fontSize: '24px' }}>⚙️</div>
                           Analyzing terminal error...
                         </div>
                       ) : (
                         <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minHeight: 0 }}>
                           {aiDebugger.explanation && (
                             <div style={{ background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                               <strong style={{ display: 'block', marginBottom: '8px', color: '#10a37f' }}>Explanation:</strong>
                               <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#e2e2e2', fontSize: '13px', lineHeight: '1.5' }}>{aiDebugger.explanation}</p>
                             </div>
                           )}
                           {aiDebugger.codeFix && (
                             <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                               <strong style={{ display: 'block', marginBottom: '8px', color: '#e2e2e2' }}>Proposed Fix:</strong>
                               <div style={{ flex: 1, overflow: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', background: '#1e1e1e' }}>
                                 <SyntaxHighlighter language="javascript" style={vscDarkPlus} customStyle={{ margin: 0, fontSize: '13px', background: 'transparent' }}>
                                   {(() => {
                                      const matches = [...aiDebugger.codeFix.matchAll(/<replace>([\s\S]*?)<\/replace>/g)]
                                      return matches.length > 0 ? matches.map(m => m[1].trim()).join('\n// ...\n') : aiDebugger.codeFix
                                   })()}
                                 </SyntaxHighlighter>
                               </div>
                               <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                                 <button onClick={applyAiDebuggerFix} style={{ background: 'var(--accent-color)', color: 'var(--bg-main)', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>Review in Editor</button>
                               </div>
                             </div>
                           )}
                         </div>
                       )}
                     </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {rightPanel && (
            <>
              <Resizer 
                orientation="vertical" 
                onResize={(x) => setRightPanelWidth(Math.max(200, Math.min(window.innerWidth - x, 800)))} 
              />
              <div className="right-pane" style={{ width: `${rightPanelWidth}px` }}>
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
                    <div className="message-content" style={{ overflowX: 'auto' }}>
                      {msg.role === 'assistant' ? (
                        renderMessageParts(msg.content + (isStreaming && i === messages.length - 1 ? ' ▌' : '')).map((part, idx) => (
                          part.type === 'text' ? (
                            <ReactMarkdown
                              key={idx}
                              components={{
                                code({ node, inline, className, children, ...props }) {
                                  const match = /language-(\w+)/.exec(className || '')
                                  return !inline && match ? (
                                    <div className="code-block-wrapper" style={{ position: 'relative', marginTop: '10px', marginBottom: '10px' }}>
                                      <button
                                        className="apply-code-btn"
                                        title="Apply to Editor"
                                        onClick={() => {
                                          if (activeFile) {
                                            window.dispatchEvent(new CustomEvent('apply-code', {
                                              detail: {
                                                code: String(children).replace(/\n$/, ''),
                                                path: activeFile
                                              }
                                            }))
                                          }
                                        }}
                                        style={{
                                          position: 'absolute',
                                          top: '8px',
                                          right: '8px',
                                          background: 'var(--bg-accent)',
                                          color: 'var(--text-main)',
                                          border: '1px solid var(--border-light)',
                                          borderRadius: '4px',
                                          padding: '4px 8px',
                                          fontSize: '12px',
                                          cursor: 'pointer',
                                          zIndex: 10
                                        }}
                                      >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ verticalAlign: 'middle', marginRight: '4px' }}>
                                          <path d="M5 13l4 4L19 7" />
                                        </svg>
                                        Apply
                                      </button>
                                      <SyntaxHighlighter
                                        {...props}
                                        children={String(children).replace(/\n$/, '')}
                                        style={vscDarkPlus}
                                        language={match[1]}
                                        PreTag="div"
                                        customStyle={{ margin: 0, borderRadius: '6px' }}
                                      />
                                    </div>
                                  ) : (
                                    <code {...props} className={className} style={{ background: 'var(--bg-light)', padding: '2px 4px', borderRadius: '4px', fontFamily: 'monospace' }}>
                                      {children}
                                    </code>
                                  )
                                }
                              }}
                            >
                              {part.content}
                            </ReactMarkdown>
                          ) : (
                            <div key={idx} className="edit-block-ui" style={{ margin: '10px 0', padding: '10px', background: 'var(--bg-light)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', fontSize: '13px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" style={{ flexShrink: 0 }}><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                <strong style={{ flexShrink: 0 }}>Agent Edit:</strong> <span style={{ wordBreak: 'break-all', flex: '1 1 auto' }}>{part.path}</span>
                                <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>Auto-applied ✨</span>
                              </div>
                              <details>
                                <summary style={{ cursor: 'pointer', outline: 'none', padding: '4px', background: 'var(--bg-dark)', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
                                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>View Changes (if auto-apply failed)</span>
                                </summary>
                                <pre style={{ marginTop: '8px', padding: '10px', background: 'var(--bg-dark)', borderRadius: '4px', overflowX: 'auto', fontSize: '13px' }}>
                                  {unescapeXml(part.body)}
                                </pre>
                              </details>
                            </div>
                          )
                        ))
                      ) : (
                        <>
                          {msg.images && msg.images.length > 0 && (
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                              {msg.images.map((img, i) => (
                                <img key={i} src={img} alt="attachment" style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: '4px', objectFit: 'contain' }} />
                              ))}
                            </div>
                          )}
                          <p>{msg.content}</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* ── Input Bar ── */}
            <div className="input-bar">
              {attachments.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', padding: '8px', background: 'var(--bg-dark)', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
                  {attachments.map((src, idx) => (
                    <div key={idx} style={{ position: 'relative' }}>
                      <img src={src} alt="preview" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-light)' }} />
                      <button 
                        onClick={() => removeAttachment(idx)}
                        style={{ position: 'absolute', top: '-6px', right: '-6px', background: 'var(--bg-light)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '50%', width: '20px', height: '20px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="input-wrapper">
                <input 
                  type="file" 
                  accept="image/*" 
                  multiple 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  style={{ display: 'none' }} 
                />
                <button 
                  className="attachment-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach Image"
                  disabled={isStreaming}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 8px' }}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                </button>
                <textarea
                  id="prompt-input"
                  className="prompt-input"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Send a message... (Paste images here)"
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

                {selectedProvider === 'custom' && (
                  <div className="custom-provider-config" style={{ marginTop: '12px', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="key-label" style={{ fontSize: '0.8rem', opacity: 0.8 }}>Base URL</label>
                    <select 
                      className="key-input" 
                      style={{ padding: '8px', cursor: 'pointer', appearance: 'auto', border: '1px solid var(--border-color)' }}
                      value={
                        ['https://openrouter.ai/api/v1', 'https://api.together.xyz/v1', 'http://localhost:1234/v1', 'http://localhost:11434/v1'].includes(customBaseUrl) ? customBaseUrl : 'other'
                      }
                      onChange={e => {
                        if (e.target.value === 'other') setCustomBaseUrl('')
                        else setCustomBaseUrl(e.target.value)
                      }}
                    >
                      <option value="https://openrouter.ai/api/v1">OpenRouter (https://openrouter.ai/api/v1)</option>
                      <option value="https://api.together.xyz/v1">Together AI (https://api.together.xyz/v1)</option>
                      <option value="http://localhost:1234/v1">LM Studio (Local)</option>
                      <option value="http://localhost:11434/v1">Ollama (Local)</option>
                      <option value="https://api.groq.com/openai/v1">Groq</option>
                      <option value="other">Other (Manual Entry)</option>
                    </select>
                    {!['https://openrouter.ai/api/v1', 'https://api.together.xyz/v1', 'http://localhost:1234/v1', 'http://localhost:11434/v1', 'https://api.groq.com/openai/v1'].includes(customBaseUrl) && (
                      <input 
                        type="text" 
                        className="key-input" 
                        value={customBaseUrl} 
                        onChange={e => setCustomBaseUrl(e.target.value)} 
                        placeholder="https://api.yourprovider.com/v1"
                        style={{ marginTop: '4px' }}
                      />
                    )}
                    <label className="key-label" style={{ fontSize: '0.8rem', opacity: 0.8 }}>Provider Name (Optional)</label>
                    <input 
                      type="text" 
                      className="key-input" 
                      value={customName} 
                      onChange={e => setCustomName(e.target.value)} 
                      placeholder="e.g. My OpenRouter"
                    />
                    <label className="key-label" style={{ fontSize: '0.8rem', opacity: 0.8 }}>Model ID</label>
                    <input 
                      type="text" 
                      className="key-input" 
                      value={customModelId} 
                      onChange={e => setCustomModelId(e.target.value)} 
                      placeholder="llama3-70b-8192"
                    />
                  </div>
                )}

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

              {/* ── AI Auto-Complete Settings ── */}
              <div className="security-info" style={{ marginTop: '24px' }}>
                <h3>✨ AI Auto-Complete</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={autoCompleteEnabled} 
                      onChange={e => setAutoCompleteEnabled(e.target.checked)} 
                    />
                    Enable Inline Auto-Complete (Ghost Text)
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                      <span>Trigger Delay (Speed)</span>
                      <span>{autoCompleteDelay}ms</span>
                    </label>
                    <input 
                      type="range" 
                      min="100" 
                      max="2000" 
                      step="100" 
                      value={autoCompleteDelay} 
                      onChange={e => setAutoCompleteDelay(Number(e.target.value))} 
                      style={{ cursor: 'pointer' }}
                    />
                    <small style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Lower delay = faster suggestions (uses more API calls)</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
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
            <span 
              className="status-item" 
              style={{ cursor: 'pointer', padding: '0 8px', borderLeft: '1px solid var(--border-light)' }}
              onClick={() => setAutoCompleteEnabled(!autoCompleteEnabled)}
              title="Toggle AI Autocomplete"
            >
              πlot Autocomplete: {autoCompleteEnabled ? <span style={{ color: '#10a37f' }}>On</span> : <span style={{ color: 'var(--text-muted)' }}>Off</span>}
            </span>
            <span 
              className="status-item" 
              style={{ cursor: 'pointer', padding: '0 8px', borderLeft: '1px solid var(--border-light)' }}
              onClick={() => setShowTerminal(!showTerminal)}
              title="Toggle Terminal (Ctrl+Shift+`)"
            >
              Terminal {showTerminal ? '▾' : '▴'}
            </span>
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
