import React, { useState, useEffect, useRef } from 'react'
import Editor, { loader, DiffEditor } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { applyDiff } from '../diffUtils'
import { X, Save, Circle, Sparkles, ChevronRight, AlertTriangle, Info, CheckCircle, Loader2 } from 'lucide-react'
import { ContextInspector } from './ContextInspector'
import { GitGraph } from './GitGraph'
import { PostmanView } from './PostmanView'
import { useAppStore } from '../store/appStore'
import { EXTENSIONS } from '../utils/extensionRegistry'
import { runEsLint, runPrettier, formatWithPrettier, isExtensionEnabled } from '../utils/linterService'
import { diffLines } from 'diff'

// --- Monaco Workers ---
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    }
  }
}

loader.config({ monaco })

// ─── Lightweight LSP Client ────────────────────────────────────────
// ─── Lightweight LSP Client (per-language) ─────────────────────────
// Speaks JSON-RPC directly over our IPC bridge.
class LspClient {
  constructor(language) {
    this.language = language
    this.requestId = 0
    this.pendingRequests = new Map()
    this.onDiagnostics = null
    this.initialized = false
    this.openDocVersions = new Map()
  }

  // Called by the global message dispatcher
  handleMessage(raw) {
    try {
      const msg = JSON.parse(raw)
      if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
        const { resolve } = this.pendingRequests.get(msg.id)
        this.pendingRequests.delete(msg.id)
        resolve(msg.result || null)
      }
      if (msg.method === 'textDocument/publishDiagnostics') {
        if (this.onDiagnostics) this.onDiagnostics(msg.params)
      }
    } catch (e) {
      console.error(`LSP [${this.language}] parse error:`, e)
    }
  }

  sendRequest(method, params) {
    const id = ++this.requestId
    const msg = { jsonrpc: '2.0', id, method, params }
    window.api.sendLspMessage(this.language, JSON.stringify(msg))
    return new Promise((resolve) => {
      this.pendingRequests.set(id, { resolve })
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          resolve(null)
        }
      }, 10000)
    })
  }

  sendNotification(method, params) {
    const msg = { jsonrpc: '2.0', method, params }
    window.api.sendLspMessage(this.language, JSON.stringify(msg))
  }

  async initialize(rootUri) {
    const result = await this.sendRequest('initialize', {
      processId: null,
      rootUri,
      capabilities: {
        textDocument: {
          completion: {
            completionItem: { snippetSupport: false, labelDetailsSupport: true },
            contextSupport: true
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          publishDiagnostics: { relatedInformation: true },
          synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false, dynamicRegistration: false }
        },
        workspace: {}
      },
      initializationOptions: {}
    })
    this.sendNotification('initialized', {})
    this.initialized = true
    console.log(`LSP [${this.language}] initialized.`)
    return result
  }

  didOpen(uri, languageId, text) {
    this.openDocVersions.set(uri, 1)
    this.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text }
    })
  }

  didChange(uri, text) {
    const version = (this.openDocVersions.get(uri) || 1) + 1
    this.openDocVersions.set(uri, version)
    this.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }]
    })
  }

  didClose(uri) {
    this.openDocVersions.delete(uri)
    this.sendNotification('textDocument/didClose', {
      textDocument: { uri }
    })
  }

  async completion(uri, line, character) {
    return this.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position: { line, character }
    })
  }

  async hover(uri, line, character) {
    return this.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: { line, character }
    })
  }

  dispose() {
    this.sendRequest('shutdown', null).then(() => {
      this.sendNotification('exit', null)
    })
  }
}

// ─── Helpers ───────────────────────────────────────────────────────
const getLanguageFromPath = (path) => {
  if (!path) return 'plaintext'
  const ext = path.split('.').pop().toLowerCase()
  const map = {
    // JavaScript/TypeScript family
    js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    // Web
    html: 'html', htm: 'html', vue: 'html',
    css: 'css', scss: 'scss', sass: 'sass', less: 'less',
    json: 'json', jsonc: 'json',
    // Markup & config
    xml: 'xml', md: 'markdown', yaml: 'yaml', yml: 'yaml',
    // Python
    py: 'python', pyw: 'python', pyi: 'python',
    // C/C++ family
    c: 'c', hpp: 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', 'c++': 'cpp', h: 'c',
    // Go
    go: 'go',
    // Rust
    rs: 'rust',
    // Shell/Bash
    sh: 'shell', bash: 'bash', zsh: 'shell', fish: 'shell',
    // Java
    java: 'java', class: 'java', jar: 'java',
    // C#
    cs: 'csharp', csx: 'csharp',
    // Other
    php: 'php', rb: 'ruby', kt: 'kotlin', swift: 'swift', m: 'objective-c',
    scala: 'scala', groovy: 'groovy', sql: 'sql'
  }
  return map[ext] || 'plaintext'
}

// Maps our language IDs to the LSP language key used by the backend
const lspLanguageKey = (lang) => {
  const map = {
    python: 'python',
    c: 'c',
    cpp: 'cpp',
    go: 'go',
    rust: 'rust',
    shell: 'shell',
    bash: 'bash',
    typescript: 'typescript',
    javascript: 'javascript',
    java: 'java',
    csharp: 'csharp',
    cs: 'cs'
  }
  return map[lang] || null
}

const pathToUri = (p) => {
  if (!p) return ''
  let formatted = p.replace(/\\/g, '/')
  if (!formatted.startsWith('/')) formatted = '/' + formatted
  return `file://${formatted}`
}

const severityMap = {
  1: monaco.MarkerSeverity.Error,
  2: monaco.MarkerSeverity.Warning,
  3: monaco.MarkerSeverity.Info,
  4: monaco.MarkerSeverity.Hint
}

const completionKindMap = {
  1: monaco.languages.CompletionItemKind.Text,
  2: monaco.languages.CompletionItemKind.Method,
  3: monaco.languages.CompletionItemKind.Function,
  4: monaco.languages.CompletionItemKind.Constructor,
  5: monaco.languages.CompletionItemKind.Field,
  6: monaco.languages.CompletionItemKind.Variable,
  7: monaco.languages.CompletionItemKind.Class,
  8: monaco.languages.CompletionItemKind.Interface,
  9: monaco.languages.CompletionItemKind.Module,
  10: monaco.languages.CompletionItemKind.Property,
  11: monaco.languages.CompletionItemKind.Unit,
  12: monaco.languages.CompletionItemKind.Value,
  13: monaco.languages.CompletionItemKind.Enum,
  14: monaco.languages.CompletionItemKind.Keyword,
  15: monaco.languages.CompletionItemKind.Snippet,
  16: monaco.languages.CompletionItemKind.Color,
  17: monaco.languages.CompletionItemKind.File,
  18: monaco.languages.CompletionItemKind.Reference,
  19: monaco.languages.CompletionItemKind.Folder,
  20: monaco.languages.CompletionItemKind.EnumMember,
  21: monaco.languages.CompletionItemKind.Constant,
  22: monaco.languages.CompletionItemKind.Struct,
  23: monaco.languages.CompletionItemKind.Event,
  24: monaco.languages.CompletionItemKind.Operator,
  25: monaco.languages.CompletionItemKind.TypeParameter,
}

// ─── Multi-language LSP manager ────────────────────────────────────
const lspClients = new Map()      // lspKey → LspClient
const registeredProviders = new Set() // monacoLangId strings already registered
let ipcListenerInstalled = false

// Global reference to the current AI config so the provider can access it
let globalAiConfig = null
let globalOpenFiles = []
let globalFileContents = {}
let globalActiveFile = null

function installGlobalIpcListener() {
  if (ipcListenerInstalled) return
  ipcListenerInstalled = true

  window.api.onLspMessage((language, raw) => {
    const client = lspClients.get(language)
    if (client) client.handleMessage(raw)
  })
}

function registerProvidersForLanguage(monacoLangId) {
  if (registeredProviders.has(monacoLangId)) return
  registeredProviders.add(monacoLangId)

  const findClient = () => {
    const key = lspLanguageKey(monacoLangId)
    return key ? lspClients.get(key) : null
  }

  // ── Ghost Text Auto-Completion ──
  monaco.languages.registerInlineCompletionsProvider(monacoLangId, {
    provideInlineCompletions: async (model, position, context, token) => {
      if (!globalAiConfig || globalAiConfig.autoCompleteEnabled === false) return { items: [] }

      // 1. Native Debounce using cancellation token
      await new Promise(resolve => setTimeout(resolve, globalAiConfig.autoCompleteDelay || 800))
      if (token.isCancellationRequested) return { items: [] }

      // 2. Build Context
      const startLine = Math.max(1, position.lineNumber - 30)
      const endLine = Math.min(model.getLineCount(), position.lineNumber + 5)

      const prefixRange = new monaco.Range(startLine, 1, position.lineNumber, position.column)
      const suffixRange = new monaco.Range(position.lineNumber, position.column, endLine, model.getLineMaxColumn(endLine))

      const prefix = model.getValueInRange(prefixRange)
      const suffix = model.getValueInRange(suffixRange)

      // 2.5 Extract context from other open files
      let otherFilesContext = ''
      if (globalOpenFiles && globalOpenFiles.length > 1) {
        for (const f of globalOpenFiles) {
          if (f.path !== globalActiveFile) {
            const fileData = globalFileContents[f.path]?.content || ''
            if (fileData) {
              otherFilesContext += `\n<context_file path="${f.path}">\n${fileData.substring(0, 2000)}\n</context_file>`
            }
          }
        }
      }

      // 3. Prompt Construction
      const prompt = `You are a strict code completion engine. Your ONLY job is to output the exact code to insert at the cursor position. 
DO NOT output any conversational text. DO NOT explain the code. 
DO NOT output markdown blocks. JUST the raw code.
Do not repeat the prefix. Just complete what comes next.
If the code is logically complete and no further code is needed, output EXACTLY the word "NOTHING" and nothing else.
If you need to insert a new line, include the newline character.

ADDITIONAL CONTEXT:
${otherFilesContext || 'None'}

PREFIX:
${prefix}

SUFFIX:
${suffix}

COMPLETION:`

      // 4. Fetch Completion
      const res = await window.api.getAiCompletion(prompt, globalAiConfig)
      if (token.isCancellationRequested || !res.success || !res.text) {
        return { items: [] }
      }

      let completionText = res.text
      // cleanup markdown if the AI ignored instructions
      completionText = completionText.replace(/^```[a-z]*\n?/i, '')
      completionText = completionText.replace(/\n?```$/i, '')

      // If there's still conversational text before a markdown block, try to extract just the code
      if (completionText.includes('```')) {
        const match = completionText.match(/```[a-z]*\n([\s\S]*?)```/i)
        if (match) {
          completionText = match[1]
        }
      }

      if (completionText.trim() === 'NOTHING') {
        return { items: [] }
      }

      return {
        items: [
          {
            insertText: completionText,
            range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
          }
        ]
      }
    },
    freeInlineCompletions: () => { }
  })

  // Completion
  monaco.languages.registerCompletionItemProvider(monacoLangId, {
    triggerCharacters: ['.', '(', ',', ':', ' '],
    provideCompletionItems: async (model, position) => {
      const client = findClient()
      if (!client || !client.initialized) return { suggestions: [] }
      const uri = model.uri.toString()
      const result = await client.completion(uri, position.lineNumber - 1, position.column - 1)
      if (!result) return { suggestions: [] }

      const items = result.items || result || []
      const word = model.getWordUntilPosition(position)

      const suggestions = items.map((item) => ({
        label: item.label,
        kind: completionKindMap[item.kind] || monaco.languages.CompletionItemKind.Text,
        detail: item.detail || '',
        documentation: item.documentation?.value || item.documentation || '',
        insertText: item.insertText || item.label,
        range: {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn
        }
      }))
      return { suggestions }
    }
  })

  // Hover
  monaco.languages.registerHoverProvider(monacoLangId, {
    provideHover: async (model, position) => {
      const client = findClient()
      if (!client || !client.initialized) return null
      const uri = model.uri.toString()
      const result = await client.hover(uri, position.lineNumber - 1, position.column - 1)
      if (!result || !result.contents) return null

      let value = ''
      if (typeof result.contents === 'string') {
        value = result.contents
      } else if (result.contents.value) {
        value = result.contents.value
      } else if (Array.isArray(result.contents)) {
        value = result.contents.map(c => typeof c === 'string' ? c : c.value).join('\n\n')
      }

      return { contents: [{ value }] }
    }
  })
}

// ─── Component ─────────────────────────────────────────────────────
export const CodeEditor = ({
  openFiles,
  setOpenFiles,
  activeFile,
  setActiveFile,
  closeFile,
  markFileDirty,
  markFileClean,
  projectRoot,
  aiConfig,
  onRun
}) => {
  const [fileContents, setFileContents] = useState({})
  const [currentValue, setCurrentValue] = useState('')
  const [draggedTabIdx, setDraggedTabIdx] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [showContextInspector, setShowContextInspector] = useState(false)
  const editorRef = useRef(null)



  useEffect(() => {
    globalAiConfig = aiConfig
  }, [aiConfig])

  useEffect(() => {
    globalOpenFiles = openFiles
  }, [openFiles])

  useEffect(() => {
    globalFileContents = fileContents
  }, [fileContents])

  useEffect(() => {
    globalActiveFile = activeFile
  }, [activeFile])

  // Close context menu on outside click
  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null)
    window.addEventListener('click', closeContextMenu)
    return () => window.removeEventListener('click', closeContextMenu)
  }, [])

  // ─── Drag and Drop Handlers ───
  const handleDragStart = (e, idx) => {
    setDraggedTabIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    // This is required for Firefox, but also good practice
    e.dataTransfer.setData('text/plain', idx.toString())
  }

  const handleDragOver = (e) => {
    e.preventDefault() // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e, dropIdx) => {
    e.preventDefault()
    if (draggedTabIdx === null || draggedTabIdx === dropIdx) return

    const newFiles = [...openFiles]
    const [draggedFile] = newFiles.splice(draggedTabIdx, 1)
    newFiles.splice(dropIdx, 0, draggedFile)
    setOpenFiles(newFiles)
    setDraggedTabIdx(null)
  }

  // ─── Context Menu Handlers ───
  const handleContextMenu = (e, file, index) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path: file.path,
      index
    })
  }

  const handleContextAction = (action, e) => {
    e.stopPropagation()
    if (!contextMenu) return

    const { path, index } = contextMenu
    const targetFile = openFiles[index]

    switch (action) {
      case 'close':
        closeFile(path)
        break
      case 'closeOthers':
        setOpenFiles([targetFile])
        setActiveFile(targetFile.path)
        break
      case 'closeToRight':
        const keptFiles = openFiles.slice(0, index + 1)
        setOpenFiles(keptFiles)
        if (!keptFiles.find(f => f.path === activeFile)) {
          setActiveFile(keptFiles.length > 0 ? keptFiles[keptFiles.length - 1].path : null)
        }
        break
      case 'closeSaved':
        const dirtyFiles = openFiles.filter(f => f.isDirty)
        setOpenFiles(dirtyFiles)
        if (!dirtyFiles.find(f => f.path === activeFile)) {
          setActiveFile(dirtyFiles.length > 0 ? dirtyFiles[dirtyFiles.length - 1].path : null)
        }
        break
      case 'closeAll':
        setOpenFiles([])
        setActiveFile(null)
        break
      case 'copyPath':
        navigator.clipboard.writeText(path)
        break
      case 'copyRelativePath':
        if (projectRoot && path.startsWith(projectRoot)) {
          const relativePath = path.substring(projectRoot.length).replace(/^[\\/]/, '')
          navigator.clipboard.writeText(relativePath)
        } else {
          // Fallback to basename if not in project root
          const basename = path.split(/[\\/]/).pop()
          navigator.clipboard.writeText(basename)
        }
        break
    }
    setContextMenu(null)
  }

  // Load file content when active file changes
  useEffect(() => {
    if (!activeFile || activeFile.startsWith('ext:') || activeFile.startsWith('git-graph:')) return

    const loadContent = async () => {
      if (!fileContents[activeFile]) {
        setFileContents(prev => ({ ...prev, [activeFile]: { content: 'Loading...', isLoading: true } }))
        const res = await window.api.getFileContents(activeFile)

        if (res.success) {
          setFileContents(prev => ({ ...prev, [activeFile]: { content: res.content, isLoading: false } }))
          setCurrentValue(res.content)
        } else {
          setFileContents(prev => ({ ...prev, [activeFile]: { content: `Error: ${res.error}`, isLoading: false } }))
          setCurrentValue(`Error: ${res.error}`)
        }
      } else {
        setCurrentValue(fileContents[activeFile].content)
      }
    }

    loadContent()
  }, [activeFile])

  // ─── LSP lifecycle (multi-language) ──────────────────────────
  useEffect(() => {
    const monacoLang = getLanguageFromPath(activeFile)
    const lspKey = lspLanguageKey(monacoLang)
    if (!lspKey) return // No LSP for this language (e.g. html, json — Monaco handles those natively)

    const fileUri = pathToUri(activeFile)

    installGlobalIpcListener()

    const bootLsp = async () => {
      if (!lspClients.has(lspKey)) {
        const res = await window.api.startLanguageServer(lspKey)
        if (!res.success) {
          console.warn(`No LSP available for ${lspKey}: ${res.error}`)
          return
        }

        const client = new LspClient(lspKey)
        lspClients.set(lspKey, client)

        // Wire diagnostics to Monaco markers
        client.onDiagnostics = (params) => {
          const markers = (params.diagnostics || []).map(d => ({
            severity: severityMap[d.severity] || monaco.MarkerSeverity.Error,
            message: d.message,
            startLineNumber: d.range.start.line + 1,
            startColumn: d.range.start.character + 1,
            endLineNumber: d.range.end.line + 1,
            endColumn: d.range.end.character + 1,
            source: d.source || lspKey
          }))

          const targetUri = monaco.Uri.parse(params.uri).toString().toLowerCase()
          const models = monaco.editor.getModels()
          const model = models.find(m => m.uri.toString().toLowerCase() === targetUri)
          if (model) {
            monaco.editor.setModelMarkers(model, lspKey, markers)
          }
        }

        // Determine workspace root
        const parts = activeFile.replace(/\\/g, '/').split('/')
        parts.pop()
        const rootUri = pathToUri(parts.join('/'))

        await client.initialize(rootUri)
        registerProvidersForLanguage(monacoLang)
      }

      // Tell the LSP about the open document
      const content = fileContents[activeFile]?.content || currentValue || ''
      const client = lspClients.get(lspKey)
      if (client && client.initialized) {
        client.didOpen(fileUri, monacoLang, content)
      }
    }

    bootLsp()

    return () => {
      const client = lspClients.get(lspKey)
      if (client) {
        client.didClose(fileUri)
      }
    }
  }, [activeFile])

  const handleSave = async (forceFormat = false) => {
    if (!activeFile || !editorRef.current) return

    const isPrettierEnabled = isExtensionEnabled('ext-fmt-prettier', extensions)
    const isEslintEnabled = isExtensionEnabled('ext-fmt-eslint', extensions)

    let content = editorRef.current.getValue()
    const cwd = projectRoot || undefined

    // Save current changes to disk FIRST so CLI tools can read them
    const saveRes = await window.api.saveFileContents(activeFile, content)
    if (!saveRes.success) {
      console.error('Failed to save file:', saveRes.error)
      return
    }

    // Format if Prettier is enabled OR the user triggered Shift+Alt+F (forceFormat)
    if (isPrettierEnabled || forceFormat) {
      const formatRes = await formatWithPrettier(activeFile, cwd)
      if (formatRes.success && formatRes.content && formatRes.content !== content) {
        content = formatRes.content
        editorRef.current.setValue(content)
        // If it formatted, we don't need to re-save because Prettier wrote it to disk.
      } else if (formatRes.error && forceFormat) {
        // Only show toast if user manually forced it or you want it always
        window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: formatRes.error, type: 'error' } }))
      } else if (formatRes.error && isPrettierEnabled && !forceFormat) {
        console.warn('Prettier format error:', formatRes.error)
      }
    } else if (forceFormat && !isPrettierEnabled) {
      window.dispatchEvent(new CustomEvent('show-toast', { detail: { message: 'Prettier is not enabled.', type: 'info' } }))
    }

    // Update internal React state
    setFileContents(prev => ({
      ...prev,
      [activeFile]: { ...prev[activeFile], content }
    }))
    markFileClean(activeFile)

    // Run ESLint
    if (isEslintEnabled) {
      const lintRes = await runEsLint(activeFile, cwd)
      if (lintRes.error) {
        console.warn('ESLint error:', lintRes.error)
      } else if (lintRes.markers) {
        const targetUri = monaco.Uri.parse(pathToUri(activeFile)).toString().toLowerCase()
        const models = monaco.editor.getModels()
        const model = models.find(m => m.uri.toString().toLowerCase() === targetUri)
        if (model) {
          monaco.editor.setModelMarkers(model, 'eslint', lintRes.markers)
        }
      }
    }
  }

  // Handle Monaco Mount
  const handleEditorDidMount = (editor, monacoInstance) => {
    editorRef.current = editor

    // Set up LSP logic
    const monacoLangId = getLanguageFromPath(activeFile)
    registerProvidersForLanguage(monacoLangId)

    const lspKey = lspLanguageKey(monacoLangId)
    if (lspKey && lspClients.has(lspKey)) {
      const client = lspClients.get(lspKey)
      const uri = pathToUri(activeFile)

      // Update LSP server on type
      editor.onDidChangeModelContent(() => {
        client.didChange(uri, editor.getValue())

        // Clear active AI edit if the user starts typing manually
        if (hasActiveAiEdit) {
          setHasActiveAiEdit(false)
          if (decorationsCollectionRef.current) {
            decorationsCollectionRef.current.clear()
          }
        }
      })
    }

    // Command: Save
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      handleSave(false)
    })

    // Expose diagnostics to the global window so the AI can read them
    window.getEditorDiagnostics = () => {
      const model = editor.getModel()
      if (!model) return []
      return monacoInstance.editor.getModelMarkers({ resource: model.uri })
    }

    // Expose live editor content so the AI sees unsaved changes
    window.getEditorValue = () => {
      return editor.getValue()
    }

    // Expose save functionality for run command
    window.saveActiveFile = () => {
      return handleSave()
    }
  }

  const monacoRef = useRef(null)
  const decorationsCollectionRef = useRef(null)
  const gitDecorationsCollectionRef = useRef(null)
  const errorLensDecorationsCollectionRef = useRef(null)
  const gitLensWidgetRef = useRef(null)
  const [hasActiveAiEdit, setHasActiveAiEdit] = useState(false)
  const [isReady, setIsReady] = useState(false)
  
  // Use global app store for extensions and theme
  const { extensions, toggleExtension, activeTheme, setActiveTheme } = useAppStore()
  
  const isGitLensEnabled = extensions.some(ext => ext.id === 'ext-git-lens' && ext.enabled)
  const isGitLensEnabledRef = useRef(isGitLensEnabled)
  useEffect(() => {
    isGitLensEnabledRef.current = isGitLensEnabled
  }, [isGitLensEnabled])
  const [cursorLine, setCursorLine] = useState(null)
  const monacoTheme = activeTheme === 'light-modern' ? 'vs' : 'vs-dark'
  const [originalText, setOriginalText] = useState(null)
  const [showDiff, setShowDiff] = useState(false)
  const [gutterOriginalTexts, setGutterOriginalTexts] = useState({})
  
  const activeFileObj = openFiles.find(f => f.path === activeFile)
  const isGitDiff = activeFileObj && activeFileObj.gitOriginal != null
  const effectiveShowDiff = showDiff || isGitDiff
  const effectiveOriginalText = isGitDiff ? activeFileObj.gitOriginal : originalText

  const [inlineAi, setInlineAi] = useState({
    visible: false,
    top: 0,
    left: 0,
    prompt: '',
    isLoading: false,
    range: null,
    selectionText: ''
  })

  const submitInlineAi = async () => {
    if (!inlineAi.prompt.trim() || !inlineAi.range) return

    setInlineAi(prev => ({ ...prev, isLoading: true }))

    const instructions = `Edit the following code based on the instructions. Return ONLY the raw modified code without markdown blocks. \n\nCode to edit:\n${inlineAi.selectionText}\n\nInstructions: ${inlineAi.prompt}`

    let generatedCode = ''

    const handleChunk = (chunk) => {
      generatedCode += chunk
    }

    window.api.onInlineAiStreamChunk(handleChunk)

    await window.api.sendInlineAiPrompt(instructions, {})

    // Stream finished, apply it!
    if (editorRef.current && generatedCode) {
      const cleanedCode = generatedCode.replace(/^```[a-z]*\n/i, '').replace(/\n```$/, '')

      const model = editorRef.current.getModel()
      const originalValue = model.getValue()
      setOriginalText(originalValue)

      editorRef.current.pushUndoStop()
      editorRef.current.executeEdits("inline-ai", [{
        range: inlineAi.range,
        text: cleanedCode
      }])
      editorRef.current.pushUndoStop()

      // Highlight the change
      if (monacoRef.current && decorationsCollectionRef.current) {
        const startLine = inlineAi.range.startLineNumber
        const numLinesAdded = cleanedCode.split('\n').length - 1
        const endLine = startLine + numLinesAdded

        const monacoRanges = [{
          range: new monacoRef.current.Range(startLine, 1, endLine, 1),
          options: {
            isWholeLine: true,
            className: 'ai-edit-highlight',
            marginClassName: 'ai-edit-highlight'
          }
        }]
        decorationsCollectionRef.current.set(monacoRanges)
        setHasActiveAiEdit(true)
      }
    }

    setInlineAi({ visible: false, top: 0, left: 0, prompt: '', isLoading: false, range: null, selectionText: '' })
  }

  const handleEditorDidMountWrapper = (editor, monacoInstance) => {
    monacoRef.current = monacoInstance
    decorationsCollectionRef.current = editor.createDecorationsCollection([])
    gitDecorationsCollectionRef.current = editor.createDecorationsCollection([])
    errorLensDecorationsCollectionRef.current = editor.createDecorationsCollection([])
    // We don't use decorations for git lens anymore due to Monaco after-injection bugs

    let blameTimeout
    editor.onDidChangeCursorPosition((e) => {
      if (blameTimeout) clearTimeout(blameTimeout)
      if (gitLensWidgetRef.current && editorRef.current) {
        editorRef.current.removeContentWidget(gitLensWidgetRef.current)
        gitLensWidgetRef.current = null
      }
      const line = e.position.lineNumber
      blameTimeout = setTimeout(() => {
        setCursorLine(line)
      }, 300)
    })

    // Command: Run File (Ctrl+Alt+N)
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.KeyN, () => {
      window.dispatchEvent(new Event('global-run-file'))
    })

    // Command: Format Document (Shift+Alt+F)
    editor.addCommand(monacoInstance.KeyMod.Shift | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.KeyF, async () => {
      handleSave(true)
    })

    // Error Lens Integration
    monacoInstance.editor.onDidChangeMarkers((uris) => {
      const { extensions } = useAppStore.getState()
      const isErrorLensEnabled = isExtensionEnabled('ext-fmt-errorlens', extensions)
      if (!isErrorLensEnabled || !errorLensDecorationsCollectionRef.current) {
        if (errorLensDecorationsCollectionRef.current) errorLensDecorationsCollectionRef.current.clear()
        return
      }

      const targetUri = monacoInstance.Uri.parse(pathToUri(activeFile)).toString().toLowerCase()
      // Check if the current file's markers changed
      if (uris.some(u => u.toString().toLowerCase() === targetUri)) {
        const model = editor.getModel()
        if (!model) return

        const markers = monacoInstance.editor.getModelMarkers({ resource: model.uri })
        
        // Convert markers to delta decorations
        const newDecorations = markers.map(marker => {
          let className = 'error-lens-info'
          if (marker.severity === monacoInstance.MarkerSeverity.Error) className = 'error-lens-error'
          if (marker.severity === monacoInstance.MarkerSeverity.Warning) className = 'error-lens-warning'
          
          return {
            range: new monacoInstance.Range(marker.startLineNumber, marker.startColumn, marker.startLineNumber, marker.startColumn),
            options: {
              isWholeLine: true,
              after: {
                content: `    ${marker.message}`,
                inlineClassName: `error-lens-inline ${className}`
              }
            }
          }
        })
        
        errorLensDecorationsCollectionRef.current.set(newDecorations)
      }
    })

    // Command: Inline AI Edit (Ctrl+K)
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyK, () => {
      const position = editor.getPosition()
      const selection = editor.getSelection()

      let selectionText = ''
      let range = selection

      if (!selection.isEmpty()) {
        selectionText = editor.getModel().getValueInRange(selection)
      } else {
        range = new monacoInstance.Range(position.lineNumber, 1, position.lineNumber, editor.getModel().getLineMaxColumn(position.lineNumber))
        selectionText = editor.getModel().getValueInRange(range)
      }

      const pixelPos = editor.getScrolledVisiblePosition(position)

      setInlineAi({
        visible: true,
        top: pixelPos.top + 20, // slightly below cursor
        left: pixelPos.left,
        prompt: '',
        isLoading: false,
        range,
        selectionText
      })
    })

    handleEditorDidMount(editor, monacoInstance)
  }

  const handleDiffEditorMountWrapper = (editor, monacoInstance) => {
    const modifiedEditor = editor.getModifiedEditor()
    modifiedEditor.onDidChangeModelContent(() => {
      handleEditorChange(modifiedEditor.getValue())
    })
  }

  const handleRevertEdit = () => {
    if (editorRef.current) {
      editorRef.current.trigger('keyboard', 'undo', null)
    }
    setHasActiveAiEdit(false)
    setShowDiff(false)
    setOriginalText(null)
    if (decorationsCollectionRef.current) {
      decorationsCollectionRef.current.clear()
    }
  }

  // ── Fetch Git Original for Gutter ──
  useEffect(() => {
    if (!activeFile || !projectRoot) return
    const fetchOriginal = async () => {
      let relPath = activeFile
      if (activeFile.startsWith(projectRoot)) {
        relPath = activeFile.substring(projectRoot.length).replace(/^[\\/]/, '')
      }
      try {
        const res = await window.api.gitAction(projectRoot, 'show-head', relPath)
        if (res && res.stdout) {
          setGutterOriginalTexts(prev => ({ ...prev, [activeFile]: res.stdout }))
        } else {
          setGutterOriginalTexts(prev => ({ ...prev, [activeFile]: null }))
        }
      } catch (e) {
        setGutterOriginalTexts(prev => ({ ...prev, [activeFile]: null }))
      }
    }
    fetchOriginal()
  }, [activeFile, projectRoot])

  const [gitLensDebugInfo, setGitLensDebugInfo] = useState('')

  // ── Git Lens Effect ──
  useEffect(() => {
    if (!isGitLensEnabled || !cursorLine || !activeFile || !projectRoot || effectiveShowDiff || !monacoRef.current || !editorRef.current) {
      if (gitLensWidgetRef.current && editorRef.current) {
        editorRef.current.removeContentWidget(gitLensWidgetRef.current)
        gitLensWidgetRef.current = null
      }
      return
    }

    const fetchBlame = async () => {
      try {
        let relPath = activeFile
        if (activeFile.startsWith(projectRoot)) {
          relPath = activeFile.substring(projectRoot.length).replace(/^\\|^\\/, '').replace(/^[/\\]/, '')
        }
        const res = await window.api.gitAction(projectRoot, 'blame', relPath, cursorLine)
        if (res.error) return

        // Parse git blame --porcelain output
        // e.g. 
        // c4f90... 1 1 1
        // author Name
        // ...
        // summary message
        
        let author = 'Unknown'
        let time = ''
        let summary = ''
        const lines = res.stdout.split('\n')
        
        for (const line of lines) {
          if (line.startsWith('author ')) author = line.substring(7)
          if (line.startsWith('author-time ')) {
            const timestamp = parseInt(line.substring(12), 10)
            const date = new Date(timestamp * 1000)
            const diffDays = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24))
            if (diffDays === 0) time = 'today'
            else if (diffDays === 1) time = 'yesterday'
            else if (diffDays < 30) time = `${diffDays} days ago`
            else if (diffDays < 365) time = `${Math.floor(diffDays/30)} months ago`
            else time = `${Math.floor(diffDays/365)} years ago`
          }
          if (line.startsWith('summary ')) summary = line.substring(8)
        }

        // clean up old widget if exists
        if (gitLensWidgetRef.current && editorRef.current) {
          editorRef.current.removeContentWidget(gitLensWidgetRef.current)
          gitLensWidgetRef.current = null
        }

        if (summary) {
          if (editorRef.current) {
            const model = editorRef.current.getModel()
            const maxCol = model ? model.getLineMaxColumn(cursorLine) : 1
            
            const widget = {
              getId: () => 'git-lens-widget',
              getDomNode: () => {
                const domNode = document.createElement('div')
                domNode.className = 'git-lens-ghost-text'
                domNode.style.display = 'inline-block'
                domNode.style.paddingLeft = '20px'
                domNode.style.opacity = '0.6'
                domNode.style.fontStyle = 'italic'
                domNode.style.color = 'var(--text-muted)'
                domNode.style.pointerEvents = 'none'
                domNode.style.whiteSpace = 'nowrap'
                
                // Show Uncommitted differently if needed, but summary handles it
                domNode.innerText = `\u2014 ${author}, ${time} • ${summary}`
                return domNode
              },
              getPosition: () => {
                return {
                  position: { lineNumber: cursorLine, column: maxCol },
                  preference: [0] // EXACT
                }
              }
            }
            editorRef.current.addContentWidget(widget)
            gitLensWidgetRef.current = widget
          }
        }
      } catch (e) {
        console.error('Git lens error:', e)
      }
    }
    fetchBlame()
  }, [cursorLine, activeFile, projectRoot, isGitLensEnabled, effectiveShowDiff])

  // ── Git Gutter Effect ──
  useEffect(() => {
    if (!gitDecorationsCollectionRef.current || !monacoRef.current || !editorRef.current) return

    const originalTextForGutter = gutterOriginalTexts[activeFile]
    if (effectiveShowDiff || !originalTextForGutter) {
      gitDecorationsCollectionRef.current.clear()
      return
    }

    try {
      const normalizedOriginal = originalTextForGutter.replace(/\r\n/g, '\n')
      const normalizedCurrent = currentValue.replace(/\r\n/g, '\n')
      const changes = diffLines(normalizedOriginal, normalizedCurrent)
      const decorations = []
      let currentLineNumber = 1

      for (let i = 0; i < changes.length; i++) {
        const change = changes[i]
        
        if (change.removed) {
          // Check if the next change is an addition (this means it's a modification)
          if (i + 1 < changes.length && changes[i + 1].added) {
            const addedChange = changes[i + 1]
            const startLine = currentLineNumber
            const endLine = currentLineNumber + addedChange.count - 1
            decorations.push({
              range: new monacoRef.current.Range(startLine, 1, endLine, 1),
              options: {
                isWholeLine: true,
                linesDecorationsClassName: 'git-gutter-modify'
              }
            })
            currentLineNumber += addedChange.count
            i++ // skip the added block since we processed it
          } else {
            // Just a pure deletion
            const targetLine = Math.max(1, currentLineNumber - 1)
            decorations.push({
              range: new monacoRef.current.Range(targetLine, 1, targetLine, 1),
              options: {
                isWholeLine: false,
                linesDecorationsClassName: 'git-gutter-delete'
              }
            })
          }
        } else if (change.added) {
          // Pure addition
          const startLine = currentLineNumber
          const endLine = currentLineNumber + change.count - 1
          decorations.push({
            range: new monacoRef.current.Range(startLine, 1, endLine, 1),
            options: {
              isWholeLine: false,
              linesDecorationsClassName: 'git-gutter-add'
            }
          })
          currentLineNumber += change.count
        } else {
          // Unchanged lines
          currentLineNumber += change.count
        }
      }

      gitDecorationsCollectionRef.current.set(decorations)
    } catch (e) {
      console.error('Error computing git diff:', e)
    }
  }, [currentValue, gutterOriginalTexts, activeFile, effectiveShowDiff])

  const handleAcceptEdit = () => {
    setHasActiveAiEdit(false)
    setShowDiff(false)
    setOriginalText(null)
    if (decorationsCollectionRef.current) {
      decorationsCollectionRef.current.clear()
    }
  }

  // Listen for 'apply-code' events to overwrite the editor cleanly
  useEffect(() => {
    const handleApplyCode = (e) => {
      const { code, path } = e.detail
      if (activeFile === path && editorRef.current) {
        editorRef.current.pushUndoStop()
        editorRef.current.executeEdits("ai-apply", [{
          range: editorRef.current.getModel().getFullModelRange(),
          text: code
        }])
        editorRef.current.pushUndoStop()
      }
    }
    window.addEventListener('apply-code', handleApplyCode)
    return () => window.removeEventListener('apply-code', handleApplyCode)
  }, [activeFile])

  // Listen for 'force-apply-diff' events to apply code instantly and save
  useEffect(() => {
    const handleForceApplyDiff = async (e) => {
      const { path, body } = e.detail
      const normalize = (p) => (p || '').replace(/\\/g, '/').toLowerCase()
      if (normalize(activeFile) === normalize(path) && editorRef.current) {
        const model = editorRef.current.getModel()
        let newText = model.getValue()

        const { newText: diffedText, hasChanges } = applyDiff(newText, body)

        if (hasChanges) {
          const viewState = editorRef.current.saveViewState()
          editorRef.current.pushUndoStop()
          editorRef.current.executeEdits("ai-force-diff", [{
            range: model.getFullModelRange(),
            text: diffedText
          }])
          editorRef.current.pushUndoStop()
          editorRef.current.restoreViewState(viewState)
        }

        if (e.detail.autoRun) {
          window.dispatchEvent(new Event('global-run-file'))
        } else {
          // Force save (only if not auto-running, because auto-run saves it already)
          try {
            await window.api.saveFileContents(activeFile, diffedText)
            setIsDirty(false)
            if (typeof markFileClean === 'function') {
              markFileClean(activeFile)
            }
          } catch (err) {
            console.error("Force save failed:", err)
          }
        }
      }
    }
    window.addEventListener('force-apply-diff', handleForceApplyDiff)
    return () => window.removeEventListener('force-apply-diff', handleForceApplyDiff)
  }, [activeFile])

  // Listen for 'auto-apply-diff' events from the AI
  useEffect(() => {
    const handleAutoApplyDiff = (e) => {
      const { path, body } = e.detail
      const normalize = (p) => (p || '').replace(/\\/g, '/').toLowerCase()
      if (normalize(activeFile) === normalize(path) && editorRef.current) {
        const model = editorRef.current.getModel()
        let newText = model.getValue()

        const { newText: diffedText, hasChanges, editRanges } = applyDiff(newText, body)

        if (hasChanges) {
          setOriginalText(newText)
          newText = diffedText

          const viewState = editorRef.current.saveViewState()
          editorRef.current.pushUndoStop()
          editorRef.current.executeEdits("ai-diff", [{
            range: model.getFullModelRange(),
            text: newText
          }])
          editorRef.current.pushUndoStop()
          editorRef.current.restoreViewState(viewState)

          if (editRanges && editRanges.length > 0 && monacoRef.current && decorationsCollectionRef.current) {
            const monacoRanges = editRanges.map(r => ({
              range: new monacoRef.current.Range(r.startLine, 1, r.endLine, 1),
              options: {
                isWholeLine: true,
                className: 'ai-edit-highlight',
                marginClassName: 'ai-edit-highlight'
              }
            }))
            decorationsCollectionRef.current.set(monacoRanges)
            setHasActiveAiEdit(true)
          }
        }
      }
    }
    window.addEventListener('auto-apply-diff', handleAutoApplyDiff)
    return () => window.removeEventListener('auto-apply-diff', handleAutoApplyDiff)
  }, [activeFile])

  // Handle Content Change — also notify LSP
  const handleEditorChange = (value) => {
    if (!activeFile) return
    setCurrentValue(value)

    setFileContents(prev => ({
      ...prev,
      [activeFile]: { ...prev[activeFile], content: value }
    }))

    markFileDirty(activeFile)

    // Notify the right LSP client
    const monacoLang = getLanguageFromPath(activeFile)
    const lspKey = lspLanguageKey(monacoLang)
    if (lspKey) {
      const client = lspClients.get(lspKey)
      if (client && client.initialized) {
        client.didChange(pathToUri(activeFile), value)
      }
    }
  }

  const saveActiveFile = async () => {
    if (!activeFile) return
    const content = editorRef.current.getValue()
    const res = await window.api.saveFileContents(activeFile, content)
    if (res.success) {
      markFileClean(activeFile)
    } else {
      console.error('Failed to save file:', res.error)
    }
  }

  if (openFiles.length === 0) {
    return (
      <div className="editor-empty">
        <div className="editor-logo">π</div>
        <p>Open a file from the explorer to start coding.</p>
      </div>
    )
  }

  return (
    <div className="editor-container" style={{ position: 'relative' }}>
      <div className="editor-tabs">
        {openFiles.map((file, idx) => {
          const isActive = file.path === activeFile
          return (
            <div
              key={file.path}
              className={`editor-tab ${isActive ? 'active' : ''} ${draggedTabIdx === idx ? 'dragging' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, idx)}
              onClick={() => setActiveFile(file.path)}
              onContextMenu={(e) => handleContextMenu(e, file, idx)}
            >
              <span className="tab-name">{file.name}</span>
              <div
                className="tab-action"
                onClick={(e) => {
                  e.stopPropagation()
                  closeFile(file.path)
                }}
              >
                {file.isDirty ? <Circle size={10} className="dirty-dot" fill="currentColor" /> : <X size={14} className="close-icon" />}
              </div>
            </div>
          )
        })}

        {/* Run & Optimizer Button Container inside tabs header */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '12px' }}>
          <button
            className="action-btn compress-context-btn"
            onClick={(e) => {
              e.stopPropagation()
              setShowContextInspector(true)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-elevated)', color: 'var(--accent-color)', padding: '4px 12px', border: '1px solid var(--border-base)', borderRadius: '4px', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem' }}
          >
            <Sparkles size={14} />
            Compress Context
          </button>
          <button
            className="action-btn"
            onClick={(e) => {
              e.stopPropagation()
              if (onRun) onRun()
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#10a37f', color: '#fff', padding: '4px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem' }}
          >
            ▶ Run
          </button>
        </div>
      </div>

      {/* ── Context Menu Overlay ── */}
      {contextMenu && (
        <div
          className="tab-context-menu"
          style={{
            position: 'fixed', // Use fixed to position relative to viewport
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 9999
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="tab-context-menu-item" onClick={(e) => handleContextAction('close', e)}>
            <span>Close</span>
          </div>
          <div className="tab-context-menu-item" onClick={(e) => handleContextAction('closeOthers', e)}>
            <span>Close Others</span>
          </div>
          <div className="tab-context-menu-item" onClick={(e) => handleContextAction('closeToRight', e)}>
            <span>Close to the Right</span>
          </div>
          <div className="tab-context-menu-item" onClick={(e) => handleContextAction('closeSaved', e)}>
            <span>Close Saved</span>
          </div>
          <div className="tab-context-menu-item" onClick={(e) => handleContextAction('closeAll', e)}>
            <span>Close All</span>
          </div>
          <div className="tab-context-menu-separator"></div>
          <div className="tab-context-menu-item" onClick={(e) => handleContextAction('copyPath', e)}>
            <span>Copy Path</span>
          </div>
          <div className="tab-context-menu-item" onClick={(e) => handleContextAction('copyRelativePath', e)}>
            <span>Copy Relative Path</span>
          </div>
        </div>
      )}

      {activeFile && !activeFile.startsWith('ext:') && !activeFile.startsWith('git-graph:') && (() => {
        const relPath = projectRoot && activeFile.startsWith(projectRoot)
          ? activeFile.substring(projectRoot.length).replace(/^[\\/]/, '')
          : activeFile
        const parts = relPath.split(/[\\/]/).filter(Boolean)
        return (
          <div className="editor-breadcrumb">
            {parts.map((part, i) => (
              <span key={i} className="breadcrumb-segment">
                {i > 0 && <ChevronRight size={12} className="breadcrumb-sep" />}
                <span className={i === parts.length - 1 ? 'breadcrumb-current' : 'breadcrumb-part'}>{part}</span>
              </span>
            ))}
          </div>
        )
      })()}

      <div className="editor-body">
        {inlineAi.visible && (
          <div
            className="inline-ai-widget"
            style={{ top: inlineAi.top, left: inlineAi.left }}
          >
            <input
              autoFocus
              type="text"
              placeholder="Ask AI to edit or generate code..."
              value={inlineAi.prompt}
              onChange={(e) => setInlineAi(prev => ({ ...prev, prompt: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !inlineAi.isLoading) {
                  submitInlineAi()
                } else if (e.key === 'Escape') {
                  setInlineAi(prev => ({ ...prev, visible: false }))
                }
              }}
              disabled={inlineAi.isLoading}
            />
            {inlineAi.isLoading && <span className="inline-ai-spinner">Generating...</span>}
          </div>
        )}

        {fileContents[activeFile]?.isLoading && (
          <div className="editor-loading">Loading...</div>
        )}

        {hasActiveAiEdit && (
          <div className="ai-edit-widget">
            <span className="ai-edit-widget-text">AI Edit Applied</span>
            <div className="ai-edit-widget-actions">
              <button
                className="ai-btn-revert"
                style={{ color: '#60a5fa', borderColor: '#60a5fa' }}
                onClick={() => setShowDiff(!showDiff)}
              >
                {showDiff ? 'Hide Diff' : 'View Diff'}
              </button>
              <button className="ai-btn-revert" onClick={handleRevertEdit}>Revert</button>
              <button className="ai-btn-accept" onClick={handleAcceptEdit}>Accept</button>
            </div>
          </div>
        )}

        {activeFile && activeFile.startsWith('git-graph:') ? (
          <GitGraph projectRoot={projectRoot} />
        ) : activeFile === 'postman:main' ? (
          <PostmanView />
        ) : activeFile && activeFile.startsWith('ext:') ? (
          (function() {
            const extId = activeFile.replace('ext:', '')
            // Use global extensions state
            const ext = extensions.find(e => e.id === extId)
            if (!ext) return <div className="editor-loading" style={{ padding: '20px' }}>Extension not found.</div>
            
            const handleToggle = () => {
              const newEnabled = !ext.enabled
              toggleExtension(extId, ext.category)
              if (ext.category === 'theme' && newEnabled) {
                setActiveTheme(extId.replace('theme-', ''))
              }
            }

            return (
              <div style={{ padding: '40px', color: 'var(--text-main)', maxWidth: '800px', margin: '0 auto', overflowY: 'auto', height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px', marginBottom: '30px' }}>
                  <div style={{ width: '80px', height: '80px', backgroundColor: 'var(--bg-elevated)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-base)' }}>
                    <span style={{ fontSize: '32px' }}>🧩</span>
                  </div>
                  <div>
                    <h1 style={{ fontSize: '24px', margin: '0 0 8px 0', color: 'var(--text-primary)' }}>{ext.name}</h1>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                      <span style={{ color: 'var(--accent-color)' }}>{ext.author}</span>
                      <span style={{ margin: '0 8px' }}>•</span>
                      <span>{ext.category.toUpperCase()}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      {ext.enabled ? (
                        <button onClick={handleToggle} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-base)', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer' }}>Manage</button>
                      ) : (
                        <button onClick={handleToggle} style={{ background: 'var(--accent-color)', color: 'var(--accent-text)', border: 'none', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer' }}>Install</button>
                      )}
                    </div>
                  </div>
                </div>
                <h2 style={{ fontSize: '16px', borderBottom: '1px solid var(--border-base)', paddingBottom: '8px', marginBottom: '16px' }}>Details</h2>
                <p style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                  {ext.longDescription || ext.description}
                </p>
              </div>
            )
          })()
        ) : !fileContents[activeFile]?.isLoading && (
          effectiveShowDiff ? (
            <DiffEditor
              height="100%"
              original={effectiveOriginalText}
              modified={currentValue}
              language={getLanguageFromPath(activeFile)}
              theme={monacoTheme}
              onMount={handleDiffEditorMountWrapper}
              options={{
                renderSideBySide: true,
                minimap: { enabled: false },
                readOnly: !isGitDiff,
                padding: { top: 16 },
                glyphMargin: false,
                lineDecorationsWidth: 16
              }}
            />
          ) : (
            <Editor
              height="100%"
              path={pathToUri(activeFile)}
              language={getLanguageFromPath(activeFile)}
              theme={monacoTheme}
              value={currentValue}
              onChange={handleEditorChange}
              onMount={handleEditorDidMountWrapper}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                wordWrap: 'on',
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                formatOnPaste: true,
                automaticLayout: true,
                inlineSuggest: { enabled: true },
                glyphMargin: false,
                lineDecorationsWidth: 16
              }}
            />
          )
        )}
      </div>
      
      <ContextInspector 
        isOpen={showContextInspector} 
        onClose={() => setShowContextInspector(false)} 
        originalCode={currentValue}
        filePath={activeFile}
      />
    </div>
  )
}
