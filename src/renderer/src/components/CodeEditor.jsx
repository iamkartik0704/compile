import React, { useState, useEffect, useRef } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
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
    js: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    html: 'html', css: 'css', json: 'json',
    md: 'markdown', py: 'python', sh: 'shell',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    go: 'go', rs: 'rust', bash: 'shell',
    xml: 'xml', yaml: 'yaml', yml: 'yaml'
  }
  return map[ext] || 'plaintext'
}

// Maps our language IDs to the LSP language key used by the backend
const lspLanguageKey = (lang) => {
  const map = { python: 'python', c: 'c', cpp: 'cpp', go: 'go', rust: 'rust', shell: 'shell' }
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
  activeFile, 
  setActiveFile, 
  closeFile, 
  markFileDirty, 
  markFileClean 
}) => {
  const [fileContents, setFileContents] = useState({})
  const [currentValue, setCurrentValue] = useState('')
  const editorRef = useRef(null)

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

          const targetUri = params.uri
          const models = monaco.editor.getModels()
          const model = models.find(m => m.uri.toString() === targetUri)
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

  // Handle Monaco Mount
  const handleEditorDidMount = (editor, monacoInstance) => {
    editorRef.current = editor

    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      saveActiveFile()
    })
  }

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
    <div className="editor-container">
      <div className="editor-tabs">
        {openFiles.map(file => {
          const isActive = file.path === activeFile
          return (
            <div 
              key={file.path} 
              className={`editor-tab ${isActive ? 'active' : ''}`}
              onClick={() => setActiveFile(file.path)}
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
      
      <div className="editor-body">
        {fileContents[activeFile]?.isLoading ? (
          <div className="editor-loading">Loading...</div>
        ) : (
          <Editor
            height="100%"
            path={pathToUri(activeFile)}
            language={getLanguageFromPath(activeFile)}
            theme="vs-dark"
            value={currentValue}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
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
            }}
          />
        )}
      </div>
    </div>
  )
}
