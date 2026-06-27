import React, { useState, useEffect, useRef } from 'react'
import Editor, { loader, DiffEditor } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { applyDiff } from '../diffUtils'
import { X, Save, Circle } from 'lucide-react'

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
    c: 'c', hpp: 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'c',
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
  projectRoot
}) => {
  const [fileContents, setFileContents] = useState({})
  const [currentValue, setCurrentValue] = useState('')
  const [draggedTabIdx, setDraggedTabIdx] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const editorRef = useRef(null)

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
    if (!activeFile) return

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

  const handleSave = async () => {
    if (!activeFile || !editorRef.current) return
    const content = editorRef.current.getValue()
    
    const res = await window.api.saveFileContents(activeFile, content)
    if (res.success) {
      setFileContents(prev => ({
        ...prev,
        [activeFile]: { ...prev[activeFile], content }
      }))
      markFileClean(activeFile)
    } else {
      console.error('Failed to save file:', res.error)
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
      handleSave()
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
  }

  // Set up refs for decorations
  const monacoRef = useRef(null)
  const decorationsCollectionRef = useRef(null)
  const [hasActiveAiEdit, setHasActiveAiEdit] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [originalText, setOriginalText] = useState(null)

  const handleEditorDidMountWrapper = (editor, monacoInstance) => {
    monacoRef.current = monacoInstance
    decorationsCollectionRef.current = editor.createDecorationsCollection([])
    handleEditorDidMount(editor, monacoInstance)
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
          
          editorRef.current.pushUndoStop()
          editorRef.current.executeEdits("ai-diff", [{
            range: model.getFullModelRange(),
            text: newText
          }])
          editorRef.current.pushUndoStop()

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
      
      <div className="editor-body">
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

        {!fileContents[activeFile]?.isLoading && (
          showDiff ? (
            <DiffEditor
              height="100%"
              original={originalText}
              modified={currentValue}
              language={getLanguageFromPath(activeFile)}
              theme="vs-dark"
              options={{
                renderSideBySide: true,
                minimap: { enabled: false },
                readOnly: true,
                padding: { top: 16 }
              }}
            />
          ) : (
            <Editor
              height="100%"
              path={pathToUri(activeFile)}
              language={getLanguageFromPath(activeFile)}
              theme="vs-dark"
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
              }}
            />
          )
        )}
      </div>
    </div>
  )
}
