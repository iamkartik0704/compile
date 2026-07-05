import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Sidebar } from './components/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CodeEditor } from './components/CodeEditor'
import { TerminalPanel } from './components/TerminalPanel'
import { Resizer } from './components/Resizer'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { applyDiff, unescapeXml } from './diffUtils'
import { Play, Bug, Maximize2, Minimize2, Trash2, CheckCircle, Circle, RefreshCw, Command, ChevronRight, ChevronDown, File, Code, Cpu, Activity, Info, LogOut, ArrowRight, X, Search, Settings, User, LayoutGrid, PanelLeft, PanelBottom, PanelRight, Square, Minus, Terminal, Key, ShieldCheck, Sparkles, Folder, GitBranch } from 'lucide-react'
import { getEnclosingScope } from './utils/astParser'
import { CodebaseVisualizer } from './components/CodebaseVisualizer'
import { DSAExplainer } from './components/DSAExplainer'
import { ActivityBar } from './components/ActivityBar'

import { SourceControlPanel } from './components/SourceControlPanel'
import { ExtensionsPanel } from './components/ExtensionsPanel'
import { DockerPanel } from './components/DockerPanel'
import { KubernetesPanel } from './components/KubernetesPanel'
import { ProjectManagerPanel } from './components/ProjectManagerPanel'
import DebugPanel from './components/DebugPanel'
import { useAppStore } from './store/appStore'
import { AuthPanel } from './components/AuthPanel'
import { supabase } from './lib/supabase'
import * as monaco from 'monaco-editor'
import { useAuthStore } from './store/authStore'
import './assets/sidebar.css'
import './assets/editor.css'
import './assets/themes.css'
import { useShortcutStore, normalizeEventToKeys, defaultShortcuts } from './store/shortcutStore'
import { scanWorkspaceForDiagnostics } from './services/workspaceDiagnosticsScanner'
import { useDiagnosticsStore } from './store/diagnosticsStore'

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
    label: 'Fast',
    models: [
      { id: 'auto', name: 'Auto Mode', badge: 'DEFAULT' },
      { id: 'gemini-flash', name: 'Gemini Flash', provider: 'google' },
      { id: 'deepseek-chat', name: 'DeepSeek', provider: 'deepseek' },
      { id: 'groq-llama-3', name: 'Llama 3.3 (Groq)', provider: 'groq' }
    ]
  },
  {
    label: 'Balanced',
    models: [
      { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic' },
      { id: 'gemini-pro', name: 'Gemini Pro', provider: 'google' },
      { id: 'qwen-plus', name: 'Qwen', provider: 'qwen' },
      { id: 'groq-mixtral', name: 'Mixtral (Groq)', provider: 'groq' }
    ]
  },
  {
    label: 'Deep Reasoning',
    models: [
      { id: 'claude-opus', name: 'Claude Opus', provider: 'anthropic' },
      { id: 'deepseek-r1', name: 'DeepSeek R1', provider: 'deepseek' }
    ]
  },
  {
    label: 'Open Source',
    models: [
      { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'oss' },
      { id: 'llama-4', name: 'Llama 4', provider: 'meta' }
    ]
  },
  {
    label: 'Custom',
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

  useEffect(() => {
    if (projectRoot) {
      try {
        const stored = localStorage.getItem('recent-projects')
        let recents = stored ? JSON.parse(stored) : []

        // Remove if it already exists to move it to the top
        recents = recents.filter(p => p.path !== projectRoot)

        const name = projectRoot.split(/[/\\]/).pop() || projectRoot
        recents.unshift({ name, path: projectRoot, timestamp: Date.now() })

        // Keep only top 15
        recents = recents.slice(0, 15)
        localStorage.setItem('recent-projects', JSON.stringify(recents))
      } catch (e) {
        console.error('Failed to save recent project:', e)
      }
    }
  }, [projectRoot])

  // ── Kick off the workspace diagnostics scanner whenever the
  //    project root changes. This is what populates the "3" / "!"
  //    badges next to filenames in the sidebar without requiring
  //    the user to open every file first. The scanner drops all
  //    previous counts and rebuilds them from scratch, so switching
  //    between projects always gives a clean, correct view.
  useEffect(() => {
    if (!projectRoot) {
      useDiagnosticsStore.getState().clearAll()
      return
    }
    // Small delay so the LSP processes have time to spawn if the
    // user just landed in a fresh project.
    const timer = setTimeout(() => {
      scanWorkspaceForDiagnostics(projectRoot).catch((err) => {
        console.error('Workspace diagnostics scan failed:', err)
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [projectRoot])

  // ── UI State ──
  const [showExplorer, setShowExplorer] = useState(true)
  const [rightPanel, setRightPanel] = useState(null)
  const [showVisualizer, setShowVisualizer] = useState(false)
  const [dsaExplainer, setDsaExplainer] = useState(null) // null | { code, language }
  const [toast, setToast] = useState(null)
  const [missingToolchain, setMissingToolchain] = useState(null)
  const [activeMenu, setActiveMenu] = useState(null)
  const [activeSubmenu, setActiveSubmenu] = useState(null)

  useEffect(() => {
    const handleClickOutside = () => {
      setActiveMenu(null)
      setActiveSubmenu(null)
    }
    if (activeMenu) {
      window.addEventListener('click', handleClickOutside)
    }
    return () => window.removeEventListener('click', handleClickOutside)
  }, [activeMenu])

  useEffect(() => {
    const handleShowToast = (e) => {
      setToast({ message: e.detail.message, type: e.detail.type || 'info' })
      setTimeout(() => setToast(null), 3000)
    }
    window.addEventListener('show-toast', handleShowToast)
    return () => window.removeEventListener('show-toast', handleShowToast)
  }, [])

  // Open DSA Explainer prepopulated from the editor context menu.
  useEffect(() => {
    const handleOpenDsa = (e) => {
      const { code = '', language = 'javascript' } = e.detail || {}
      setDsaExplainer({ code, language })
    }
    window.addEventListener('open-dsa-explainer', handleOpenDsa)
    return () => window.removeEventListener('open-dsa-explainer', handleOpenDsa)
  }, [])

  useEffect(() => {
    if (window.api && window.api.onShowMissingToolchainModal) {
      window.api.onShowMissingToolchainModal((validation) => {
        setMissingToolchain(validation)
      })
    }
  }, [])

  // ── Live Server State ──
  const [isLiveServerRunning, setIsLiveServerRunning] = useState(false)
  const [liveServerUrl, setLiveServerUrl] = useState(null)

  const handleToggleLiveServer = async () => {
    let openPath = ''
    if (activeFile && activeFile.startsWith(projectRoot)) {
      openPath = activeFile.substring(projectRoot.length).replace(/^[\\/]/, '')
    }

    if (isLiveServerRunning && liveServerUrl) {
      const targetUrl = openPath ? `${liveServerUrl}/${openPath.replace(/\\/g, '/')}` : liveServerUrl
      window.api.openUrl(targetUrl)
    } else {
      if (!projectRoot) return
      const res = await window.api.startLiveServer(projectRoot, openPath)
      if (res.success) {
        setIsLiveServerRunning(true)
        setLiveServerUrl(res.baseUrl || res.url)
      } else {
        console.error('Failed to start Live Server:', res.error)
      }
    }
  }

  const handleStopLiveServer = async (e) => {
    e.stopPropagation()
    if (isLiveServerRunning) {
      await window.api.stopLiveServer()
      setIsLiveServerRunning(false)
      setLiveServerUrl(null)
    }
  }

  // Custom Provider State
  const [customBaseUrl, setCustomBaseUrl] = useState('https://openrouter.ai/api/v1')
  const [customModelId, setCustomModelId] = useState('qwen/qwen-2.5-coder-32b-instruct')
  const [customName, setCustomName] = useState('')
  const [customConfigLoaded, setCustomConfigLoaded] = useState(false)

  useEffect(() => {
    if (!window.api) return
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
    if (customConfigLoaded && window.api) {
      window.api.saveCustomConfig({ customBaseUrl, customModelId, customName })
    }
  }, [customBaseUrl, customModelId, customName, customConfigLoaded])

  // Refs
  const chatEndRef = useRef(null)

  // ── Editor State ──
  const [editorGroups, setEditorGroups] = useState([
    { id: 'group-1', openFiles: [], activeFile: null, closedFiles: [] }
  ])
  const [activeEditorGroupId, setActiveEditorGroupId] = useState('group-1')

  // Backward compatibility getters for AI Debugger, Live Server, etc.
  const activeGroup = editorGroups.find(g => g.id === activeEditorGroupId) || editorGroups[0]
  const openFiles = activeGroup.openFiles
  const activeFile = activeGroup.activeFile

  // Backward compatibility setters (operates on active group)
  const setOpenFiles = (updater) => {
    setEditorGroups(prev => {
      const idx = prev.findIndex(g => g.id === activeEditorGroupId)
      if (idx === -1) return prev
      const newGroups = [...prev]
      const next = typeof updater === 'function' ? updater(prev[idx].openFiles) : updater
      newGroups[idx] = { ...prev[idx], openFiles: next }
      return newGroups
    })
  }

  const setActiveFile = (updater) => {
    setEditorGroups(prev => {
      const idx = prev.findIndex(g => g.id === activeEditorGroupId)
      if (idx === -1) return prev
      const newGroups = [...prev]
      const next = typeof updater === 'function' ? updater(prev[idx].activeFile) : updater
      newGroups[idx] = { ...prev[idx], activeFile: next }
      return newGroups
    })
  }

  // ── Terminal State ──
  const [showTerminal, setShowTerminal] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(250)

  const terminalPanelRefs = useRef({})
  const [terminals, setTerminals] = useState([{ id: 'default', name: 'bash' }])
  const [activeTerminalId, setActiveTerminalId] = useState('default')

  const handleAddTerminal = () => {
    const newId = 'term-' + Date.now()
    setTerminals(prev => {
      let maxNum = 0
      prev.forEach(t => {
        const match = t.name.match(/bash (\d+)/)
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10))
      })
      return [...prev, { id: newId, name: `bash ${maxNum + 1}` }]
    })
    setActiveTerminalId(newId)
    setBottomTab('terminal')
  }

  const handleKillTerminal = (id, e) => {
    e.stopPropagation()
    window.api.killTerminal(id)
    setTerminals(prev => {
      const filtered = prev.filter(t => t.id !== id)
      if (activeTerminalId === id) {
        setTimeout(() => {
          setActiveTerminalId(filtered.length > 0 ? filtered[filtered.length - 1].id : null)
        }, 0)
      }
      return filtered
    })
  }

  // ── Layout State ──
  const [bottomTab, setBottomTab] = useState('terminal') // 'terminal' | 'ai-debugger' | 'debugger-history'
  const [aiDebugger, setAiDebugger] = useState({ explanation: '', codeFix: '', loading: false })
  const [debuggerHistory, setDebuggerHistory] = useState([])
  const aiDebuggerStreamRef = useRef('')

  const [autoCompleteEnabled, setAutoCompleteEnabled] = useState(localStorage.getItem('editor-inlineSuggest') !== 'false')
  const [autoCompleteDelay, setAutoCompleteDelay] = useState(500)

  useEffect(() => {
    const handleSettingsChanged = (e) => {
      if (e.detail.key === 'editor-inlineSuggest') {
        setAutoCompleteEnabled(e.detail.value)
      }
    }
    window.addEventListener('settings-changed', handleSettingsChanged)
    return () => window.removeEventListener('settings-changed', handleSettingsChanged)
  }, [])

  const saveActiveFile = async () => {
    if (!activeFile) return
    if (typeof window.getEditorValue === 'function') {
      const content = window.getEditorValue()

      if (activeFile.startsWith('untitled:')) {
        if (window.api.showSaveDialog) {
          const newPath = await window.api.showSaveDialog({
            title: 'Save Untitled File',
            defaultPath: 'Untitled.txt'
          });
          if (newPath) {
            await window.api.saveFileContents(newPath, content);
            setOpenFiles(prev => prev.map(f => {
              if (f.path === activeFile) {
                return { ...f, path: newPath, name: newPath.split(/[/\\]/).pop(), isDirty: false };
              }
              return f;
            }));
            setActiveFile(newPath);
          }
        }
        return;
      }

      await window.api.saveFileContents(activeFile, content)
      markFileClean(activeFile)
    }
  }

  const handleRunFile = async () => {
    if (!activeFile) return

    // Auto-save the file before running so the terminal executes the latest code
    if (typeof window.getEditorValue === 'function') {
      const content = window.getEditorValue()
      await window.api.saveFileContents(activeFile, content)
      markFileClean(activeFile)
    }

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
      const activeTerminal = terminalPanelRefs.current[activeTerminalId]
      if (activeTerminal) {
        activeTerminal.executeCommand(cmd)
      }
    }, 100)
  }

  const runFileRef = useRef(handleRunFile)
  useEffect(() => {
    runFileRef.current = handleRunFile
  })

  // Global Run File event listener
  useEffect(() => {
    const handleGlobalRun = () => runFileRef.current()
    window.addEventListener('global-run-file', handleGlobalRun)
    return () => {
      window.removeEventListener('global-run-file', handleGlobalRun)
    }
  }, [])

  // File Explorer Context Menu Global Sync (Rename / Delete)
  useEffect(() => {
    const handleFileRenamed = (e) => {
      const { oldPath, newPath } = e.detail

      setEditorGroups(prevGroups => {
        return prevGroups.map(group => {
          let updatedOpenFiles = [...group.openFiles]
          let updatedActiveFile = group.activeFile
          let modified = false

          const isAffected = (p) => p && (p === oldPath || p.startsWith(oldPath + '/') || p.startsWith(oldPath + '\\'))
          const getNewPath = (p) => p === oldPath ? newPath : newPath + p.substring(oldPath.length)

          updatedOpenFiles = updatedOpenFiles.map(f => {
            if (isAffected(f.path)) {
              modified = true
              const newFilePath = getNewPath(f.path)
              const newFileName = newFilePath.split(/[/\\]/).pop()

              // Handle Monaco model sync without visually closing tab
              try {
                const oldUri = monaco.Uri.file(f.path)
                let model = monaco.editor.getModel(oldUri)

                if (model) {
                  const content = model.getValue()
                  const lang = model.getLanguageId()
                  model.dispose()

                  const newUri = monaco.Uri.file(newFilePath)
                  monaco.editor.createModel(content, lang, newUri)
                }
              } catch (err) {
                console.error('Failed to sync monaco model on rename', err)
              }

              return { ...f, path: newFilePath, name: newFileName }
            }
            return f
          })

          if (isAffected(updatedActiveFile)) {
            updatedActiveFile = getNewPath(updatedActiveFile)
          }

          if (modified) {
            return { ...group, openFiles: updatedOpenFiles, activeFile: updatedActiveFile }
          }
          return group
        })
      })
    }

    const handleFileDeleted = (e) => {
      const { path } = e.detail
      setEditorGroups(prevGroups => {
        return prevGroups.map(group => {
          const isAffected = (p) => p && (p === path || p.startsWith(path + '/') || p.startsWith(path + '\\'))
          const stillOpen = group.openFiles.filter(f => !isAffected(f.path))

          if (stillOpen.length !== group.openFiles.length) {
            const closedFiles = group.openFiles.filter(f => isAffected(f.path))
            closedFiles.forEach(f => {
              try {
                const uri = monaco.Uri.file(f.path)
                const model = monaco.editor.getModel(uri)
                if (model) model.dispose()
              } catch (err) { }
            })

            let newActive = group.activeFile
            if (isAffected(group.activeFile)) {
              newActive = stillOpen.length > 0 ? stillOpen[stillOpen.length - 1].path : null
            }
            return { ...group, openFiles: stillOpen, activeFile: newActive }
          }
          return group
        })
      })
    }

    window.addEventListener('file-renamed', handleFileRenamed)
    window.addEventListener('file-deleted', handleFileDeleted)
    return () => {
      window.removeEventListener('file-renamed', handleFileRenamed)
      window.removeEventListener('file-deleted', handleFileDeleted)
    }
  }, [])

  const handleFixWithAi = async () => {
    const activeTerminal = terminalPanelRefs.current[activeTerminalId]
    if (!activeTerminal || !activeFile) return
    const bufferText = activeTerminal.getBuffer()

    // Switch to AI Debugger Tab
    setBottomTab('ai-debugger')
    setAiDebugger({ explanation: '', codeFix: '', loading: true })

    let activeFileContent = ''
    let scopedContext = ''
    try {
      if (typeof window.getEditorValue === 'function') {
        activeFileContent = window.getEditorValue()

        // AST Optimization
        if (typeof window.getCursorPosition === 'function') {
          const pos = window.getCursorPosition()
          if (pos) {
            const ext = activeFile.split('.').pop()
            let lang = 'javascript'
            if (ext === 'js' || ext === 'jsx') lang = 'javascript'
            if (ext === 'ts' || ext === 'tsx') lang = 'typescript'
            if (ext === 'py') lang = 'python'
            if (ext === 'cpp' || ext === 'hpp') lang = 'cpp'
            if (ext === 'c' || ext === 'h') lang = 'c'
            if (ext === 'java') lang = 'java'
            if (ext === 'go') lang = 'go'
            if (ext === 'rs') lang = 'rust'

            const scope = await getEnclosingScope(activeFileContent, pos.lineNumber, lang)
            if (scope) {
              scopedContext = `\n\n[AST Optimized] Enclosing Scope (${scope.type} lines ${scope.startLine}-${scope.endLine}):\n${scope.text}`
              activeFileContent = activeFileContent.substring(0, 500) + '\n... (truncated by AST) ...'
            }
          }
        }
      } else {
        const fileRes = await window.api.getFileContents(activeFile)
        activeFileContent = fileRes.content || fileRes || ''
      }
    } catch (e) {
      console.error('Could not read active file contents for AI', e)
    }

    // Load full project tree
    let allProjectFiles = []
    let projectTreeText = ''
    try {
      if (projectRoot) {
        allProjectFiles = await window.api.getProjectTree(projectRoot) || []
        if (allProjectFiles.length > 0) {
          const relativePaths = allProjectFiles.map(p => p.replace(projectRoot, '').replace(/^[\\/]/, ''))
          projectTreeText = `\n\nProject Tree:\n${relativePaths.slice(0, 500).join('\n')}`
        }
      }
    } catch (e) { console.error('Failed to get project tree', e) }

    // Scan for multiple files in terminal output
    const pathRegex = /(?:[a-zA-Z]:\\|\/)[^\s"':<>]+(?:\.[a-zA-Z0-9]+)+/g
    let matches = [...new Set(bufferText.match(pathRegex) || [])]

    // Resolve relative paths from terminal by matching basenames
    if (allProjectFiles.length > 0) {
      const possibleRelFiles = allProjectFiles.filter(p => {
        const basename = p.split(/[\\/]/).pop()
        return bufferText.includes(basename)
      })
      matches = [...new Set([...matches, ...possibleRelFiles])]
    }

    const normalizePath = p => (p || '').replace(/\\/g, '/').toLowerCase()
    const activeNorm = normalizePath(activeFile)

    let multiFileContext = ''
    for (const match of matches) {
      if (normalizePath(match) !== activeNorm) {
        try {
          const res = await window.api.getFileContents(match)
          if (res && (res.content || res)) {
            multiFileContext += `\n\nRelated File in Stack Trace (${match}):\n${(res.content || res).substring(0, 3000)}`
          }
        } catch (e) { }
      }
    }

    const promptText = `The user encountered a terminal error.
Terminal Output:
${bufferText.substring(Math.max(0, bufferText.length - 2000))}

Active File (${activeFile}):
${activeFileContent.substring(0, 3000)}${scopedContext}${multiFileContext}${projectTreeText}

Analyze the error and provide a fix for the file that caused it. Return your response in exactly this format:
EXPLANATION: <brief explanation of the error in 1-2 short sentences>
FIX:
<edit_file path="FULL_PATH_OF_FILE_TO_FIX">
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
      aiDebuggerStreamRef.current = ''
      await window.api.streamAiDebugger(promptText, { model: selectedModel, customConfig: { baseURL: customBaseUrl, modelId: customModelId } })
      // Streaming will populate state via useEffect
    } catch (e) {
      setAiDebugger({ explanation: `Error during AI analysis: ${e.message}`, codeFix: '', loading: false })
    }
  }

  const handleDebuggerFollowUp = async (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.value.trim()) {
      e.preventDefault()
      const question = e.target.value.trim()
      e.target.value = ''

      const promptText = `Previous AI Explanation:\n${aiDebugger.explanation}\n\nPrevious AI Code Fix:\n${aiDebugger.codeFix}\n\nUser Follow-up Question:\n${question}\n\nAnalyze the user's follow-up question and provide an updated explanation and fix. Return your response in exactly this format:\nEXPLANATION: <brief explanation of the error in 1-2 short sentences>\nFIX:\n<edit_file path="FULL_PATH_OF_FILE_TO_FIX">\n<search_replace>\n<search>\nthe exact code to be replaced\n</search>\n<replace>\nthe new code\n</replace>\n</search_replace>\n</edit_file>`

      setAiDebugger(prev => ({ ...prev, loading: true }))
      try {
        aiDebuggerStreamRef.current = ''
        await window.api.streamAiDebugger(promptText, { model: selectedModel, customConfig: { baseURL: customBaseUrl, modelId: customModelId } })
      } catch (err) {
        setAiDebugger({ explanation: `Error: ${err.message}`, codeFix: '', loading: false })
      }
    }
  }

  const applyAiDebuggerFix = async (forceRun = false) => {
    if (!activeFile || !aiDebugger.codeFix) return

    // Extract target path from the <edit_file> tag if present
    const regex = /<edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/i
    const match = regex.exec(aiDebugger.codeFix)
    const targetPath = match ? match[1] : activeFile
    const body = match ? match[2] : aiDebugger.codeFix
    const normalize = (p) => (p || '').replace(/\\/g, '/').toLowerCase()

    if (forceRun) {
      // Add to Debugger History
      const activeTerminal = terminalPanelRefs.current[activeTerminalId]
      const bufferText = activeTerminal?.getBuffer() || ''
      setDebuggerHistory(prev => [{
        timestamp: new Date().toLocaleTimeString(),
        error: bufferText.substring(Math.max(0, bufferText.length - 800)),
        explanation: aiDebugger.explanation,
        codeFix: aiDebugger.codeFix
      }, ...prev])

      if (normalize(targetPath) === normalize(activeFile)) {
        window.dispatchEvent(new CustomEvent('force-apply-diff', {
          detail: { body: aiDebugger.codeFix, path: targetPath, autoRun: true }
        }))
      } else {
        try {
          let oldContent = ''
          try {
            const fileContext = await window.api.getFileContents(targetPath)
            oldContent = fileContext.content || fileContext || ''
          } catch (e) { }

          const { newText, hasChanges } = applyDiff(oldContent, body)
          if (hasChanges) {
            await window.api.saveFileContents(targetPath, newText)
            handleOpenFile(targetPath, targetPath.split(/[\\/]/).pop())
            window.dispatchEvent(new Event('refresh-sidebar'))
            window.dispatchEvent(new Event('global-run-file'))
          }
        } catch (err) {
          console.error("Failed to apply to background file", err)
        }
      }
      setBottomTab('terminal')
    } else {
      if (normalize(targetPath) === normalize(activeFile)) {
        window.dispatchEvent(new CustomEvent('auto-apply-diff', {
          detail: { body: aiDebugger.codeFix, path: targetPath }
        }))
      } else {
        try {
          let oldContent = ''
          try {
            const fileContext = await window.api.getFileContents(targetPath)
            oldContent = fileContext.content || fileContext || ''
          } catch (e) { }

          const { newText, hasChanges } = applyDiff(oldContent, body)
          if (hasChanges) {
            await window.api.saveFileContents(targetPath, newText)
            handleOpenFile(targetPath, targetPath.split(/[\\/]/).pop())
            window.dispatchEvent(new Event('refresh-sidebar'))
          }
        } catch (err) {
          console.error("Failed to auto-apply to background file", err)
        }
      }
      setBottomTab('terminal')
    }
  }

  const [sidebarWidth, setSidebarWidth] = useState(260)
  const { activePanel, setActivePanel, activeTheme, extensions, autoSave, setAutoSave } = useAppStore()
  const isLiveServerEnabled = extensions?.find(e => e.id === 'ext-prod-liveserver')?.enabled
  const [rightPanelWidth, setRightPanelWidth] = useState(320)

  // Initialize active theme
  useEffect(() => {
    document.body.style.backgroundColor = '' // Clear inline script fallback
    document.body.className = `theme-${activeTheme}`
  }, [activeTheme])

  const handleOpenFile = async (path, name, options = {}) => {
    let gitOriginal = null
    if (options.diff) {
      let relPath = options.relPath
      if (!relPath && path.startsWith(projectRoot)) {
        relPath = path.substring(projectRoot.length).replace(/^[\\/]/, '')
      }
      const res = await window.api.gitAction(projectRoot, 'show-head', relPath || path)
      if (res && res.stdout) {
        gitOriginal = res.stdout
      }
    }

    setOpenFiles((prev) => {
      const existing = prev.find(f => f.path === path)
      if (!existing) {
        return [...prev, { path, name, isDirty: false, gitOriginal }]
      } else if (gitOriginal !== null) {
        // Update existing with git diff if requested again
        return prev.map(f => f.path === path ? { ...f, gitOriginal } : f)
      }
      return prev
    })
    setActiveFile(path)
  }

  const closeFile = (path) => {
    setEditorGroups(prev => {
      const idx = prev.findIndex(g => g.id === activeEditorGroupId)
      if (idx === -1) return prev
      const newGroups = [...prev]

      const fileToClose = newGroups[idx].openFiles.find(f => f.path === path)
      if (!fileToClose) return prev

      const newFiles = newGroups[idx].openFiles.filter(f => f.path !== path)
      let newActive = newGroups[idx].activeFile
      if (newActive === path) {
        newActive = newFiles.length > 0 ? newFiles[newFiles.length - 1].path : null
      }

      const newClosedFiles = [...(newGroups[idx].closedFiles || []), fileToClose].filter(Boolean)

      newGroups[idx] = {
        ...newGroups[idx],
        openFiles: newFiles,
        activeFile: newActive,
        closedFiles: newClosedFiles
      }
      return newGroups
    })
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

    window.api.onAiDebuggerStream((chunk) => {
      if (chunk === undefined) return
      aiDebuggerStreamRef.current += chunk

      const fullText = aiDebuggerStreamRef.current
      const parts = fullText.split('FIX:')
      let explanation = parts[0].replace('EXPLANATION:', '').trim()

      // Format <think> tags dynamically so they render in Markdown
      explanation = explanation.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, '> *Thinking...*\n> $1\n\n')

      let codeFix = parts[1] ? parts[1].trim() : ''
      codeFix = codeFix.replace(/^```[a-zA-Z0-9+#-]*\n/, '').replace(/```$/, '').trim()

      setAiDebugger({ explanation, codeFix, loading: false })
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

  const pendingChordRef = useRef([])
  const [currentChordDisplay, setCurrentChordDisplay] = useState('')

  const executeGlobalAction = (id) => {
    switch (id) {
      case 'general.commandPalette':
        window.dispatchEvent(new CustomEvent('open-command-palette'))
        return true
      case 'general.terminal':
        setShowTerminal(prev => !prev)
        return true
      case 'general.sidebar':
        setActivePanel(useAppStore.getState().activePanel === 'explorer' ? null : 'explorer')
        return true
      case 'general.zen':
        setActivePanel(null)
        setShowTerminal(false)
        return true
      case 'general.fullscreen':
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => console.error(err))
        } else {
          document.exitFullscreen().catch(err => console.error(err))
        }
        return true
      case 'general.closeWindow':
        window.close()
        return true
      case 'file.openFolder':
        if (window.api.selectFolder) {
          window.api.selectFolder().then(p => {
            if (p) {
              const recents = JSON.parse(localStorage.getItem('recentFolders') || '[]')
              if (!recents.includes(p)) localStorage.setItem('recentFolders', JSON.stringify([p, ...recents].slice(0, 5)))
              setProjectRoot(p)
            }
          })
        }
        return true
      case 'general.shortcuts':
        handleOpenFile('settings:shortcuts', 'Keyboard Shortcuts')
        return true
      case 'file.saveAll':
        saveActiveFile()
        return true
      case 'file.closeFolder':
        setProjectRoot(null)
        return true
      case 'general.run':
      case 'debug.run':
        window.dispatchEvent(new Event('global-run-file'))
        return true
      case 'file.new':
        const newId = `untitled:Untitled-${Date.now()}`
        setOpenFiles(prev => [...prev, { name: 'Untitled', path: newId }])
        setActiveFile(newId)
        return true
      case 'file.newWindow':
        if (window.api.newWindow) window.api.newWindow()
        return true
      case 'file.closeAll':
        setOpenFiles([])
        setActiveFile(null)
        return true
      case 'file.open':
        if (window.api.selectFile) {
          window.api.selectFile().then(p => {
            if (p) {
              const recents = JSON.parse(localStorage.getItem('recentFiles') || '[]')
              if (!recents.includes(p)) localStorage.setItem('recentFiles', JSON.stringify([p, ...recents].slice(0, 5)))
              handleOpenFile(p, p.split(/[/\\]/).pop())
            }
          })
        }
        return true
      case 'file.saveAs':
      case 'file.save':
        saveActiveFile()
        return true
      case 'file.close':
        if (activeFile) closeFile(activeFile)
        return true
      case 'general.settings':
        handleOpenFile('settings:main', 'Settings')
        return true
      case 'general.extensions':
        setActivePanel('extensions')
        return true

      // Mapped unimplemented global features
      case 'general.split': {
        const newId = 'group-' + Date.now()
        setEditorGroups(prev => {
          const activeGroup = prev.find(g => g.id === activeEditorGroupId) || prev[0]
          return [...prev, { id: newId, openFiles: [...activeGroup.openFiles], activeFile: activeGroup.activeFile, closedFiles: [] }]
        })
        setActiveEditorGroupId(newId)
        return true
      }
      case 'file.reopen': {
        setEditorGroups(prev => {
          const idx = prev.findIndex(g => g.id === activeEditorGroupId)
          if (idx === -1) return prev
          const activeGroup = prev[idx]
          if (!activeGroup.closedFiles || activeGroup.closedFiles.length === 0) return prev

          const newClosed = [...activeGroup.closedFiles]
          const toRestore = newClosed.pop()
          if (!toRestore) return prev

          const newGroups = [...prev]
          const isAlreadyOpen = activeGroup.openFiles.some(f => f.path === toRestore.path)

          if (isAlreadyOpen) {
            newGroups[idx] = { ...activeGroup, activeFile: toRestore.path, closedFiles: newClosed }
          } else {
            newGroups[idx] = {
              ...activeGroup,
              openFiles: [...activeGroup.openFiles, toRestore],
              activeFile: toRestore.path,
              closedFiles: newClosed
            }
          }
          return newGroups
        })
        return true
      }
      case 'nav.switchTab': {
        setEditorGroups(prev => {
          const idx = prev.findIndex(g => g.id === activeEditorGroupId)
          if (idx === -1) return prev
          const activeGroup = prev[idx]
          if (activeGroup.openFiles.length <= 1) return prev // no-op for 0 or 1 file

          const currentFileIdx = activeGroup.openFiles.findIndex(f => f.path === activeGroup.activeFile)
          const nextFileIdx = (currentFileIdx + 1) % activeGroup.openFiles.length
          const newGroups = [...prev]
          newGroups[idx] = { ...activeGroup, activeFile: activeGroup.openFiles[nextFileIdx].path }
          return newGroups
        })
        return true
      }
      case 'nav.focusExplorer':
        setActivePanel('explorer')
        return true
      case 'nav.focusTerminal':
        setShowTerminal(true)
        setBottomTab('terminal')
        return true
      case 'edit.findInFiles':
        setActivePanel('search')
        return true
      case 'ai.chat':
        setRightPanel('chat')
        return true

      case 'debug.start':
      case 'debug.breakpoint':
      case 'debug.stepOver':
      case 'debug.stepInto':
      case 'debug.stepOut':
      case 'debug.stop':
        setActivePanel('debug')
        window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: `Debug panel opened. Note: Full debugging requires a language-specific DAP backend.`, type: 'info' } }))
        return true

      case 'nav.goBack':
      case 'nav.goForward':
        window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: `Feature '${id}' is not yet implemented in this preview.`, type: 'info' } }))
        return true
      case 'nav.goToFile':
        window.dispatchEvent(new CustomEvent('open-command-palette'))
        return true

      case 'ai.autocomplete': {
        const currentState = localStorage.getItem('editor-inlineSuggest') !== 'false';
        const newState = !currentState;
        localStorage.setItem('editor-inlineSuggest', newState.toString());
        window.dispatchEvent(new CustomEvent('settings-changed', { detail: { key: 'editor-inlineSuggest', value: newState } }));
        window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: `AI Autocomplete is now ${newState ? 'ON' : 'OFF'}`, type: 'info' } }));
        return true;
      }

      default:
        if (id.startsWith('edit.') || id.startsWith('ai.') || id.startsWith('nav.')) {
          window.dispatchEvent(new CustomEvent('editor-action', { detail: id }))
          return true
        }
        return false
    }
  }

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (useShortcutStore.getState().isEditing) return;

      // DEBUG: log Ctrl key combos to diagnose zoom issue
      if (e.ctrlKey && (e.key === '-' || e.key === '=' || e.key === '+' || e.key === '0' || e.key === 'Subtract' || e.key === 'Add')) {
        console.log('[ZOOM DEBUG] e.key:', JSON.stringify(e.key), 'e.code:', e.code, 'e.keyCode:', e.keyCode)
      }

      // Focus guard: ignore if typing in an input/textarea (unless it's the Monaco editor)
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        if (!activeEl.classList.contains('inputarea')) {
          return;
        }
      }

      // DSA Explainer overlay: when focus is anywhere inside the overlay
      // (Monaco input area OR the sample-input textarea), skip the global
      // shortcut handler entirely so Ctrl+V / Ctrl+C / Ctrl+X / Ctrl+A land
      // natively on the target and don't get eaten by editor-action dispatch.
      if (activeEl && activeEl.closest && activeEl.closest('.dsa-explainer-overlay')) {
        return;
      }

      // Ignore pure modifier presses (wait for the actual key)
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }

      const currentKeys = normalizeEventToKeys(e);

      const keysToMatch = [...pendingChordRef.current, ...currentKeys];
      const shortcuts = useShortcutStore.getState().shortcuts;

      let matchFound = null;
      let partialMatch = false;

      for (const group of shortcuts) {
        for (const item of group.items) {
          const itemKeysStr = item.keys.join('+').toLowerCase();
          const matchStr = keysToMatch.join('+').toLowerCase();

          if (itemKeysStr === matchStr) {
            matchFound = item;
            break;
          }
          if (itemKeysStr.startsWith(matchStr + '+')) {
            partialMatch = true;
          }
        }
        if (matchFound) break;
      }

      if (matchFound) {
        if (matchFound.id.startsWith('custom.')) {
          e.preventDefault()
          e.stopPropagation()
          const cmd = matchFound.command
          if (cmd) {
            let targetTerminal = terminalPanelRefs.current[activeTerminalId]

            // If active isn't ready/spawned, try to find any recently used one
            if (!targetTerminal || !targetTerminal.executeCommand) {
              const availableKeys = Object.keys(terminalPanelRefs.current).reverse()
              for (const k of availableKeys) {
                if (terminalPanelRefs.current[k] && terminalPanelRefs.current[k].executeCommand) {
                  targetTerminal = terminalPanelRefs.current[k]
                  setActiveTerminalId(k)
                  break
                }
              }
            }

            setShowTerminal(true)

            if (targetTerminal && targetTerminal.executeCommand) {
              targetTerminal.executeCommand(cmd)
            } else {
              // No terminal exists at all, create one
              handleAddTerminal()
              // Wait for it to spawn before executing
              const checkReady = setInterval(() => {
                const newTerm = terminalPanelRefs.current[activeTerminalId]
                // Note: activeTerminalId might not be updated immediately in this closure, 
                // so we scan the refs for the newly added one.
                const allKeys = Object.keys(terminalPanelRefs.current)
                const latestTerm = terminalPanelRefs.current[allKeys[allKeys.length - 1]]

                if (latestTerm && latestTerm.executeCommand) {
                  clearInterval(checkReady)
                  latestTerm.executeCommand(cmd)
                }
              }, 100)
              // Clear interval after 5 seconds to prevent memory leaks if spawn fails
              setTimeout(() => clearInterval(checkReady), 5000)
            }
          }
          return
        }

        // Only prevent default and stop propagation if it's a GLOBAL action handled by App.jsx.
        // Editor actions are natively handled by Monaco's keybinding registry.
        const handled = executeGlobalAction(matchFound.id);

        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }

        pendingChordRef.current = [];
        setCurrentChordDisplay('');
      } else if (partialMatch) {
        e.preventDefault();
        e.stopPropagation();
        pendingChordRef.current = keysToMatch;
        setCurrentChordDisplay(keysToMatch.join(' '));

        // Use a unique symbol or counter to avoid clearing the wrong chord if they keep typing
        const currentRef = pendingChordRef.current;
        setTimeout(() => {
          if (pendingChordRef.current === currentRef) {
            pendingChordRef.current = [];
            setCurrentChordDisplay('');
          }
        }, 3000);
      } else {
        // Dynamically suppress old default keybindings that the user has remapped.
        // Build a set of all default keybinding strings, then subtract the current ones.
        // Any default key combo that's no longer assigned to anything should be blocked
        // so Monaco doesn't fire its built-in action for it.
        const matchStr = keysToMatch.join('+').toLowerCase();
        const currentKeySet = new Set();
        for (const group of shortcuts) {
          for (const item of group.items) {
            currentKeySet.add(item.keys.join('+').toLowerCase());
          }
        }
        const defaultKeySet = new Set();
        for (const group of defaultShortcuts) {
          for (const item of group.items) {
            defaultKeySet.add(item.keys.join('+').toLowerCase());
          }
        }
        // "Orphaned" = was a default but is no longer assigned to any shortcut
        if (defaultKeySet.has(matchStr) && !currentKeySet.has(matchStr)) {
          e.preventDefault();
          e.stopPropagation();
        }

        pendingChordRef.current = [];
        setCurrentChordDisplay('');
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true })

    const handleExecuteGlobalAction = (e) => {
      executeGlobalAction(e.detail)
    }
    window.addEventListener('execute-global-action', handleExecuteGlobalAction)

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true })
      window.removeEventListener('execute-global-action', handleExecuteGlobalAction)
    }
  }, [activeFile, setActivePanel])

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

          contextBlocks.push(`The user is currently working on this active file: ${activeFile}\n\nFile Content:\n\`\`\`\n${fileText}\n\`\`\`${diagnosticsText}\n\nYou should default to editing this file unless requested otherwise.\n\nCRITICAL: If you modify this file, you MUST use the <edit_file path="${activeFile.replace(/\\/g, '/')}"> XML format as instructed above. DO NOT output standard markdown code blocks for file modifications.`)
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

  // ── Extension handler ──
  const handleOpenExtension = (extId) => {
    // We'll prefix with 'ext:' so CodeEditor knows it's an extension
    handleOpenFile('ext:' + extId, 'Extension: ' + extId)
  }

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


  useEffect(() => {
    const handleReload = async () => {
      if (window.api && window.api.getApiKeys) {
        const keys = await window.api.getApiKeys()
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
      setAutoCompleteEnabled(localStorage.getItem('editor-inlineSuggest') !== 'false')
    }
    window.addEventListener('reload-ai-config', handleReload)
    return () => window.removeEventListener('reload-ai-config', handleReload)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      useAuthStore.getState().setSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      useAuthStore.getState().setSession(session)
    })

    const removeListener = window.api?.onAuthCallback?.(async (urlStr) => {
      try {
        const url = new URL(urlStr)
        const hash = url.hash
        if (hash && hash.includes('access_token')) {
          const hashParams = new URLSearchParams(hash.substring(1))
          const access_token = hashParams.get('access_token')
          const refresh_token = hashParams.get('refresh_token')
          if (access_token && refresh_token) {
            await supabase.auth.setSession({ access_token, refresh_token })
          }
        } else if (url.searchParams.get('code')) {
          const code = url.searchParams.get('code')
          await supabase.auth.exchangeCodeForSession(code)
        }
      } catch (err) {
        console.error("Auth callback error:", err)
      }
    })

    return () => {
      subscription?.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const handleDebugPostman = async (e) => {
      const detail = e.detail;
      setBottomTab('ai-debugger')
      setShowTerminal(true)
      setAiDebugger({ explanation: '', codeFix: '', loading: true })

      let activeFileContent = ''
      try {
        if (typeof window.getEditorValue === 'function') {
          activeFileContent = window.getEditorValue()
        } else if (activeFile) {
          const fileRes = await window.api.getFileContents(activeFile)
          activeFileContent = fileRes.content || fileRes || ''
        }
      } catch (err) {
        console.error('Could not read active file contents for AI', err)
      }

      const promptText = `The user encountered an error with an API request in the Postman client.
Request URL: ${detail.url}
Request Method: ${detail.method}
Request Headers: ${JSON.stringify(detail.headers, null, 2)}
Request Body: ${detail.body}

Response Status: ${detail.responseStatus?.code} ${detail.responseStatus?.text}
Response Body:
${detail.response}

Active File (${activeFile}):
${activeFileContent.substring(0, 3000)}

Analyze the API request and response to figure out what went wrong. Provide a fix if applicable. Return your response in exactly this format:
EXPLANATION: <brief explanation of the error in 1-2 short sentences>
FIX:
<edit_file path="FULL_PATH_OF_FILE_TO_FIX">
<search_replace>
<search>
the exact code to be replaced
</search>
<replace>
the new code
</replace>
</search_replace>
</edit_file>
(Or just explain what the user should change in the request if the server code is not at fault.)`

      try {
        aiDebuggerStreamRef.current = ''
        await window.api.streamAiDebugger(promptText, { model: selectedModel, customConfig: { baseURL: customBaseUrl, modelId: customModelId } })
      } catch (err) {
        setAiDebugger({ explanation: `Error during AI analysis: ${err.message}`, codeFix: '', loading: false })
      }
    }

    window.addEventListener('debug-postman-request', handleDebugPostman)
    return () => window.removeEventListener('debug-postman-request', handleDebugPostman)
  }, [activeFile, selectedModel, customBaseUrl, customModelId])

  // Reactive subscription so menu shortcuts re-render when user edits bindings.
  const customShortcuts = useShortcutStore(state => state.shortcuts)
  const formatShortcutById = (id, fallback) => {
    if (!id) return fallback
    for (const group of customShortcuts) {
      const item = group.items.find(i => i.id === id)
      if (item && item.keys && item.keys.length) return item.keys.join('+')
    }
    return fallback
  }

  // ── Workspace Search ──
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false)
  const [searchWholeWord, setSearchWholeWord] = useState(false)
  const [searchRegex, setSearchRegex] = useState(false)
  const [searchIncludeGlob, setSearchIncludeGlob] = useState('')
  const [searchExcludeGlob, setSearchExcludeGlob] = useState('')
  const [searchResults, setSearchResults] = useState([]) // [{ path, matches: [{ line, column, preview, matchLength }] }]
  const [searchStatus, setSearchStatus] = useState('idle') // 'idle' | 'searching' | 'done' | 'error'
  const [searchError, setSearchError] = useState(null)
  const [collapsedSearchFiles, setCollapsedSearchFiles] = useState({})
  const searchRunIdRef = useRef(0)

  // Simple glob → regex (supports *, **, ?). Empty string means "no filter".
  const globToRegex = (glob) => {
    if (!glob) return null
    // Split on commas so users can enter multiple patterns.
    const parts = glob.split(',').map(p => p.trim()).filter(Boolean)
    if (!parts.length) return null
    const escaped = parts.map(p => {
      let re = ''
      for (let i = 0; i < p.length; i++) {
        const c = p[i]
        if (c === '*') {
          if (p[i + 1] === '*') { re += '.*'; i++ } else { re += '[^/\\\\]*' }
        } else if (c === '?') { re += '[^/\\\\]' }
        else if ('.+^$(){}|[]\\'.includes(c)) { re += '\\' + c }
        else { re += c }
      }
      return re
    })
    // Match anywhere in the path.
    return new RegExp('(?:' + escaped.join('|') + ')', 'i')
  }

  const runWorkspaceSearch = async (query, opts) => {
    const runId = ++searchRunIdRef.current
    setSearchStatus('searching')
    setSearchError(null)
    setSearchResults([])
    setCollapsedSearchFiles({})

    if (!query) {
      setSearchStatus('idle')
      return
    }
    if (!projectRoot) {
      setSearchError('Open a folder to search in.')
      setSearchStatus('error')
      return
    }

    let pattern
    try {
      let source = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (opts.wholeWord) source = `\\b${source}\\b`
      pattern = new RegExp(source, opts.caseSensitive ? 'g' : 'gi')
    } catch (err) {
      setSearchError(`Invalid regex: ${err.message}`)
      setSearchStatus('error')
      return
    }

    let includeRe, excludeRe
    try {
      includeRe = globToRegex(opts.includeGlob)
      excludeRe = globToRegex(opts.excludeGlob)
    } catch (err) {
      setSearchError(`Invalid glob: ${err.message}`)
      setSearchStatus('error')
      return
    }

    // Default excludes so we don't waste cycles on node_modules and binaries.
    const defaultExcludes = /(?:^|[/\\])(?:node_modules|\.git|dist|out|build)(?:[/\\]|$)/
    const binaryExt = /\.(png|jpg|jpeg|gif|bmp|ico|svg|pdf|zip|tar|gz|rar|7z|exe|dll|so|dylib|class|jar|woff2?|ttf|eot|mp3|mp4|mov|avi|webm|wasm)$/i

    try {
      const allFiles = await window.api.getProjectTree(projectRoot)
      if (runId !== searchRunIdRef.current) return

      const filtered = (allFiles || []).filter(fp => {
        if (defaultExcludes.test(fp)) return false
        if (binaryExt.test(fp)) return false
        if (includeRe && !includeRe.test(fp)) return false
        if (excludeRe && excludeRe.test(fp)) return false
        return true
      })

      // Cap total files scanned so a huge repo doesn't lock up the renderer.
      const MAX_FILES = 2000
      const MAX_MATCHES_PER_FILE = 100
      const MAX_TOTAL_MATCHES = 5000
      const files = filtered.slice(0, MAX_FILES)

      const results = []
      let totalMatches = 0

      // Process in small chunks and yield to the event loop so the UI stays responsive.
      const CHUNK = 25
      for (let i = 0; i < files.length && totalMatches < MAX_TOTAL_MATCHES; i += CHUNK) {
        if (runId !== searchRunIdRef.current) return
        const slice = files.slice(i, i + CHUNK)
        const readResults = await Promise.all(slice.map(async (fp) => {
          try {
            const res = await window.api.getFileContents(fp)
            if (!res || !res.success || typeof res.content !== 'string') return null
            // Skip files that look binary (contain NUL bytes in the first chunk).
            if (res.content.indexOf('\u0000') !== -1) return null
            return { path: fp, content: res.content }
          } catch { return null }
        }))
        if (runId !== searchRunIdRef.current) return

        for (const r of readResults) {
          if (!r) continue
          const lines = r.content.split(/\r?\n/)
          const matches = []
          for (let ln = 0; ln < lines.length && matches.length < MAX_MATCHES_PER_FILE; ln++) {
            const line = lines[ln]
            pattern.lastIndex = 0
            let m
            while ((m = pattern.exec(line)) !== null) {
              if (m[0].length === 0) { pattern.lastIndex++; continue }
              matches.push({
                line: ln + 1,
                column: m.index + 1,
                matchLength: m[0].length,
                preview: line.length > 400 ? line.slice(0, 400) + '…' : line
              })
              if (matches.length >= MAX_MATCHES_PER_FILE) break
            }
          }
          if (matches.length) {
            results.push({ path: r.path, matches })
            totalMatches += matches.length
          }
        }
        // Stream partial results so the user sees hits as they arrive.
        setSearchResults([...results])
        // Yield to the event loop.
        await new Promise(res => setTimeout(res, 0))
      }

      if (runId !== searchRunIdRef.current) return
      setSearchStatus('done')
    } catch (err) {
      if (runId !== searchRunIdRef.current) return
      setSearchError(err.message || String(err))
      setSearchStatus('error')
    }
  }

  // Debounce searches while the user types.
  useEffect(() => {
    const q = searchQuery
    const opts = {
      caseSensitive: searchCaseSensitive,
      wholeWord: searchWholeWord,
      regex: searchRegex,
      includeGlob: searchIncludeGlob,
      excludeGlob: searchExcludeGlob
    }
    const handle = setTimeout(() => runWorkspaceSearch(q, opts), 300)
    return () => clearTimeout(handle)
  }, [searchQuery, searchCaseSensitive, searchWholeWord, searchRegex, searchIncludeGlob, searchExcludeGlob, projectRoot])

  const openSearchMatch = (path, match) => {
    const name = path.split(/[/\\]/).pop() || path
    handleOpenFile(path, name)
    // Give the editor a moment to mount / load content before revealing the line.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('jump-to-line', {
        detail: { path, line: match.line, column: match.column, matchLength: match.matchLength }
      }))
    }, 60)
  }

  const totalSearchMatches = searchResults.reduce((n, r) => n + r.matches.length, 0)

  return (
    <div className="ide-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      {/* ── Global Header ── */}
      <header className="global-title-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: '40px', background: 'var(--bg-activity)', borderBottom: '1px solid var(--border-base)', flexShrink: 0, userSelect: 'none', WebkitAppRegion: 'drag' }}>

        {/* Left Section */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '24px', WebkitAppRegion: 'no-drag' }}>
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--accent-color, #8b5cf6)', letterSpacing: '0.5px' }}>comπle</span>
          <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-muted)' }}>
            {[
              {
                name: 'File', items: [
                  {
                    label: 'New Text File', shortcutId: 'file.new', shortcut: 'Ctrl+N', action: () => {
                      const id = `untitled:Untitled-${Date.now()}`;
                      const name = `Untitled`;
                      setOpenFiles(prev => [...prev, { name, path: id }]);
                      setActiveFile(id);
                    }
                  },
                  { label: 'New File...', shortcut: 'Ctrl+Alt+Windows+N', action: () => window.dispatchEvent(new CustomEvent('create-new-file')) },
                  { label: 'New Window', shortcutId: 'file.newWindow', shortcut: 'Ctrl+Shift+N', action: () => window.api.newWindow && window.api.newWindow() },
                  { type: 'separator' },
                  {
                    label: 'Open File...', shortcutId: 'file.open', shortcut: 'Ctrl+O', action: async () => {
                      if (window.api.selectFile) {
                        const p = await window.api.selectFile();
                        if (p) {
                          const recents = JSON.parse(localStorage.getItem('recentFiles') || '[]');
                          if (!recents.includes(p)) localStorage.setItem('recentFiles', JSON.stringify([p, ...recents].slice(0, 5)));
                          handleOpenFile(p, p.split(/[/\\]/).pop());
                        }
                      }
                    }
                  },
                  {
                    label: 'Open Folder...', shortcutId: 'file.openFolder', shortcut: 'Ctrl+K Ctrl+O', action: async () => {
                      if (window.api.selectFolder) {
                        const p = await window.api.selectFolder();
                        if (p) {
                          const recents = JSON.parse(localStorage.getItem('recentFolders') || '[]');
                          if (!recents.includes(p)) localStorage.setItem('recentFolders', JSON.stringify([p, ...recents].slice(0, 5)));
                          setProjectRoot(p);
                        }
                      }
                    }
                  },
                  {
                    label: 'Open Workspace from File...', action: async () => {
                      if (window.api.selectFile) {
                        const p = await window.api.selectFile();
                        if (p) {
                          const recents = JSON.parse(localStorage.getItem('recentFolders') || '[]');
                          const dir = p.substring(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));
                          if (!recents.includes(dir)) localStorage.setItem('recentFolders', JSON.stringify([dir, ...recents].slice(0, 5)));
                          setProjectRoot(dir);
                        }
                      }
                    }
                  },
                  ...(JSON.parse(localStorage.getItem('recentFiles') || '[]').length > 0 ? [
                    { type: 'separator' },
                    ...JSON.parse(localStorage.getItem('recentFiles') || '[]').map(f => ({
                      label: `Recent File: ${f.split(/[/\\]/).pop()}`,
                      action: () => handleOpenFile(f, f.split(/[/\\]/).pop())
                    }))
                  ] : []),
                  ...(JSON.parse(localStorage.getItem('recentFolders') || '[]').length > 0 ? [
                    { type: 'separator' },
                    ...JSON.parse(localStorage.getItem('recentFolders') || '[]').map(f => ({
                      label: `Recent Folder: ${f.split(/[/\\]/).pop()}`,
                      action: () => setProjectRoot(f)
                    }))
                  ] : []),
                  { type: 'separator' },
                  { label: `Auto Save ${autoSave ? '✓' : ''}`, action: () => setAutoSave(!autoSave) },
                  { label: 'Save', shortcutId: 'file.save', shortcut: 'Ctrl+S', action: () => saveActiveFile() },
                  { label: 'Save As...', shortcutId: 'file.saveAs', shortcut: 'Ctrl+Shift+S', action: () => saveActiveFile() },
                  { label: 'Save All', shortcutId: 'file.saveAll', shortcut: 'Ctrl+K S', action: () => saveActiveFile() },
                  { type: 'separator' },
                  { label: 'Close Editor', shortcutId: 'file.close', shortcut: 'Ctrl+F4', action: () => activeFile ? closeFile(activeFile) : null },
                  { label: 'Close Folder', shortcut: 'Ctrl+K F', action: () => setProjectRoot(null) },
                  { label: 'Close Window', shortcutId: 'general.closeWindow', shortcut: 'Alt+F4', action: () => window.close() },
                  { type: 'separator' },
                  { label: 'Exit', action: () => window.close() }
                ]
              },
              {
                name: 'Edit', items: [
                  { label: 'Undo', shortcutId: 'edit.undo', shortcut: 'Ctrl+Z', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'undo' })) },
                  { label: 'Redo', shortcutId: 'edit.redo', shortcut: 'Ctrl+Y', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'redo' })) },
                  { type: 'separator' },
                  { label: 'Cut', shortcutId: 'edit.cut', shortcut: 'Ctrl+X', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.clipboardCutAction' })) },
                  { label: 'Copy', shortcutId: 'edit.copy', shortcut: 'Ctrl+C', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.clipboardCopyAction' })) },
                  { label: 'Paste', shortcutId: 'edit.paste', shortcut: 'Ctrl+V', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.clipboardPasteAction' })) },
                  { type: 'separator' },
                  { label: 'Find', shortcutId: 'edit.find', shortcut: 'Ctrl+F', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'actions.find' })) },
                  { label: 'Replace', shortcutId: 'edit.replace', shortcut: 'Ctrl+H', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.startFindReplaceAction' })) },
                  { type: 'separator' },
                  { label: 'Find in Files', shortcutId: 'edit.findInFiles', shortcut: 'Ctrl+Shift+F', action: () => setActivePanel('search') },
                  { label: 'Replace in Files', shortcut: 'Ctrl+Shift+H', action: () => setActivePanel('search') },
                  { type: 'separator' },
                  { label: 'Toggle Line Comment', shortcutId: 'edit.commentLine', shortcut: 'Ctrl+/', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.commentLine' })) },
                  { label: 'Toggle Block Comment', shortcut: 'Shift+Alt+A', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.blockComment' })) },
                  { label: 'Emmet: Expand Abbreviation', shortcut: 'Tab', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.emmet.action.expandAbbreviation' })) }
                ]
              },
              {
                name: 'Selection', items: [
                  { label: 'Select All', shortcutId: 'edit.selectAll', shortcut: 'Ctrl+A', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.selectAll' })) },
                  { label: 'Expand Selection', shortcut: 'Shift+Alt+RightArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.smartSelect.expand' })) },
                  { label: 'Shrink Selection', shortcut: 'Shift+Alt+LeftArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.smartSelect.shrink' })) },
                  { type: 'separator' },
                  { label: 'Copy Line Up', shortcut: 'Shift+Alt+UpArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.copyLinesUpAction' })) },
                  { label: 'Copy Line Down', shortcut: 'Shift+Alt+DownArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.copyLinesDownAction' })) },
                  { label: 'Move Line Up', shortcutId: 'edit.moveLineUp', shortcut: 'Alt+UpArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.moveLinesUpAction' })) },
                  { label: 'Move Line Down', shortcutId: 'edit.moveLineDown', shortcut: 'Alt+DownArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.moveLinesDownAction' })) },
                  { label: 'Duplicate Selection', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.duplicateSelection' })) },
                  { type: 'separator' },
                  { label: 'Add Cursor Above', shortcut: 'Ctrl+Alt+UpArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.insertCursorAbove' })) },
                  { label: 'Add Cursor Below', shortcut: 'Ctrl+Alt+DownArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.insertCursorBelow' })) },
                  { label: 'Add Cursors to Line Ends', shortcut: 'Shift+Alt+I', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.insertCursorAtEndOfEachLineSelected' })) },
                  { label: 'Add Next Occurrence', shortcutId: 'editor.action.addSelectionToNextFindMatch', shortcut: 'Ctrl+D', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.addSelectionToNextFindMatch' })) },
                  { label: 'Add Previous Occurrence', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.addSelectionToPreviousFindMatch' })) },
                  { label: 'Select All Occurrences', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.selectHighlights' })) },
                  { type: 'separator' },
                  { label: 'Switch to Ctrl+Click for Multi-Cursor', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.toggleMultiCursorModifier' })) },
                  { label: 'Column Selection Mode', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.toggleColumnSelection' })) }
                ]
              },
              {
                name: 'View', items: [
                  { label: 'Command Palette...', shortcutId: 'general.commandPalette', shortcut: 'Ctrl+Shift+P', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.quickCommand' })) },
                  { label: 'Open View...', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.quickCommand' })) },
                  { type: 'separator' },
                  {
                    label: 'Appearance', hasSubmenu: true, submenu: [
                      { label: 'Full Screen', shortcutId: 'general.fullscreen', shortcut: 'F11', action: () => { if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(() => { }); } else { document.exitFullscreen(); } } },
                      { label: 'Zen Mode', action: () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { }); setActivePanel(null); setShowTerminal(false); } },
                      { type: 'separator' },
                      { label: 'Primary Side Bar', action: () => setActivePanel(activePanel === 'explorer' ? null : 'explorer') },
                      { label: 'Panel', action: () => setShowTerminal(!showTerminal) }
                    ]
                  },
                  {
                    label: 'Editor Layout', hasSubmenu: true, submenu: [
                      {
                        label: 'Split Right', action: () => {
                          const newId = Date.now().toString();
                          setEditorGroups(prev => {
                            const activeGroup = prev.find(g => g.id === activeEditorGroupId) || prev[0];
                            const newGroup = { id: newId, openFiles: activeGroup.openFiles, activeFile: activeGroup.activeFile, fileContents: activeGroup.fileContents };
                            return [...prev, newGroup];
                          });
                          setActiveEditorGroupId(newId);
                        }
                      },
                      { type: 'separator' },
                      {
                        label: 'Single', action: () => {
                          setEditorGroups(prev => {
                            const activeGroup = prev.find(g => g.id === activeEditorGroupId) || prev[0];
                            return [activeGroup];
                          });
                        }
                      },
                      {
                        label: 'Two Columns', action: () => {
                          setEditorGroups(prev => {
                            if (prev.length >= 2) return prev.slice(0, 2);
                            const activeGroup = prev[0];
                            return [activeGroup, { id: Date.now().toString(), openFiles: activeGroup.openFiles, activeFile: activeGroup.activeFile, fileContents: activeGroup.fileContents }];
                          });
                        }
                      },
                      {
                        label: 'Three Columns', action: () => {
                          setEditorGroups(prev => {
                            if (prev.length >= 3) return prev.slice(0, 3);
                            let newGroups = [...prev];
                            while (newGroups.length < 3) {
                              newGroups.push({ id: Date.now().toString() + Math.random(), openFiles: newGroups[0].openFiles, activeFile: newGroups[0].activeFile, fileContents: newGroups[0].fileContents });
                            }
                            return newGroups;
                          });
                        }
                      }
                    ]
                  },
                  { type: 'separator' },
                  { label: 'Explorer', shortcutId: 'nav.focusExplorer', shortcut: 'Ctrl+Shift+E', action: () => setActivePanel('explorer') },
                  { label: 'Search', shortcut: 'Ctrl+Shift+F', action: () => setActivePanel('search') },
                  { label: 'Source Control', shortcut: 'Ctrl+Shift+G', action: () => setActivePanel('git') },
                  { label: 'Run', shortcut: 'Ctrl+Shift+D', action: () => setActivePanel('debug') },
                  { label: 'Extensions', shortcutId: 'general.extensions', shortcut: 'Ctrl+Shift+X', action: () => setActivePanel('extensions') },
                  { type: 'separator' },
                  { label: 'Problems', shortcut: 'Ctrl+Shift+M', action: () => { setShowTerminal(true); setBottomTab('ai-debugger'); } },
                  { label: 'Output', shortcut: 'Ctrl+Shift+U', action: () => { setShowTerminal(true); setBottomTab('terminal'); } },
                  { label: 'Debug Console', shortcut: 'Ctrl+Shift+Y', action: () => { setShowTerminal(true); setBottomTab('debugger-history'); } },
                  { label: 'Terminal', shortcutId: 'nav.focusTerminal', shortcut: 'Ctrl+`', action: () => { setShowTerminal(true); setBottomTab('terminal'); } },
                  { type: 'separator' },
                  { label: 'Word Wrap', shortcut: 'Alt+Z', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.toggleWordWrap' })) }
                ]
              },
              {
                name: 'Go', items: [
                  { label: 'Back', shortcutId: 'nav.goBack', shortcut: 'Alt+LeftArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'cursorUndo' })) },
                  { label: 'Forward', shortcutId: 'nav.goForward', shortcut: 'Alt+RightArrow', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'cursorRedo' })) },
                  { type: 'separator' },
                  { label: 'Go to File...', shortcutId: 'nav.goToFile', shortcut: 'Ctrl+P', action: () => setActivePanel('search') },
                  { type: 'separator' },
                  { label: 'Go to Symbol in Editor...', shortcut: 'Ctrl+Shift+O', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.quickOutline' })) },
                  { label: 'Go to Definition', shortcutId: 'nav.goToDef', shortcut: 'F12', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.revealDefinition' })) },
                  { label: 'Go to Declaration', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.revealDeclaration' })) },
                  { label: 'Go to Type Definition', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.goToTypeDefinition' })) },
                  { label: 'Go to Implementations', shortcut: 'Ctrl+F12', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.goToImplementation' })) },
                  { label: 'Go to References', shortcutId: 'nav.goToRef', shortcut: 'Shift+F12', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.referenceSearch.trigger' })) },
                  { type: 'separator' },
                  { label: 'Go to Line/Column...', shortcutId: 'nav.goToLine', shortcut: 'Ctrl+G', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.gotoLine' })) },
                  { label: 'Go to Bracket', shortcut: 'Ctrl+Shift+\\', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.jumpToBracket' })) },
                  { type: 'separator' },
                  { label: 'Next Problem', shortcut: 'F8', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.marker.next' })) },
                  { label: 'Previous Problem', shortcut: 'Shift+F8', action: () => window.dispatchEvent(new CustomEvent('editor-action', { detail: 'editor.action.marker.prev' })) }
                ]
              },
              {
                name: 'Run', items: [
                  { label: 'Start Debugging', shortcutId: 'debug.start', shortcut: 'F5', action: () => { setActivePanel('debug'); setTimeout(() => window.dispatchEvent(new CustomEvent('start-debugging')), 50); } },
                  { label: 'Run Without Debugging', shortcut: 'Ctrl+F5', action: () => runFileRef.current && runFileRef.current() },
                  { label: 'Stop Debugging', shortcutId: 'debug.stop', shortcut: 'Shift+F5', action: () => { setActivePanel('debug'); if (window.api && window.api.dapStop) { window.api.dapStop(); window.dispatchEvent(new Event('dap-stop')); } } },
                  { type: 'separator' },
                  { label: 'Step Over', shortcutId: 'debug.stepOver', shortcut: 'F10', action: () => { setActivePanel('debug'); if (window.api && window.api.dapStep) window.api.dapStep() } },
                  { label: 'Continue', shortcutId: 'debug.start', shortcut: 'F5', action: () => { setActivePanel('debug'); if (window.api && window.api.dapContinue) { window.api.dapContinue(); window.dispatchEvent(new Event('dap-continue')); } } }
                ]
              },
              {
                name: 'Terminal', items: [
                  { label: 'New Terminal', shortcutId: 'general.terminal', shortcut: 'Ctrl+Shift+`', action: () => { setShowTerminal(true); handleAddTerminal(); } },
                  { label: 'Split Terminal', shortcut: 'Ctrl+Shift+5', action: () => { setShowTerminal(true); handleAddTerminal(); } },
                  { type: 'separator' },
                  { label: 'Run Active File', action: () => runFileRef.current && runFileRef.current() },
                  { label: 'Run Build Task...', shortcut: 'Ctrl+Shift+B', action: () => window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: 'Build task started...', type: 'info' } })) },
                  { type: 'separator' },
                  { label: 'Reset Terminals', action: () => { setTerminals([{ id: 'default', name: 'bash' }]); setActiveTerminalId('default'); window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: 'Terminals reset!', type: 'success' } })); } },
                  {
                    label: 'Sync Dependencies (npm install)', action: () => {
                      setShowTerminal(true);
                      const term = terminalPanelRefs.current[activeTerminalId];
                      if (term) term.executeCommand('npm install\r');
                    }
                  },
                  {
                    label: 'Start Dev Server (npm run dev)', action: () => {
                      setShowTerminal(true);
                      const term = terminalPanelRefs.current[activeTerminalId];
                      if (term) term.executeCommand('npm run dev\r');
                    }
                  }
                ]
              },
              {
                name: 'Help', items: [
                  { label: 'Toggle Developer Tools', action: () => { if (window.api && window.api.toggleDevTools) window.api.toggleDevTools() } },
                  { type: 'separator' },
                  { label: 'Check for Updates...', action: () => window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: 'comπle is up to date.', type: 'success' } })) },
                  { type: 'separator' },
                  { label: 'About comπle', action: () => window.open('https://kartikchawla.in', '_blank') }
                ]
              }
            ].map((menu) => (
              <div key={menu.name} style={{ position: 'relative' }}>
                <span
                  style={{ cursor: 'pointer', WebkitAppRegion: 'no-drag', color: activeMenu === menu.name ? 'var(--text-primary)' : 'inherit' }}
                  className="menu-item"
                  onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === menu.name ? null : menu.name) }}
                >
                  {menu.name}
                </span>
                {activeMenu === menu.name && (
                  <div style={{
                    position: 'absolute', top: '24px', left: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border-base)',
                    borderRadius: '6px', padding: '6px 0', minWidth: '300px', zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                    display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap'
                  }} onClick={(e) => e.stopPropagation()}>
                    {menu.items.map((item, idx) => (
                      item.type === 'separator' ? (
                        <div key={idx} onMouseEnter={() => setActiveSubmenu(null)} style={{ height: '1px', background: 'var(--border-base)', margin: '4px 0' }} />
                      ) : (
                        <div key={idx} className="submenu-item"
                          style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px' }}
                          onMouseEnter={() => { if (item.hasSubmenu) setActiveSubmenu(idx); else setActiveSubmenu(null); }}
                          onClick={() => { if (!item.hasSubmenu) { setActiveMenu(null); setActiveSubmenu(null); if (item.action) item.action() } }}
                        >
                          <span>{item.label}</span>
                          {(item.shortcutId || item.shortcut) && <span style={{ opacity: 0.5, fontSize: '11px', letterSpacing: '0.2px', marginLeft: 'auto' }}>{formatShortcutById(item.shortcutId, item.shortcut)}</span>}
                          {item.hasSubmenu && <ChevronRight size={14} style={{ opacity: 0.6, marginLeft: 'auto' }} />}

                          {item.hasSubmenu && activeSubmenu === idx && (
                            <div style={{
                              position: 'absolute', top: '-6px', left: '100%', marginLeft: '4px', background: 'var(--bg-elevated)',
                              border: '1px solid var(--border-base)', borderRadius: '6px', padding: '6px 0', minWidth: '200px',
                              zIndex: 10000, boxShadow: '0 8px 24px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column'
                            }} onClick={(e) => e.stopPropagation()}>
                              {item.submenu.map((sub, subIdx) => (
                                sub.type === 'separator' ? (
                                  <div key={subIdx} style={{ height: '1px', background: 'var(--border-base)', margin: '4px 0' }} />
                                ) : (
                                  <div key={subIdx} className="submenu-item"
                                    onClick={() => { setActiveSubmenu(null); setActiveMenu(null); if (sub.action) sub.action() }}
                                  >
                                    <span>{sub.label}</span>
                                    {(sub.shortcutId || sub.shortcut) && <span style={{ opacity: 0.6, fontSize: '11px', letterSpacing: '0.2px' }}>{formatShortcutById(sub.shortcutId, sub.shortcut)}</span>}
                                  </div>
                                )
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Center Section */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', WebkitAppRegion: 'no-drag' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {activeFile ? activeFile.split(/[/\\]/).pop() : (projectRoot ? projectRoot.split(/[/\\]/).pop() : 'comπle')}
          </span>
        </div>

        {/* Right Section */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', WebkitAppRegion: 'no-drag' }}>
          <div style={{ display: 'flex', gap: '4px', color: 'var(--text-muted)', marginRight: '8px' }}>
            <div onClick={() => setActivePanel(activePanel === 'explorer' ? null : 'explorer')} style={{ padding: '4px', borderRadius: '4px', cursor: 'pointer', display: 'flex', background: activePanel === 'explorer' ? 'var(--bg-dark)' : 'transparent' }} title="Toggle Sidebar"><PanelLeft size={14} /></div>
            <div onClick={() => setShowTerminal(!showTerminal)} style={{ padding: '4px', borderRadius: '4px', cursor: 'pointer', display: 'flex', background: showTerminal ? 'var(--bg-dark)' : 'transparent' }} title="Toggle Terminal"><PanelBottom size={14} /></div>
            <div onClick={() => setRightPanel(rightPanel === 'chat' ? null : 'chat')} style={{ padding: '4px', borderRadius: '4px', cursor: 'pointer', display: 'flex', background: rightPanel === 'chat' ? 'var(--bg-dark)' : 'transparent' }} title="Toggle AI Agent"><PanelRight size={14} /></div>
          </div>
          <div className="model-selector-wrapper" style={{ marginRight: '8px' }}>
            <select
              id="model-selector"
              className="model-selector"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isStreaming}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '11px', outline: 'none', cursor: 'pointer', maxWidth: '120px', textOverflow: 'ellipsis' }}
              title="Select Model"
            >
              {MODEL_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.models.map((m) => (
                    <option
                      key={m.id}
                      value={m.id}
                      disabled={m.provider && !providerKeys[m.provider]?.exists}
                    >
                      {m.id === 'custom' ? (customName || 'Custom') : m.name}
                      {m.badge ? ` (${m.badge})` : ''}
                      {m.provider && !providerKeys[m.provider]?.exists ? ' (Missing Key)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '16px', color: 'var(--text-muted)', alignItems: 'center' }}>
            <Settings size={16} style={{ cursor: 'pointer' }} onClick={() => { window.dispatchEvent(new CustomEvent('open-settings', { detail: 'ai-agent' })); handleOpenFile('settings:main', 'Settings'); }} title="Settings" />
          </div>

          <button
            onClick={() => setRightPanel(rightPanel === 'chat' ? null : 'chat')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: rightPanel === 'chat' ? 'var(--bg-dark)' : 'transparent',
              color: rightPanel === 'chat' ? 'var(--accent-color, #8b5cf6)' : 'var(--text-muted)',
              border: `1px solid ${rightPanel === 'chat' ? 'var(--accent-color, #8b5cf6)' : 'var(--border-base)'}`,
              padding: '4px 10px', borderRadius: '6px', fontSize: '11px',
              fontWeight: '500', cursor: 'pointer', WebkitAppRegion: 'no-drag',
              transition: 'all 0.2s'
            }}
            title="Toggle AI Agent"
          >
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: rightPanel === 'chat' ? 'var(--accent-color, #8b5cf6)' : 'var(--text-muted)' }} />
            AI Agent
          </button>

          <div style={{ display: 'flex', gap: '12px', color: 'var(--text-muted)', alignItems: 'center', marginLeft: '12px', WebkitAppRegion: 'no-drag' }}>
            <div style={{ padding: '4px 8px', cursor: 'pointer', display: 'flex', borderRadius: '4px', transition: 'all 0.1s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(128, 128, 128, 0.2)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'} onClick={() => window.api?.minimizeWindow?.()} title="Minimize"><Minus size={16} /></div>
            <div style={{ padding: '4px 8px', cursor: 'pointer', display: 'flex', borderRadius: '4px', transition: 'all 0.1s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(128, 128, 128, 0.2)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'} onClick={() => window.api?.maximizeWindow?.()} title="Maximize"><Square size={14} /></div>
            <div style={{ padding: '4px 8px', cursor: 'pointer', display: 'flex', borderRadius: '4px', transition: 'all 0.1s', color: 'inherit' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e81123'; e.currentTarget.style.color = '#fff' }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'inherit' }} onClick={() => window.api?.closeWindow?.()} title="Close"><X size={16} /></div>
          </div>
        </div>
      </header>

      <div className="ide-layout" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Activity Bar (VS Code style) ── */}
        <ActivityBar
          projectRoot={projectRoot}
          onShowVisualizer={() => setShowVisualizer(true)}
          onShowDsaExplainer={() => setDsaExplainer({ code: '', language: 'javascript' })}
          onOpenFile={handleOpenFile}
        />

        {/* ── Sidebar (File Explorer / Extensions / Search / Source Control) ── */}
        <div style={{ display: 'flex', height: '100%', borderRight: '1px solid var(--border-base)' }}>
          {activePanel === 'auth' && (
            <AuthPanel width={sidebarWidth} />
          )}

          {activePanel === 'explorer' && (
            <Sidebar
              projectRoot={projectRoot}
              setProjectRoot={setProjectRoot}
              onOpenFile={handleOpenFile}
              width={sidebarWidth}
              setShowVisualizer={setShowVisualizer}
            />
          )}

          {activePanel === 'extensions' && (
            <ExtensionsPanel
              width={sidebarWidth}
              onOpenExtension={handleOpenExtension}
            />
          )}

          {activePanel === 'debug' && (
            <div style={{ width: sidebarWidth, borderRight: '1px solid var(--border-base)', overflow: 'hidden' }}>
              <DebugPanel activeFile={activeFile} />
            </div>
          )}

          {activePanel === 'git' && (
            <SourceControlPanel
              projectRoot={projectRoot}
              width={sidebarWidth}
              onOpenFile={handleOpenFile}
            />
          )}

          {activePanel === 'docker' && (
            <DockerPanel width={sidebarWidth} />
          )}

          {activePanel === 'k8s' && (
            <KubernetesPanel width={sidebarWidth} />
          )}

          {activePanel === 'projects' && (
            <ProjectManagerPanel
              width={sidebarWidth}
              setProjectRoot={setProjectRoot}
              projectRoot={projectRoot}
            />
          )}

          {activePanel === 'search' && (
            <aside className="sidebar search-panel" style={{ width: sidebarWidth, display: 'flex', flexDirection: 'column' }}>
              <div className="sidebar-header">
                <h2>SEARCH</h2>
              </div>
              <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px', borderBottom: '1px solid var(--border-base)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div className="search-input-wrapper" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-dark)', border: '1px solid var(--border-base)', borderRadius: '4px', padding: '4px 6px' }}>
                    <Search size={14} className="search-icon" style={{ opacity: 0.6 }} />
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '13px' }}
                    />
                    {searchQuery && (
                      <X size={14} style={{ cursor: 'pointer', opacity: 0.6 }} onClick={() => setSearchQuery('')} title="Clear" />
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => setSearchCaseSensitive(v => !v)}
                    title="Match Case"
                    style={{ background: searchCaseSensitive ? 'var(--accent-active, #094771)' : 'transparent', border: '1px solid var(--border-base)', borderRadius: '3px', color: 'var(--text-primary)', padding: '2px 6px', cursor: 'pointer', fontSize: '11px', fontFamily: 'monospace' }}
                  >Aa</button>
                  <button
                    onClick={() => setSearchWholeWord(v => !v)}
                    title="Match Whole Word"
                    style={{ background: searchWholeWord ? 'var(--accent-active, #094771)' : 'transparent', border: '1px solid var(--border-base)', borderRadius: '3px', color: 'var(--text-primary)', padding: '2px 6px', cursor: 'pointer', fontSize: '11px', fontFamily: 'monospace' }}
                  >\b</button>
                  <button
                    onClick={() => setSearchRegex(v => !v)}
                    title="Use Regular Expression"
                    style={{ background: searchRegex ? 'var(--accent-active, #094771)' : 'transparent', border: '1px solid var(--border-base)', borderRadius: '3px', color: 'var(--text-primary)', padding: '2px 6px', cursor: 'pointer', fontSize: '11px', fontFamily: 'monospace' }}
                  >.*</button>
                </div>
                <input
                  type="text"
                  placeholder="files to include (e.g. *.js, src/**)"
                  value={searchIncludeGlob}
                  onChange={(e) => setSearchIncludeGlob(e.target.value)}
                  style={{ background: 'var(--bg-dark)', border: '1px solid var(--border-base)', borderRadius: '4px', padding: '4px 6px', color: 'var(--text-primary)', fontSize: '12px', outline: 'none' }}
                />
                <input
                  type="text"
                  placeholder="files to exclude"
                  value={searchExcludeGlob}
                  onChange={(e) => setSearchExcludeGlob(e.target.value)}
                  style={{ background: 'var(--bg-dark)', border: '1px solid var(--border-base)', borderRadius: '4px', padding: '4px 6px', color: 'var(--text-primary)', fontSize: '12px', outline: 'none' }}
                />
              </div>

              <div style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-base)', minHeight: '22px' }}>
                {!projectRoot && 'Open a folder to search.'}
                {projectRoot && searchStatus === 'idle' && !searchQuery && 'Type to search across the workspace.'}
                {projectRoot && searchStatus === 'searching' && `Searching… ${totalSearchMatches} matches so far`}
                {projectRoot && searchStatus === 'done' && (
                  totalSearchMatches === 0
                    ? 'No results.'
                    : `${totalSearchMatches} result${totalSearchMatches === 1 ? '' : 's'} in ${searchResults.length} file${searchResults.length === 1 ? '' : 's'}`
                )}
                {searchStatus === 'error' && (
                  <span style={{ color: 'var(--error, #f48771)' }}>{searchError}</span>
                )}
              </div>

              <div className="sidebar-content" style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
                {searchResults.map(fileResult => {
                  const collapsed = !!collapsedSearchFiles[fileResult.path]
                  const parts = fileResult.path.split(/[/\\]/)
                  const name = parts[parts.length - 1] || fileResult.path
                  let dir = ''
                  if (projectRoot && fileResult.path.startsWith(projectRoot)) {
                    const rel = fileResult.path.substring(projectRoot.length).replace(/^[/\\]/, '')
                    const relParts = rel.split(/[/\\]/)
                    relParts.pop()
                    dir = relParts.join('/')
                  }
                  return (
                    <div key={fileResult.path}>
                      <div
                        onClick={() => setCollapsedSearchFiles(prev => ({ ...prev, [fileResult.path]: !collapsed }))}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 12px', cursor: 'pointer', userSelect: 'none' }}
                        title={fileResult.path}
                      >
                        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <File size={12} style={{ opacity: 0.7 }} />
                        <span style={{ fontSize: '13px' }}>{name}</span>
                        {dir && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dir}</span>}
                        <span style={{ marginLeft: 'auto', fontSize: '11px', background: 'var(--bg-dark)', borderRadius: '10px', padding: '0 6px', color: 'var(--text-muted)' }}>{fileResult.matches.length}</span>
                      </div>
                      {!collapsed && fileResult.matches.map((m, idx) => {
                        const before = m.preview.substring(0, m.column - 1)
                        const hit = m.preview.substring(m.column - 1, m.column - 1 + m.matchLength)
                        const after = m.preview.substring(m.column - 1 + m.matchLength)
                        return (
                          <div
                            key={idx}
                            onClick={() => openSearchMatch(fileResult.path, m)}
                            className="search-match-row"
                            style={{ padding: '2px 12px 2px 32px', cursor: 'pointer', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-muted)' }}
                            title={`Line ${m.line}, col ${m.column}`}
                          >
                            <span style={{ opacity: 0.5, marginRight: '6px' }}>{m.line}:</span>
                            <span>{before}</span>
                            <span style={{ background: 'var(--accent-search, #613214)', color: 'var(--text-primary)', borderRadius: '2px' }}>{hit}</span>
                            <span>{after}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </aside>
          )}



          {activePanel && (
            <Resizer
              orientation="vertical"
              onResize={(x) => setSidebarWidth(Math.max(150, Math.min(x - 48, 600)))}
            />
          )}
        </div>

        {/* ── Main Area ── */}
        <div className="main-area">

          {/* ── Content Split Area ── */}
          <div className="content-split">
            <div className="editor-pane" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
                {editorGroups.map((group, index) => {
                  const scopedSetOpenFiles = (updater) => {
                    setEditorGroups(prev => {
                      const idx = prev.findIndex(g => g.id === group.id)
                      if (idx === -1) return prev
                      const newGroups = [...prev]
                      const next = typeof updater === 'function' ? updater(prev[idx].openFiles) : updater
                      newGroups[idx] = { ...prev[idx], openFiles: next }
                      return newGroups
                    })
                  }
                  const scopedSetActiveFile = (updater) => {
                    setEditorGroups(prev => {
                      const idx = prev.findIndex(g => g.id === group.id)
                      if (idx === -1) return prev
                      const newGroups = [...prev]
                      const next = typeof updater === 'function' ? updater(prev[idx].activeFile) : updater
                      newGroups[idx] = { ...prev[idx], activeFile: next }
                      return newGroups
                    })
                  }
                  const scopedCloseFile = (path) => {
                    setEditorGroups(prev => {
                      const idx = prev.findIndex(g => g.id === group.id)
                      if (idx === -1) return prev
                      const newGroups = [...prev]

                      const fileToClose = newGroups[idx].openFiles.find(f => f.path === path)
                      const newFiles = newGroups[idx].openFiles.filter(f => f.path !== path)
                      let newActive = newGroups[idx].activeFile
                      if (newActive === path) {
                        newActive = newFiles.length > 0 ? newFiles[newFiles.length - 1].path : null
                      }

                      const newClosedFiles = [...(newGroups[idx].closedFiles || []), fileToClose].filter(Boolean)

                      newGroups[idx] = {
                        ...newGroups[idx],
                        openFiles: newFiles,
                        activeFile: newActive,
                        closedFiles: newClosedFiles
                      }
                      return newGroups
                    })
                  }
                  const scopedMarkFileDirty = (path) => {
                    setEditorGroups(prev => {
                      const idx = prev.findIndex(g => g.id === group.id)
                      if (idx === -1) return prev
                      const newGroups = [...prev]
                      newGroups[idx].openFiles = newGroups[idx].openFiles.map(f => f.path === path ? { ...f, isDirty: true } : f)
                      return newGroups
                    })
                  }
                  const scopedMarkFileClean = (path) => {
                    setEditorGroups(prev => {
                      const idx = prev.findIndex(g => g.id === group.id)
                      if (idx === -1) return prev
                      const newGroups = [...prev]
                      newGroups[idx].openFiles = newGroups[idx].openFiles.map(f => f.path === path ? { ...f, isDirty: false } : f)
                      return newGroups
                    })
                  }

                  const handleSplitRight = () => {
                    const newId = 'group-' + Date.now()
                    setEditorGroups(prev => [
                      ...prev,
                      { id: newId, openFiles: [...group.openFiles], activeFile: group.activeFile }
                    ])
                    setActiveEditorGroupId(newId)
                  }

                  const handleCloseGroup = () => {
                    setEditorGroups(prev => {
                      const filtered = prev.filter(g => g.id !== group.id)
                      if (filtered.length === 0) return prev // keep at least one
                      if (activeEditorGroupId === group.id) {
                        setActiveEditorGroupId(filtered[0].id)
                      }
                      return filtered
                    })
                  }

                  return (
                    <React.Fragment key={group.id}>
                      {index > 0 && <div style={{ width: '1px', background: 'var(--border-base)', zIndex: 10 }} />}
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          position: 'relative',
                          display: 'flex',
                          flexDirection: 'column',
                          border: activeEditorGroupId === group.id && editorGroups.length > 1 ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent'
                        }}
                        onMouseDownCapture={() => setActiveEditorGroupId(group.id)}
                      >
                        <ErrorBoundary>
                          <CodeEditor
                            groupId={group.id}
                            openFiles={group.openFiles}
                            setOpenFiles={scopedSetOpenFiles}
                            activeFile={group.activeFile}
                            setActiveFile={scopedSetActiveFile}
                            closeFile={scopedCloseFile}
                            markFileDirty={scopedMarkFileDirty}
                            markFileClean={scopedMarkFileClean}
                            projectRoot={projectRoot}
                            aiConfig={{
                              model: selectedModel,
                              customConfig: { baseURL: customBaseUrl, modelId: customModelId },
                              autoCompleteEnabled,
                              autoCompleteDelay
                            }}
                            onRun={handleRunFile}
                            onSplitRight={handleSplitRight}
                            onCloseGroup={editorGroups.length > 1 ? handleCloseGroup : undefined}
                          />
                        </ErrorBoundary>
                      </div>
                    </React.Fragment>
                  )
                })}
              </div>
              {showTerminal && (
                <div className="bottom-panel" style={{ height: terminalHeight, display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', borderTop: '1px solid var(--border-base)', position: 'relative', boxShadow: '0 -4px 15px rgba(0,0,0,0.1)' }}>
                  <div style={{ position: 'absolute', top: -3, left: 0, right: 0, zIndex: 10, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ position: 'absolute', width: '100%', height: '100%' }}>
                      <Resizer
                        orientation="horizontal"
                        onResize={(_, y) => setTerminalHeight(Math.max(100, Math.min(window.innerHeight - y - 24, window.innerHeight - 150)))}
                      />
                    </div>
                    <div style={{ width: '40px', height: '4px', background: 'rgba(255,255,255,0.2)', borderRadius: '2px', marginTop: '-2px', pointerEvents: 'none', zIndex: 11 }} />
                  </div>

                  <div className="bottom-tabs" style={{ display: 'flex', padding: '0 16px', background: 'var(--bg-activity)', borderBottom: '1px solid var(--border-base)', alignItems: 'center', height: '35px', gap: '8px', overflowX: 'auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '6px' }}>
                      {terminals.map(term => (
                        <div
                          key={term.id}
                          onClick={() => {
                            setActiveTerminalId(term.id)
                            setBottomTab('terminal')
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            background: bottomTab === 'terminal' && activeTerminalId === term.id ? 'var(--bg-surface)' : 'transparent',
                            color: bottomTab === 'terminal' && activeTerminalId === term.id ? 'var(--text-primary)' : 'var(--text-muted)',
                            padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: '500'
                          }}
                        >
                          {term.name}
                          {terminals.length > 1 && (
                            <X size={12} onClick={(e) => handleKillTerminal(term.id, e)} style={{ opacity: 0.6, cursor: 'pointer' }} />
                          )}
                        </div>
                      ))}
                      <button
                        onClick={handleAddTerminal}
                        style={{ background: 'transparent', color: 'var(--text-muted)', border: 'none', padding: '4px 8px', cursor: 'pointer', fontSize: '14px' }}
                      >
                        +
                      </button>
                    </div>
                    <div style={{ width: '1px', height: '16px', background: 'var(--border-base)', margin: '0 8px' }}></div>
                    <button
                      onClick={() => setBottomTab('ai-debugger')}
                      style={{ background: bottomTab === 'ai-debugger' ? 'var(--bg-surface)' : 'transparent', color: bottomTab === 'ai-debugger' ? 'var(--text-primary)' : 'var(--text-muted)', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                    >
                      AI Debugger
                    </button>
                    <button
                      onClick={() => setBottomTab('debugger-history')}
                      style={{ background: bottomTab === 'debugger-history' ? 'var(--bg-surface)' : 'transparent', color: bottomTab === 'debugger-history' ? 'var(--text-primary)' : 'var(--text-muted)', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                    >
                      Debugger History
                    </button>
                    <div style={{ flex: 1 }}></div>
                    <button
                      onClick={handleFixWithAi}
                      disabled={aiDebugger.loading || isStreaming}
                      style={{ background: 'var(--accent-color)', color: 'var(--accent-text)', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                    >
                      ✨ Fix with AI
                    </button>
                  </div>

                  <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    {terminals.map(term => {
                      const isVisible = bottomTab === 'terminal' && activeTerminalId === term.id
                      return (
                        <div key={term.id} style={{ position: 'absolute', inset: 0, opacity: isVisible ? 1 : 0, pointerEvents: isVisible ? 'auto' : 'none', zIndex: isVisible ? 1 : 0 }}>
                          <TerminalPanel ref={el => terminalPanelRefs.current[term.id] = el} height={terminalHeight - 36} cwd={projectRoot} hideHeader={true} />
                        </div>
                      )
                    })}

                    {bottomTab === 'ai-debugger' && (
                      <div className="ai-debugger-panel" style={{ position: 'absolute', inset: 0, zIndex: 2, padding: '16px', background: 'var(--bg-deep)', display: 'flex', flexDirection: 'column' }}>
                        {aiDebugger.loading ? (
                          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <div className="loading-spinner" style={{ marginBottom: '16px', fontSize: '24px' }}>⚙️</div>
                            Analyzing terminal error...
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minHeight: 0 }}>
                            {aiDebugger.explanation && (
                              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', overflowY: 'auto', maxHeight: '200px' }}>
                                <strong style={{ display: 'block', marginBottom: '8px', color: '#10a37f' }}>Explanation:</strong>
                                <ReactMarkdown
                                  components={{
                                    p: ({ node, ...props }) => <p style={{ margin: '0 0 8px 0', color: '#e2e2e2', fontSize: '13px', lineHeight: '1.5' }} {...props} />,
                                    blockquote: ({ node, ...props }) => <blockquote style={{ margin: '0 0 8px 0', padding: '4px 12px', borderLeft: '4px solid #10a37f', color: '#a0a0a0', fontStyle: 'italic', background: 'rgba(16, 163, 127, 0.1)' }} {...props} />
                                  }}
                                >
                                  {aiDebugger.explanation}
                                </ReactMarkdown>
                              </div>
                            )}
                            {aiDebugger.codeFix && (
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                <strong style={{ display: 'block', marginBottom: '8px', color: '#e2e2e2' }}>Proposed Fix:</strong>
                                <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border-base)', borderRadius: '8px', background: 'var(--bg-elevated)', marginBottom: '12px' }}>
                                  <SyntaxHighlighter language="javascript" style={vscDarkPlus} customStyle={{ margin: 0, fontSize: '13px', background: 'transparent' }}>
                                    {(() => {
                                      const matches = [...aiDebugger.codeFix.matchAll(/<replace>([\s\S]*?)<\/replace>/g)]
                                      return matches.length > 0 ? matches.map(m => m[1].trim()).join('\n// ...\n') : aiDebugger.codeFix
                                    })()}
                                  </SyntaxHighlighter>
                                </div>

                                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                                  <textarea
                                    placeholder="Ask a follow up question (Shift+Enter for new line)..."
                                    onKeyDown={handleDebuggerFollowUp}
                                    disabled={aiDebugger.loading}
                                    rows={1}
                                    style={{
                                      flex: 1,
                                      background: 'rgba(255,255,255,0.05)',
                                      color: 'white',
                                      border: '1px solid rgba(255,255,255,0.1)',
                                      padding: '8px 12px',
                                      borderRadius: '6px',
                                      fontSize: '13px',
                                      outline: 'none',
                                      resize: 'none',
                                      minHeight: '36px',
                                      fontFamily: 'inherit'
                                    }}
                                  />
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                  <button onClick={() => applyAiDebuggerFix(false)} style={{ background: 'var(--bg-light)', color: 'var(--text-main)', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Review in Editor</button>
                                  <button onClick={() => applyAiDebuggerFix(true)} style={{ background: 'var(--accent-color)', color: 'var(--bg-main)', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>Apply & Re-run</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {bottomTab === 'debugger-history' && (
                      <div className="debugger-history-panel" style={{ position: 'absolute', inset: 0, zIndex: 2, padding: '16px', background: 'var(--bg-deep)', overflowY: 'auto' }}>
                        {debuggerHistory.length === 0 ? (
                          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <p>No automated fixes applied yet.</p>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {debuggerHistory.map((item, idx) => (
                              <div key={idx} style={{ background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                  <strong style={{ color: '#10a37f' }}>Fix Applied</strong>
                                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{item.timestamp}</span>
                                </div>
                                <p style={{ margin: '0 0 12px 0', whiteSpace: 'pre-wrap', color: '#e2e2e2', fontSize: '13px' }}>{item.explanation}</p>
                                <details>
                                  <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '12px', marginBottom: '8px' }}>Show Details (Terminal Error & Code Diff)</summary>
                                  <div style={{ marginTop: '8px', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '6px', border: '1px solid var(--border-base)', fontSize: '12px', color: 'var(--text-secondary)', overflowX: 'auto', whiteSpace: 'pre' }}>
                                    <strong>Error:</strong><br />{item.error}
                                    <hr style={{ borderColor: 'var(--border-subtle)', margin: '12px 0' }} />
                                    <strong>Fix:</strong><br />{item.codeFix}
                                  </div>
                                </details>
                              </div>
                            ))}
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
                                      <div key={idx} className="edit-block-ui" style={{ margin: '10px 0', padding: '10px', background: 'transparent', width: '100%', boxSizing: 'border-box', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', fontSize: '13px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" style={{ flexShrink: 0 }}><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                          <strong style={{ flexShrink: 0 }}>Agent Edit:</strong> <span style={{ wordBreak: 'break-all', flex: '1 1 auto' }}>{part.path}</span>
                                          <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>Auto-applied</span>
                                        </div>
                                        <details>
                                          <summary style={{ cursor: 'pointer', outline: 'none', padding: '4px', background: 'transparent', borderRadius: '4px' }}>
                                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>View Changes (if auto-apply failed)</span>
                                          </summary>
                                          <pre style={{ marginTop: '8px', padding: '10px', background: 'transparent', borderRadius: '4px', overflowX: 'auto', width: '100%', boxSizing: 'border-box', fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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


                </div>
              </>
            )}
          </div>



          {/* ── Status Bar ── */}
          <footer className="status-bar">
            <div className="status-left">
              {currentChordDisplay && (
                <div className="status-item" style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>
                  {currentChordDisplay}
                </div>
              )}
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
                className="status-item clickable"
                onClick={() => {
                  const newState = !autoCompleteEnabled;
                  localStorage.setItem('editor-inlineSuggest', newState.toString());
                  window.dispatchEvent(new CustomEvent('settings-changed', { detail: { key: 'editor-inlineSuggest', value: newState } }));
                  window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: `AI Autocomplete is now ${newState ? 'ON' : 'OFF'}`, type: 'info' } }));
                }}
                title="Toggle AI Autocomplete"
              >
                <Sparkles size={12} /> πlot Autocomplete: {autoCompleteEnabled ? <span style={{ color: 'var(--accent-color)' }}>On</span> : <span>Off</span>}
              </span>
              <span
                className="status-item clickable"
                onClick={() => setShowTerminal(!showTerminal)}
                title="Toggle Terminal (Ctrl+Shift+`)"
              >
                <Terminal size={12} /> Terminal
              </span>
              {isLiveServerEnabled && (
                <span style={{ display: 'flex', alignItems: 'center' }}>
                  <span
                    className="status-item clickable"
                    style={{ color: isLiveServerRunning ? '#10a37f' : 'inherit' }}
                    onClick={handleToggleLiveServer}
                    title={isLiveServerRunning ? `Server running at ${liveServerUrl}. Click to open active file in browser.` : "Start Live Server and open active file"}
                  >
                    {isLiveServerRunning ? <><CheckCircle size={12} /> Port 3000</> : <><RefreshCw size={12} /> Go Live</>}
                  </span>
                  {isLiveServerRunning && (
                    <span
                      className="status-item clickable"
                      style={{ color: 'var(--error-color)', padding: '0 4px', margin: '0' }}
                      onClick={handleStopLiveServer}
                      title="Stop Live Server"
                    >
                      <X size={14} />
                    </span>
                  )}
                </span>
              )}
              <span className="status-item" style={{ cursor: 'pointer' }} onClick={() => setShowSettings(true)} title="Settings">
                {keyCount > 0 ? (
                  <span className="status-key-ok"><Key size={12} /> {keyCount} key{keyCount > 1 ? 's' : ''}</span>
                ) : (
                  <span className="status-key-none"><Key size={12} /> No Keys</span>
                )}
              </span>
            </div>
          </footer>
        </div>

        {showVisualizer && (
          <CodebaseVisualizer
            projectRoot={projectRoot}
            onClose={() => setShowVisualizer(false)}
            onFileSelect={(path, name) => {
              setShowVisualizer(false)
              handleOpenFile(path, name)
            }}
          />
        )}

        {dsaExplainer && (
          <DSAExplainer
            initialCode={dsaExplainer.code}
            initialLanguage={dsaExplainer.language}
            aiConfig={{
              model: selectedModel,
              customConfig: selectedModel === 'custom'
                ? { baseURL: customBaseUrl.trim(), modelId: customModelId.trim() }
                : undefined
            }}
            onClose={() => setDsaExplainer(null)}
          />
        )}

        {toast && (
          <div style={{
            position: 'fixed',
            bottom: '40px',
            right: '20px',
            padding: '12px 24px',
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderLeft: `4px solid ${toast.type === 'error' ? 'var(--accent-rose, #ef4444)' : toast.type === 'warning' ? '#eab308' : 'var(--accent-color)'}`,
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 9999,
            animation: 'slideIn 0.3s ease-out forwards'
          }}>
            {toast.message}
          </div>
        )}

        {missingToolchain && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000,
            display: 'flex', justifyContent: 'center', alignItems: 'center'
          }}>
            <div style={{
              backgroundColor: 'var(--bg-elevated)', padding: '24px', borderRadius: '8px',
              maxWidth: '500px', border: '1px solid var(--border-subtle)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
            }}>
              <h2 style={{ margin: '0 0 16px 0', color: 'var(--accent-rose, #ef4444)' }}>
                {missingToolchain.reason === 'outdated_compiler' ? 'Outdated Compiler Detected' : 'Toolchain Missing'}
              </h2>
              <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                {missingToolchain.error}
              </p>
              <div style={{ backgroundColor: 'var(--bg-inset)', padding: '12px', borderRadius: '4px', marginBottom: '16px', fontFamily: 'monospace' }}>
                {missingToolchain.remediationCommand}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  onClick={() => setMissingToolchain(null)}
                  style={{ padding: '8px 16px', backgroundColor: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Dismiss
                </button>
                <button
                  onClick={async () => {
                    const res = await window.api.recheckToolchainStatus('cpp')
                    if (res.success) {
                      setMissingToolchain(null)
                      setToast({ message: 'Toolchain verified successfully! C++ features are now active.', type: 'success' })
                    } else {
                      setToast({ message: 'Toolchain still not found. Please run the command.', type: 'error' })
                    }
                  }}
                  style={{ padding: '8px 16px', backgroundColor: 'var(--accent-color)', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Retry / Re-check Toolchain
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
