import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Editor, { loader, DiffEditor, useMonaco } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { applyDiff } from '../diffUtils'
import { X, Save, Circle, Sparkles, ChevronRight, AlertTriangle, Info, CheckCircle, Loader2, Code2 } from 'lucide-react'
import { ContextInspector } from './ContextInspector'
import { GitGraph } from './GitGraph'
import { PostmanView } from './PostmanView'
import { SettingsEditor } from './SettingsEditor'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { useAppStore } from '../store/appStore'
import { EXTENSIONS } from '../utils/extensionRegistry'
import { runEsLint, runPrettier, formatWithPrettier, isExtensionEnabled } from '../utils/linterService'
import { diffLines } from 'diff'
import { useShortcutStore, defaultShortcuts } from '../store/shortcutStore'
import {
  useDiagnosticsStore,
  useFileCounts,
  useFolderCounts,
  lspSeverityToString,
  monacoSeverityToString
} from '../store/diagnosticsStore'
import {
  installSharedLspDispatcher,
  subscribeToLspMessages
} from '../services/workspaceDiagnosticsScanner'

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

// ─── Global Keybinding Registry Sync ───
let isMonacoKeybindingsSynced = false;
let previousShortcuts = null;



const mapCustomIdToMonacoCommandId = (id) => {
  switch (id) {
    case 'edit.undo': return 'undo';
    case 'edit.redo': return 'redo';
    case 'edit.cut': return 'editor.action.clipboardCutAction';
    case 'edit.copy': return 'editor.action.clipboardCopyAction';
    case 'edit.paste': return 'editor.action.clipboardPasteAction';
    case 'edit.find': return 'actions.find';
    case 'edit.replace': return 'editor.action.startFindReplaceAction';
    case 'edit.selectAll': return 'editor.action.selectAll';
    case 'edit.duplicateLine': return 'editor.action.copyLinesDownAction';
    case 'edit.moveLineUp': return 'editor.action.moveLinesUpAction';
    case 'edit.moveLineDown': return 'editor.action.moveLinesDownAction';
    case 'edit.commentLine': return 'editor.action.commentLine';
    case 'edit.format': return 'compile.formatDocument';
    case 'edit.inlineAi': return 'compile.inlineAi';
    case 'edit.multiCursor': return 'editor.action.insertCursorAtEndOfEachLineSelected';
    case 'nav.goToLine': return 'editor.action.gotoLine';
    case 'nav.goToDef': return 'editor.action.revealDefinition';
    case 'nav.goToRef': return 'editor.action.referenceSearch.trigger';
    case 'ai.autocomplete': return 'editor.action.inlineSuggest.trigger';
    case 'ai.accept': return 'editor.action.inlineSuggest.commit';
    case 'ai.dismiss': return 'editor.action.inlineSuggest.hide';
    default: return null;
  }
}



// ─── Lightweight LSP Client ────────────────────────────────────────
// ─── Lightweight LSP Client (per-language) ─────────────────────────
// Speaks JSON-RPC directly over our IPC bridge.
class LspClient {
  constructor(language) {
    this.language = language
    this.requestId = 0
    this.pendingRequests = new Map()
    this.onDiagnostics = null
    this.onDiagnostics = null
    this.initialized = false
  }

  // Called by the global message dispatcher
  handleMessage(raw) {
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw
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

  didChange(uri, text, version) {
    this.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }]
    })
  }

  async completion(uri, line, character, context = null) {
    const params = {
      textDocument: { uri },
      position: { line, character }
    }
    if (context) params.context = context

    return this.sendRequest('textDocument/completion', params)
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
  // Lowercase the drive letter for Monaco compatibility (e.g. /C:/ -> /c:/)
  formatted = formatted.replace(/^\/([A-Z]):\//, (match, drive) => `/${drive.toLowerCase()}:/`)
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

  // Use the shared LSP dispatcher instead of taking over the raw
  // IPC channel with removeAllListeners. The workspace diagnostics
  // scanner also needs to see publishDiagnostics, and preload's
  // onLspMessage clobbers previous listeners, so both parties MUST
  // route through this fan-out.
  installSharedLspDispatcher()

  // Subscribe the per-language editor client for every LSP we know
  // about. Editor clients are created lazily on-demand, so we just
  // dispatch when one exists.
  const editorHandler = (lspKey) => (raw) => {
    const client = lspClients.get(lspKey)
    if (client) client.handleMessage(raw)
  }
  for (const key of ['javascript', 'typescript', 'python', 'c', 'cpp', 'go', 'rust', 'java']) {
    subscribeToLspMessages(key, editorHandler(key))
  }

  if (window.api.onLspServerReset) {
    window.api.onLspServerReset((language) => {
      // Clear markers for all models belonging to this language
      const models = monaco.editor.getModels()
      models.forEach(model => {
        if (lspLanguageKey(model.getLanguageId()) === language) {
          monaco.editor.setModelMarkers(model, `lsp-${language}`, [])
        }
      })
      // Also drop this LSP's contribution from the workspace store
      // so stale error badges don't linger after the user changes
      // compilers or restarts a server.
      useDiagnosticsStore.getState().clearSource(`lsp-${language}`)
    })
  }
}

function registerProvidersForLanguage(monacoLangId) {
  if (registeredProviders.has(monacoLangId)) return
  registeredProviders.add(monacoLangId)

  const findClient = () => {
    const key = lspLanguageKey(monacoLangId)
    return key ? lspClients.get(key) : null
  }

  // ── Ghost Text Auto-Completion (Copilot) ──
  monaco.languages.registerInlineCompletionsProvider(monacoLangId, {
    provideInlineCompletions: async (model, position, context, token) => {
      if (!globalAiConfig || globalAiConfig.autoCompleteEnabled === false) return { items: [] }

      // 1. Native Debounce using cancellation token
      // Increased default delay to 2000ms to prevent popping up on every keystroke
      await new Promise(resolve => setTimeout(resolve, globalAiConfig.autoCompleteDelay || 2000))
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
    provideCompletionItems: async (model, position, context, token) => {
      const client = findClient()
      if (!client || !client.initialized) return { suggestions: [] }
      
      const uri = decodeURIComponent(model.uri.toString())
      // LSP uses 1 = Invoked (Ctrl+Space), 2 = Trigger Character, 3 = Incomplete
      const triggerKind = context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter ? 2 : 1
      
      const result = await client.completion(uri, position.lineNumber - 1, position.column - 1, {
        triggerKind,
        triggerCharacter: context.triggerCharacter
      })
      
      const items = Array.isArray(result) ? result : (result.items || null)
      if (!items) return { suggestions: [] }

      const word = model.getWordUntilPosition(position)
      
      const suggestions = items.map(item => {
        let insertText = item.insertText || item.label
        let range = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn
        }

        if (item.textEdit) {
          insertText = item.textEdit.newText
          if (item.textEdit.range) {
            range = {
              startLineNumber: item.textEdit.range.start.line + 1,
              startColumn: item.textEdit.range.start.character + 1,
              endLineNumber: item.textEdit.range.end.line + 1,
              endColumn: item.textEdit.range.end.character + 1
            }
          }
        }

        const mappedItem = {
          label: item.label,
          kind: completionKindMap[item.kind] || monaco.languages.CompletionItemKind.Text,
          detail: item.detail || '',
          documentation: item.documentation?.value || item.documentation || '',
          insertText,
          range
        }
        
        if (item.filterText) mappedItem.filterText = item.filterText
        if (item.sortText) mappedItem.sortText = item.sortText
        if (item.insertTextFormat === 2) {
          mappedItem.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        }
        
        return mappedItem
      })
      
      console.log(`[LSP] Returning ${suggestions.length} suggestions, incomplete:`, result.isIncomplete)
      return { suggestions, incomplete: result.isIncomplete || false }
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

// ─── Editor Tab (with diagnostic badge) ────────────────────────────
// Own its own subscription to `useFileCounts` so a single file's
// diagnostics change doesn't force every tab in the strip to re-render.
const EditorTab = ({ file, isActive, isDragging, onDragStart, onDragOver, onDrop, onClick, onContextMenu, onClose }) => {
  const counts = useFileCounts(file.path)
  const hasError = counts.error > 0
  const hasWarn = counts.warning > 0
  return (
    <div
      className={`editor-tab ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${hasError ? 'has-error' : hasWarn ? 'has-warning' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="tab-name">{file.name}</span>
      {(hasError || hasWarn) && (
        <span className={`diagnostic-badge ${hasError ? 'error' : 'warning'}`} title={`${counts.error} error${counts.error === 1 ? '' : 's'}, ${counts.warning} warning${counts.warning === 1 ? '' : 's'}`}>
          {hasError ? counts.error : counts.warning}
        </span>
      )}
      <div
        className="tab-action"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        {file.isDirty ? <Circle size={10} className="dirty-dot" fill="currentColor" /> : <X size={14} className="close-icon" />}
      </div>
    </div>
  )
}

const findMonacoModel = (targetFilePath) => {
  if (!targetFilePath || !window.monaco || !window.monaco.editor) return null;
  
  // Universal URL-decoding and path cleaning utility
  const clean = (str) => {
    if (!str || typeof str !== 'string') return '';
    let decoded = str;
    try {
      decoded = decodeURIComponent(str);
    } catch (e) {
      decoded = str;
    }
    return decoded
      .replace(/^file:\/\/\//i, '')
      .replace(/^file:\/\//i, '')
      .replace(/\\/g, '/')
      .replace(/\/$/, '')
      .toLowerCase()
      .trim();
  };

  const targetClean = clean(targetFilePath);
  const allModels = window.monaco.editor.getModels();

  // 🔍 THE DIAGNOSTIC X-RAY: Log all open models in RAM so we can see exactly what Monaco is holding
  const availableModelPaths = allModels.map(m => ({
    fsPath: m.uri.fsPath,
    path: m.uri.path,
    str: m.uri.toString()
  }));
  console.log(`[Monaco X-Ray] Seeking: "${targetClean}" | Active Models in RAM (${allModels.length}):`, availableModelPaths);

  // Perform ultra-fuzzy matching across all three Monaco URI properties
  return allModels.find((model) => {
    const u = model.uri;
    const candidate1 = clean(u.fsPath);
    const candidate2 = clean(u.path);
    const candidate3 = clean(u.toString());

    // Check exact match or boundary ending match across any of the three properties
    return candidate1 === targetClean || candidate2 === targetClean || candidate3 === targetClean ||
           candidate1.endsWith(targetClean) || candidate2.endsWith(targetClean) || candidate3.endsWith(targetClean) ||
           targetClean.endsWith(candidate1) || targetClean.endsWith(candidate2) || targetClean.endsWith(candidate3);
  });
};

const formatLspDiagnosticsToMonaco = (diagnostics) => {
  if (!Array.isArray(diagnostics)) return [];

  return diagnostics.map((diag) => {
    const range = diag.range || {};
    const start = range.start || { line: 0, character: 0 };
    const end = range.end || { line: start.line, character: start.character + 1 };

    // DEFENSIVE MATH: LSP is 0-indexed; Monaco strictly mandates >= 1 integers.
    const startLineNumber = Math.max(1, Math.floor((typeof start.line === 'number' ? start.line : 0) + 1));
    const startColumn = Math.max(1, Math.floor((typeof start.character === 'number' ? start.character : 0) + 1));
    const endLineNumber = Math.max(1, Math.floor((typeof end.line === 'number' ? end.line : startLineNumber - 1) + 1));
    const endColumn = Math.max(1, Math.floor((typeof end.character === 'number' ? end.character : startColumn) + 1));

    // Map LSP severity integers (1=Error, 2=Warning, 3=Info, 4=Hint) to Monaco severities
    let monacoSeverity = window.monaco ? window.monaco.MarkerSeverity.Error : 8;
    if (diag.severity === 2) monacoSeverity = window.monaco ? window.monaco.MarkerSeverity.Warning : 4;
    if (diag.severity === 3) monacoSeverity = window.monaco ? window.monaco.MarkerSeverity.Info : 2;
    if (diag.severity === 4) monacoSeverity = window.monaco ? window.monaco.MarkerSeverity.Hint : 1;

    return {
      severity: monacoSeverity,
      startLineNumber: startLineNumber,
      startColumn: startColumn,
      endLineNumber: endLineNumber,
      endColumn: endColumn,
      message: diag.message || 'Syntax Error',
      source: diag.source || 'clangd'
    };
  });
};

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
  onRun,
  groupId,
  onSplitRight,
  onCloseGroup,
  onDropToTerminal
}) => {
  const monaco = useMonaco()
  
  useEffect(() => {
    if (monaco) {
      monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true)
      monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true)
      
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      })

      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        allowNonTsExtensions: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        noEmit: true,
        allowJs: true,
        checkJs: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        jsx: monaco.languages.typescript.JsxEmit.React
      })

      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        allowNonTsExtensions: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        noEmit: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        jsx: monaco.languages.typescript.JsxEmit.React
      })

      // ─── Global marker bridge ───────────────────────────────
      // Monaco's built-in TS/JS/JSON/CSS/HTML workers publish
      // diagnostics via `setModelMarkers`, NOT via our LSP
      // pipeline. Without this bridge the file-tree badges would
      // silently miss every worker error and the user would only
      // see them by opening the file. Every marker change — from
      // any owner — flows into the diagnostics store so the
      // sidebar and tabs stay in sync with what Monaco actually
      // renders.
      const disposable = monaco.editor.onDidChangeMarkers((uris) => {
        for (const uri of uris) {
          const all = monaco.editor.getModelMarkers({ resource: uri })
          const uriStr = uri.toString()
          // Group markers by owner so we can update per-source
          // buckets cleanly (LSP has its own path already).
          const byOwner = new Map()
          for (const m of all) {
            const owner = m.owner || 'monaco'
            if (owner.startsWith('lsp-')) continue // Handled by LSP client directly.
            if (!byOwner.has(owner)) byOwner.set(owner, [])
            byOwner.get(owner).push({
              severity: monacoSeverityToString(m.severity),
              message: m.message,
              line: m.startLineNumber,
              column: m.startColumn,
              source: owner
            })
          }
          const known = ['monaco', 'typescript', 'javascript', 'json', 'css', 'html', 'eslint']
          for (const owner of known) {
            useDiagnosticsStore.getState().setDiagnostics(
              uriStr,
              owner === 'eslint' ? 'eslint' : `monaco-${owner}`,
              byOwner.get(owner) || []
            )
          }
        }
      })
      return () => disposable.dispose()
    }
  }, [monaco])

  const [fileContents, setFileContents] = useState({})
  const [currentValue, setCurrentValue] = useState('')
  const [draggedTabIdx, setDraggedTabIdx] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [editorContextMenu, setEditorContextMenu] = useState(null)
  const [showContextInspector, setShowContextInspector] = useState(false)
  const editorRef = useRef(null)
  const pendingDiagnosticsRef = useRef(null)
  const coldBootTimerRef = useRef(null)

  useEffect(() => {
    return () => {
      if (coldBootTimerRef.current) clearTimeout(coldBootTimerRef.current)
    }
  }, [])

  // Accumulator for smooth trackpad pinch
  const accumulatedDeltaRef = useRef(0)
  
  const handleWheelCapture = (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    e.stopPropagation()
    
    accumulatedDeltaRef.current += e.deltaY
    if (Math.abs(accumulatedDeltaRef.current) < 40) return
    
    const step = accumulatedDeltaRef.current > 0 ? -0.5 : 0.5
    accumulatedDeltaRef.current = 0
    
    setEditorSettings(prev => {
      const newZoom = Math.max(-3, Math.min(5, (prev.zoomLevel || 0) + step))
      localStorage.setItem('editor-zoomLevel', String(newZoom))
      window.dispatchEvent(new CustomEvent('settings-changed', { detail: { key: 'editor-zoomLevel', value: newZoom } }))
      return { ...prev, zoomLevel: newZoom }
    })
  }

  // Use global app store for extensions and theme
  const { extensions, toggleExtension, activeTheme, setActiveTheme, autoSave } = useAppStore()

  const [editorSettings, setEditorSettings] = useState({
    fontSize: parseInt(localStorage.getItem('editor-fontSize') || '14'),
    fontFamily: localStorage.getItem('editor-fontFamily') || "'JetBrains Mono', 'Fira Code', monospace",
    tabSize: parseInt(localStorage.getItem('editor-tabSize') || '2'),
    wordWrap: localStorage.getItem('editor-wordWrap') || 'on',
    minimap: localStorage.getItem('editor-minimap') === 'true',
    smoothScrolling: localStorage.getItem('editor-smoothScrolling') !== 'false',
    cursorBlinking: localStorage.getItem('editor-cursorBlinking') || 'smooth',
    lineNumbers: localStorage.getItem('editor-lineNumbers') || 'on',
    formatOnPaste: localStorage.getItem('editor-formatOnPaste') !== 'false',
    renderWhitespace: localStorage.getItem('editor-renderWhitespace') || 'selection',
    autoClosingBrackets: localStorage.getItem('editor-autoClosingBrackets') || 'always',
    inlineSuggest: localStorage.getItem('editor-inlineSuggest') !== 'false',
    cursorStyle: localStorage.getItem('editor-cursorStyle') || 'line',
    bracketPairs: localStorage.getItem('editor-bracketPairs') !== 'false',
    stickyScroll: localStorage.getItem('editor-stickyScroll') !== 'false',
    zoomLevel: parseFloat(localStorage.getItem('editor-zoomLevel') || '0')
  })



  useEffect(() => {
    const handleSettingsChanged = (e) => {
      const { key, value } = e.detail
      if (key.startsWith('editor-')) {
        const settingName = key.replace('editor-', '')
        setEditorSettings(prev => ({ ...prev, [settingName]: value }))
      }
    }
    window.addEventListener('settings-changed', handleSettingsChanged)
    return () => window.removeEventListener('settings-changed', handleSettingsChanged)
  }, [])







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
    if (editorRef.current && activeFile && fileContents && fileContents[activeFile]?.content?.trim() !== '') {
      // Small 50ms debounce guarantees Monaco's internal .setValue() finishes before we re-apply markers
      const restoreTimer = setTimeout(() => {
        restoreCachedDiagnostics(activeFile);
      }, 50);
      return () => clearTimeout(restoreTimer);
    }
  }, [fileContents, activeFile]);

  useEffect(() => {
    const handleLiveDiagnostics = ({ filePath, diagnostics }) => {
      // Ignore live IPC diagnostics for JS/TS if Monaco native workers are managing them
      if (filePath.endsWith('.js') || filePath.endsWith('.ts')) return;

      console.log(`[Live IPC Receiver] Received ${diagnostics ? diagnostics.length : 0} diagnostics for: ${filePath}`);

      const targetModel = findMonacoModel(filePath);
      if (targetModel) {
        console.log(`[Live IPC Receiver] ✅ MATCHED MODEL! Injecting ${diagnostics ? diagnostics.length : 0} markers into: ${targetModel.uri.toString()}`);
        const formattedMarkers = formatLspDiagnosticsToMonaco(diagnostics);
        window.monaco.editor.setModelMarkers(targetModel, 'backend-lsp-engine', formattedMarkers);

        if (editorRef.current && editorRef.current.getModel() === targetModel) {
          requestAnimationFrame(() => editorRef.current.layout());
        }
      } else {
        console.warn(`[Live IPC Receiver] ❌ FAILED MATCH for: ${filePath}`);
      }
    };

    if (window.api && window.api.onLspDiagnostics) {
      window.api.onLspDiagnostics(handleLiveDiagnostics);
    }
    return () => {
      if (window.api && window.api.removeLspDiagnostics) {
        window.api.removeLspDiagnostics(handleLiveDiagnostics);
      }
    }
  }, []);

  useEffect(() => {
    globalActiveFile = activeFile

    // NOTE: Historically this block was guarded by `window.api.invoke`
    // which does not exist on the preload API — so `ensureCompilationDb`
    // never actually ran, and clangd was left with no compile_commands.json
    // entries. That produced red squiggles on perfectly valid C/C++ code
    // because clangd fell back to default flags and couldn't resolve
    // system headers. The correct guard is on `ensureCompilationDb` itself.
    if (activeFile && projectRoot && window.api?.ensureCompilationDb) {
      const ext = activeFile.split('.').pop().toLowerCase()
      if (['c', 'cpp', 'cc', 'cxx', 'c++', 'h', 'hpp', 'hxx', 'hh', 'inl', 'ipp'].includes(ext)) {
        window.api.ensureCompilationDb({
          filepath: activeFile,
          workspaceRoot: projectRoot
        }).catch(err => console.error('Failed to ensure compilation db:', err))
      }
    }
  }, [activeFile, projectRoot])

  // Close context menu on outside click
  useEffect(() => {
    const closeContextMenu = () => {
      setContextMenu(null)
      setEditorContextMenu(null)
    }
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

  const handleEditorContextAction = async (actionId, e) => {
    e.stopPropagation()
    setEditorContextMenu(null)
    if (editorRef.current) {
      editorRef.current.focus()
      
      if (actionId === 'editor.action.clipboardPasteAction') {
        try {
          const text = await navigator.clipboard.readText()
          editorRef.current.executeEdits("context-menu", [{
            range: editorRef.current.getSelection(),
            text: text,
            forceMoveMarkers: true
          }])
        } catch (err) {
          console.error('Clipboard paste failed:', err)
        }
        return
      }
      if (actionId === 'editor.action.clipboardCopyAction' || actionId === 'editor.action.clipboardCutAction') {
        const text = editorRef.current.getModel().getValueInRange(editorRef.current.getSelection());
        if (text) {
          navigator.clipboard.writeText(text);
          if (actionId === 'editor.action.clipboardCutAction') {
            editorRef.current.executeEdits("context-menu", [{
              range: editorRef.current.getSelection(),
              text: ""
            }])
          }
        }
        return
      }
      
      const action = editorRef.current.getAction(actionId)
      if (action) {
        action.run()
      } else {
        editorRef.current.trigger('keyboard', actionId, null)
      }
    }
  }

  // Load file content when active file changes
  useEffect(() => {
    if (!activeFile) return
    if (activeFile.startsWith('ext:') || activeFile.startsWith('git-graph:')) return

    if (activeFile.startsWith('untitled:')) {
      if (!fileContents[activeFile]) {
        setFileContents(prev => ({ ...prev, [activeFile]: { content: '', isLoading: false } }))
        setCurrentValue('')
      } else {
        setCurrentValue(fileContents[activeFile].content)
      }
      return
    }

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
    if (!activeFile) return
    const monacoLang = getLanguageFromPath(activeFile)
    const lspKey = lspLanguageKey(monacoLang)
    if (!lspKey) return // No LSP for this language (e.g. html, json — Monaco handles those natively)

    installGlobalIpcListener()

    if (!lspClients.has(lspKey)) {
      const client = new LspClient(lspKey)
      client.initialized = true // backend owns initialize handshake now
      lspClients.set(lspKey, client)

      // Wire diagnostics to Monaco markers AND to the central
      // diagnostics store so the sidebar / tabs can render error
      // counts even for files the user hasn't opened yet.
      client.onDiagnostics = (params) => {
        // Markers are managed globally by handleLiveDiagnostics now.
        // We only feed the diagnostics store here for sidebar counts.
        useDiagnosticsStore.getState().setDiagnostics(
          params.uri,
          `lsp-${lspKey}`,
          (params.diagnostics || []).map(d => ({
            severity: lspSeverityToString(d.severity),
            message: d.message,
            line: (d.range?.start?.line ?? 0) + 1,
            column: (d.range?.start?.character ?? 0) + 1,
            source: d.source || lspKey
          }))
        )
      }

      registerProvidersForLanguage(monacoLang)
    }

    const content = fileContents[activeFile]?.content || currentValue || ''
    
    // Trigger immediate backend sync on tab open
    window.api.send('lsp:document-open', {
      filePath: activeFile,
      text: content,
      languageId: lspKey
    })

    // Immediately attempt to pull existing diagnostics
    restoreCachedDiagnostics(activeFile);

    // If opening a C/C++ file, spin up an adaptive poller to catch delayed heavy header compilation
    if (activeFile.endsWith('.cpp') || activeFile.endsWith('.c') || activeFile.endsWith('.h')) {
      let attempts = 0;
      const maxAttempts = 10; // Poll every 2s for up to 20s total

      const adaptivePoller = setInterval(async () => {
        attempts++;
        if (!editorRef.current) {
          clearInterval(adaptivePoller);
          return;
        }

        const targetModel = findMonacoModel(activeFile);
        if (!targetModel) return;

        // Check if markers are currently rendered on this model
        const currentMarkers = window.monaco.editor.getModelMarkers({ resource: targetModel.uri });

        // If markers are found, our job is done! Cancel the poller immediately.
        if (currentMarkers && currentMarkers.length > 0) {
          console.log(`[Adaptive Poller] Diagnostics detected on attempt ${attempts}. Shutting down poller.`);
          clearInterval(adaptivePoller);
          return;
        }

        // Otherwise, pull from backend cache in case live IPC broadcast was missed during mount
        try {
          const cached = await window.api.invoke('lsp:get-cached-diagnostics', { filePath: activeFile });
          if (cached && cached.length > 0) {
            console.log(`[Adaptive Poller] Caught delayed C++ diagnostics on attempt ${attempts}! Applying ${cached.length} markers.`);
            const formatted = formatLspDiagnosticsToMonaco(cached);
            window.monaco.editor.setModelMarkers(targetModel, 'backend-lsp-engine', formatted);
            requestAnimationFrame(() => editorRef.current.layout());
            clearInterval(adaptivePoller);
          }
        } catch (err) {
          console.error('[Adaptive Poller] Cache pull error:', err);
        }

        // Stop polling after 20 seconds to prevent background CPU cycles
        if (attempts >= maxAttempts) {
          console.log('[Adaptive Poller] Max attempts reached. Ending polling cycle.');
          clearInterval(adaptivePoller);
        }
      }, 2000);

      return () => {
        clearInterval(adaptivePoller);
        // Intentionally omitted: we do not emit 'lsp:document-close' on tab switch 
        // so the language server keeps the AST and diagnostics in RAM.
      };
    }

    return () => {
      // Intentionally omitted: we do not emit 'lsp:document-close' on tab switch 
      // so the language server keeps the AST and diagnostics in RAM.
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
        // Feed the workspace-wide diagnostics store so the sidebar
        // badge for this file updates instantly on save.
        useDiagnosticsStore.getState().setDiagnostics(
          activeFile,
          'eslint',
          lintRes.markers.map(m => ({
            severity: monacoSeverityToString(m.severity),
            message: m.message,
            line: m.startLineNumber,
            column: m.startColumn,
            source: 'eslint'
          }))
        )
      }
    }
  }

  // Handle Editor Action Events from the Menu
  useEffect(() => {
    const handleEditorAction = (e) => {
      const actionId = e.detail
      if (!editorRef.current) return
      
      // The editor loses focus when you click the top menu,
      // which causes interactive prompts (like Go to Line) to instantly close
      // or keystrokes to fail. We MUST refocus the editor first!
      editorRef.current.focus()

      const mappedId = mapCustomIdToMonacoCommandId(actionId) || actionId

      const action = editorRef.current.getAction(mappedId)
      if (action) {
        action.run()
      } else {
        // Fallback for native cursor history commands and editor core commands
        editorRef.current.trigger('keyboard', mappedId, null)
      }
    }

    window.addEventListener('editor-action', handleEditorAction)
    return () => window.removeEventListener('editor-action', handleEditorAction)
  }, [])

  // Jump to a specific line/column when the Search panel (or any caller) requests it.
  // Fired via: window.dispatchEvent(new CustomEvent('jump-to-line', { detail: { path, line, column, matchLength } }))
  useEffect(() => {
    const handleJumpToLine = (e) => {
      const detail = e.detail || {}
      // Only respond if this editor is showing the requested file (or no path filter given).
      if (detail.path && detail.path !== activeFile) return
      const editor = editorRef.current
      if (!editor) return

      const line = Math.max(1, parseInt(detail.line, 10) || 1)
      const column = Math.max(1, parseInt(detail.column, 10) || 1)
      const matchLength = parseInt(detail.matchLength, 10) || 0

      // Wait a tick so file content is loaded into the model.
      const doJump = () => {
        const model = editor.getModel()
        if (!model) return
        const lastLine = model.getLineCount()
        const targetLine = Math.min(line, lastLine)
        editor.revealLineInCenter(targetLine)
        if (matchLength > 0) {
          editor.setSelection({
            startLineNumber: targetLine,
            startColumn: column,
            endLineNumber: targetLine,
            endColumn: column + matchLength
          })
        } else {
          editor.setPosition({ lineNumber: targetLine, column })
        }
        editor.focus()
      }

      // If content is still 'Loading...' the model may not have the target line yet — retry once.
      const model = editor.getModel()
      if (model && model.getLineCount() >= line) {
        doJump()
      } else {
        setTimeout(doJump, 120)
      }
    }
    window.addEventListener('jump-to-line', handleJumpToLine)
    return () => window.removeEventListener('jump-to-line', handleJumpToLine)
  }, [activeFile])

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
        const activeModel = editor.getModel()
        const version = activeModel ? activeModel.getVersionId() : 1
        client.didChange(uri, editor.getValue(), version)

        // Clear active AI edit if the user starts typing manually
        if (hasActiveAiEdit) {
          setHasActiveAiEdit(false)
          if (decorationsCollectionRef.current) {
            decorationsCollectionRef.current.clear()
          }
        }
      })
    }

    // Removed hardcoded Ctrl+S since it's handled by global shortcuts

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
  
  // Removed useAppStore call from here
  
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

  const breakpointsRef = useRef(new Map())
  const breakpointDecorationsCollectionRef = useRef(null)

  const handleEditorBeforeMount = (monacoInstance) => {
    monacoInstance.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })

    monacoInstance.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monacoInstance.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monacoInstance.languages.typescript.ModuleKind.ESNext,
      noEmit: true,
      allowJs: true,
      checkJs: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      jsx: monacoInstance.languages.typescript.JsxEmit.React
    })

    monacoInstance.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })

    monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monacoInstance.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monacoInstance.languages.typescript.ModuleKind.ESNext,
      noEmit: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      jsx: monacoInstance.languages.typescript.JsxEmit.React
    })
  }

  const restoreCachedDiagnostics = async (filePath) => {
    if (!filePath || !window.monaco) return;
    try {
      const cachedDiagnostics = await window.api.invoke('lsp:get-cached-diagnostics', { filePath });
      if (!cachedDiagnostics || cachedDiagnostics.length === 0) return;

      const targetModel = findMonacoModel(filePath);
      if (targetModel) {
        const formattedMarkers = formatLspDiagnosticsToMonaco(cachedDiagnostics);
        window.monaco.editor.setModelMarkers(targetModel, 'backend-lsp-engine', formattedMarkers);

        // If this model is currently active in the editor widget, force an immediate visual layout update
        if (editorRef.current && editorRef.current.getModel() === targetModel) {
          requestAnimationFrame(() => editorRef.current.layout());
        }
      }
    } catch (err) {
      console.error('[Frontend] Diagnostic restoration failed:', err);
    }
  };

  const handleEditorDidMountWrapper = (editor, monacoInstance) => {
    editorRef.current = editor
    monacoRef.current = monacoInstance
    
    editor.onDidChangeModel(() => {
      if (activeFile) restoreCachedDiagnostics(activeFile);
    });
    
    editor.onContextMenu((e) => {
      e.event.preventDefault()
      setEditorContextMenu({
        x: e.event.browserEvent.clientX,
        y: e.event.browserEvent.clientY
      })
    })

    decorationsCollectionRef.current = editor.createDecorationsCollection([])
    gitDecorationsCollectionRef.current = editor.createDecorationsCollection([])
    errorLensDecorationsCollectionRef.current = editor.createDecorationsCollection([])
    breakpointDecorationsCollectionRef.current = editor.createDecorationsCollection([])

    // Breakpoint Click Handler
    editor.onMouseDown((e) => {
      if (e.target.type === monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const line = e.target.position.lineNumber
        const uri = editor.getModel().uri.toString()
        
        if (!breakpointsRef.current.has(uri)) breakpointsRef.current.set(uri, new Set())
        const bpSet = breakpointsRef.current.get(uri)
        
        if (bpSet.has(line)) {
          bpSet.delete(line)
        } else {
          bpSet.add(line)
        }
        
        const newDecorations = Array.from(bpSet).map(l => ({
          range: new monacoInstance.Range(l, 1, l, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: 'monaco-breakpoint-glyph'
          }
        }))
        
        breakpointDecorationsCollectionRef.current.set(newDecorations)
        
        useAppStore.getState().setBreakpoints(uri, Array.from(bpSet))

        // Also fire a global event so DebugPanel could potentially listen to it
        window.dispatchEvent(new CustomEvent('breakpoints-changed', { detail: { uri, breakpoints: Array.from(bpSet) } }))
      }
    })

    const hoverDecorationsCollectionRef = editor.createDecorationsCollection([])
    
    editor.onMouseMove((e) => {
      const targetType = e.target.type
      // 2 corresponds to GUTTER_GLYPH_MARGIN
      if (targetType === 2 || targetType === monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const line = e.target.position ? e.target.position.lineNumber : null
        if (line) {
          const uri = activeFile
          const bpSet = breakpointsRef.current.get(uri)
          if (!bpSet || !bpSet.has(line)) {
            hoverDecorationsCollectionRef.set([{
              range: new monacoInstance.Range(line, 1, line, 1),
              options: {
                isWholeLine: false,
                glyphMarginClassName: 'monaco-breakpoint-hint-glyph'
              }
            }])
            return
          }
        }
      }
      hoverDecorationsCollectionRef.clear()
    })

    editor.onMouseLeave(() => {
      hoverDecorationsCollectionRef.clear()
    })

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

    // Custom Action: Run File
    editor.addAction({
      id: 'compile.runFile',
      label: 'Run File',
      run: () => {
        window.dispatchEvent(new Event('global-run-file'))
      }
    })

    // Custom Action: Format Document
    editor.addAction({
      id: 'compile.formatDocument',
      label: 'Format Document (Prettier)',
      run: async () => {
        handleSave(true)
      }
    })

    // Error Lens Integration
    monacoInstance.editor.onDidChangeMarkers((uris) => {
      // Forcefully disabled as per user request to stop inline diagnostic text
      if (errorLensDecorationsCollectionRef.current) errorLensDecorationsCollectionRef.current.clear()
    })

    // Custom Action: Inline AI Edit
    editor.addAction({
      id: 'compile.inlineAi',
      label: 'Inline AI Edit',
      run: () => {
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
          top: pixelPos.top,
          left: pixelPos.left,
          prompt: '',
          isLoading: false,
          range,
          selectionText
        })
      }
    })

    // DAP Integration
    const dapPausedDecorationRef = { current: null }
    if (window.api && window.api.onDapPaused) {
      window.api.onDapPaused((body) => {
        // Find the line where the debugger stopped (e.g. from DAP event body)
        // For simplicity in MVP, if there is a threadId we just highlight line 1 or current cursor if body doesn't provide it
        // A real DAP 'stopped' event doesn't give line number directly, we usually fetch stackTrace.
        // We will just highlight line 5 as a mock if we can't parse it for now, or assume the user gets the stack
        const line = typeof body === 'object' && body.line ? body.line : editor.getPosition().lineNumber
        
        const newDecoration = {
          range: new monacoInstance.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: 'debug-active-line' // Highlight the active debug line with yellow background
          }
        }
        const newIds = editor.deltaDecorations(dapPausedDecorationRef.current ? dapPausedDecorationRef.current : [], [newDecoration])
        dapPausedDecorationRef.current = newIds
      })
      
      const clearPaused = () => {
        if (dapPausedDecorationRef.current) {
          editor.deltaDecorations(dapPausedDecorationRef.current, [])
          dapPausedDecorationRef.current = null
        }
      }
      
      window.addEventListener('dap-continue', clearPaused)
      window.addEventListener('dap-stop', clearPaused)
    }

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

    if (autoSave && !activeFile.startsWith('untitled:')) {
      if (window.autoSaveTimeout) clearTimeout(window.autoSaveTimeout)
      const fileToSave = activeFile
      const contentToSave = value
      window.autoSaveTimeout = setTimeout(async () => {
        const res = await window.api.saveFileContents(fileToSave, contentToSave)
        if (res.success) {
          markFileClean(fileToSave)
        }
      }, 1000)
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
        <div className="editor-logo">
          <svg width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="url(#pi-gradient)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.35 }}>
            <defs>
              <linearGradient id="pi-gradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="var(--accent-purple, #8b5cf6)" />
                <stop offset="100%" stopColor="var(--accent-blue, #3b82f6)" />
              </linearGradient>
            </defs>
            <path d="M9 4v16"></path>
            <path d="M4 7c0-1.7 1.3-3 3-3h13"></path>
            <path d="M18 20c-1.7 0-3-1.3-3-3V4"></path>
          </svg>
        </div>
        
        <div className="editor-empty-actions">
          <p>Press <span className="empty-keybind">Ctrl</span> + <span className="empty-keybind">P</span> to search files</p>
        </div>
      </div>
    )
  }

  return (
    <div className="editor-container" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="editor-tabs" style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', borderBottom: 'none' }}>
          {openFiles.map((file, idx) => {
            const isActive = file.path === activeFile
            return (
              <EditorTab
                key={file.path}
                file={file}
                isActive={isActive}
                isDragging={draggedTabIdx === idx}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                onClick={() => setActiveFile(file.path)}
                onContextMenu={(e) => handleContextMenu(e, file, idx)}
                onClose={() => closeFile(file.path)}
              />
            )
          })}
        </div>

        {/* Run & Optimizer Button Container pinned to the right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', flexShrink: 0 }}>
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
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--accent-color)', color: 'var(--bg-deep)', padding: '4px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem' }}
          >
            ▶ Run
          </button>
          
          <div style={{ width: '1px', height: '16px', background: 'var(--border-base)', margin: '0 4px' }} />
          
          <button
            title="Split Right"
            onClick={(e) => {
              e.stopPropagation()
              if (onSplitRight) onSplitRight()
            }}
            style={{ background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', padding: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75zm1.5 0v10.5c0 .138.112.25.25.25h4.5V2.5h-4.5a.25.25 0 0 0-.25.25zm6.5 10.75h4.25a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H9v11z"/>
            </svg>
          </button>
          
          {onCloseGroup && (
            <button
              title="Close Pane"
              onClick={(e) => {
                e.stopPropagation()
                onCloseGroup()
              }}
              style={{ background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer', padding: '4px' }}
            >
              <X size={14} />
            </button>
          )}
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

      {activeFile && !activeFile.startsWith('settings:') && !activeFile.startsWith('postman:') && !activeFile.startsWith('ext:') && !activeFile.startsWith('git-graph:') && (() => {
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

      <div className="editor-body" onWheelCapture={handleWheelCapture}>
        {inlineAi.visible && (
          <div
            className="inline-ai-widget"
            style={{ top: inlineAi.top, left: Math.max(10, inlineAi.left), transform: inlineAi.top < 40 ? 'translateY(24px)' : 'translateY(calc(-100% - 4px))' }}
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
                  editorRef.current?.focus()
                }
              }}
              onBlur={() => {
                if (!inlineAi.isLoading) {
                  // Slight delay to prevent immediate unmount issues
                  setTimeout(() => {
                    setInlineAi(prev => ({ ...prev, visible: false }))
                  }, 100)
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
        ) : activeFile === 'settings:main' ? (
          <SettingsEditor />
        ) : activeFile === 'settings:shortcuts' ? (
          <KeyboardShortcuts />
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
              beforeMount={handleEditorBeforeMount}
              options={{
                renderSideBySide: true,
                minimap: { enabled: editorSettings.minimap },
                fontSize: Math.round(editorSettings.fontSize * Math.pow(1.1, editorSettings.zoomLevel || 0)),
                fontFamily: editorSettings.fontFamily,
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
              beforeMount={handleEditorBeforeMount}
              options={{
                minimap: { enabled: editorSettings.minimap },
                fontSize: Math.round(editorSettings.fontSize * Math.pow(1.1, editorSettings.zoomLevel || 0)),
                fontFamily: editorSettings.fontFamily,
                wordWrap: editorSettings.wordWrap,
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                smoothScrolling: editorSettings.smoothScrolling,
                cursorBlinking: editorSettings.cursorBlinking,
                lineNumbers: editorSettings.lineNumbers,
                formatOnPaste: editorSettings.formatOnPaste,
                renderWhitespace: editorSettings.renderWhitespace,
                autoClosingBrackets: editorSettings.autoClosingBrackets,
                tabSize: editorSettings.tabSize,
                cursorStyle: editorSettings.cursorStyle,
                cursorSmoothCaretAnimation: 'on',
                automaticLayout: true,
                inlineSuggest: { enabled: editorSettings.inlineSuggest },
                'bracketPairColorization.enabled': editorSettings.bracketPairs,
                stickyScroll: { enabled: editorSettings.stickyScroll },
                quickSuggestions: true, // Enable classic dropdown on normal keystrokes
                wordBasedSuggestions: 'off', // Disables dumb word-based guessing
                suggestOnTriggerCharacters: true, // Pop up on . or :: or Ctrl+Space
                suggest: {
                  showMethods: true,
                  showFunctions: true,
                  showConstructors: true,
                  showFields: true,
                  showVariables: true,
                  showClasses: true,
                  showStructs: true,
                  showInterfaces: true,
                  showModules: true,
                  showProperties: true,
                  showEvents: true,
                  showOperators: true,
                  showUnits: true,
                  showValues: true,
                  showConstants: true,
                  showEnums: true,
                  showEnumMembers: true,
                  showKeywords: true,
                  showWords: true,
                  showColors: true,
                  showFiles: true,
                  showReferences: true,
                  showFolders: true,
                  showTypeParameters: true,
                  showSnippets: true,
                },
                glyphMargin: true,
                lineDecorationsWidth: 16,
                fixedOverflowWidgets: true
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
