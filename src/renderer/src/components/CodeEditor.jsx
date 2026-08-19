import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Editor, { loader, DiffEditor, useMonaco } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { emmetHTML, emmetCSS, emmetJSX } from 'emmet-monaco-es'
import { applyDiff } from '../diffUtils'
import { X, Save, Circle, Sparkles, ChevronRight, AlertTriangle, Info, CheckCircle, Loader2, Code2, Play } from 'lucide-react'
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
import { registerToadCode } from '../monaco-toadcode'

// --- Monaco Workers ---
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker: function (_, label) {
      if (label === 'json') {
        return new jsonWorker()
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker()
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker()
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker()
      }
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
    case 'general.commandPalette': return 'editor.action.quickCommand';
    default: return null;
  }
}

const convertPartToMonaco = (partKeys, monacoObj) => {
  let kb = 0;
  if (partKeys.includes('Ctrl')) kb |= monacoObj.KeyMod.CtrlCmd;
  if (partKeys.includes('Shift')) kb |= monacoObj.KeyMod.Shift;
  if (partKeys.includes('Alt')) kb |= monacoObj.KeyMod.Alt;
  if (partKeys.includes('Meta')) kb |= monacoObj.KeyMod.WinCtrl;
  
  const baseKey = partKeys.filter(k => !['Ctrl', 'Shift', 'Alt', 'Meta'].includes(k))[0];
  if (baseKey) {
    const upper = baseKey.toUpperCase();
    if (upper === 'UPARROW' || upper === 'UP' || upper === 'ARROWUP') kb |= monacoObj.KeyCode.UpArrow;
    else if (upper === 'DOWNARROW' || upper === 'DOWN' || upper === 'ARROWDOWN') kb |= monacoObj.KeyCode.DownArrow;
    else if (upper === 'LEFTARROW' || upper === 'LEFT' || upper === 'ARROWLEFT') kb |= monacoObj.KeyCode.LeftArrow;
    else if (upper === 'RIGHTARROW' || upper === 'RIGHT' || upper === 'ARROWRIGHT') kb |= monacoObj.KeyCode.RightArrow;
    else if (upper === 'ESC' || upper === 'ESCAPE') kb |= monacoObj.KeyCode.Escape;
    else if (upper === 'SPACE') kb |= monacoObj.KeyCode.Space;
    else if (upper === 'ENTER') kb |= monacoObj.KeyCode.Enter;
    else if (upper === 'TAB') kb |= monacoObj.KeyCode.Tab;
    else if (upper === 'BACKSPACE') kb |= monacoObj.KeyCode.Backspace;
    else if (upper === 'DELETE') kb |= monacoObj.KeyCode.Delete;
    else if (upper === '`') kb |= monacoObj.KeyCode.Backquote;
    else if (upper === '\\') kb |= monacoObj.KeyCode.Backslash;
    else if (upper === '/') kb |= monacoObj.KeyCode.Slash;
    else if (upper === ',') kb |= monacoObj.KeyCode.Comma;
    else if (upper === '.') kb |= monacoObj.KeyCode.Period;
    else if (upper === ';') kb |= monacoObj.KeyCode.Semicolon;
    else if (upper === "'") kb |= monacoObj.KeyCode.Quote;
    else if (upper === '[') kb |= monacoObj.KeyCode.BracketLeft;
    else if (upper === ']') kb |= monacoObj.KeyCode.BracketRight;
    else if (upper === '-') kb |= monacoObj.KeyCode.Minus;
    else if (upper === '=') kb |= monacoObj.KeyCode.Equal;
    else if (upper.length === 1 && upper >= 'A' && upper <= 'Z') {
      kb |= monacoObj.KeyCode[`Key${upper}`];
    } else if (upper.length === 1 && upper >= '0' && upper <= '9') {
      kb |= monacoObj.KeyCode[`Digit${upper}`];
    } else if (upper.startsWith('F') && upper.length > 1) {
      kb |= monacoObj.KeyCode[upper];
    }
  }
  return kb;
};

const parseToMonacoKeybinding = (keys, monacoObj) => {
  if (!keys || keys.length === 0) return 0;
  
  let parts = [];
  let currentPart = [];
  for (const k of keys) {
    currentPart.push(k);
    if (!['Ctrl', 'Shift', 'Alt', 'Meta'].includes(k)) {
      parts.push(currentPart);
      currentPart = [];
    }
  }
  if (currentPart.length > 0 && parts.length === 0) parts.push(currentPart);
  
  if (parts.length === 0) return 0;
  if (parts.length === 1) return convertPartToMonaco(parts[0], monacoObj);
  return monacoObj.KeyMod.chord(
    convertPartToMonaco(parts[0], monacoObj),
    convertPartToMonaco(parts[1], monacoObj)
  );
};

const syncMonacoKeybindings = (shortcuts, monacoObj) => {
  if (!monacoObj || !monacoObj.editor) return;
  const rules = [];

  // Build a lookup of default keys per shortcut id
  const defaultKeysById = {};
  defaultShortcuts.forEach(group => {
    group.items.forEach(item => {
      defaultKeysById[item.id] = item.keys;
    });
  });
  
  shortcuts.forEach(group => {
    group.items.forEach(item => {
      const monacoCommandId = mapCustomIdToMonacoCommandId(item.id);
      if (monacoCommandId) {
        // If the user changed the keys from the default, unbind the old default
        const defaultKeys = defaultKeysById[item.id];
        if (defaultKeys) {
          const defaultStr = defaultKeys.join('+').toLowerCase();
          const currentStr = item.keys.join('+').toLowerCase();
          if (defaultStr !== currentStr) {
            const oldKeybinding = parseToMonacoKeybinding(defaultKeys, monacoObj);
            if (oldKeybinding !== 0) {
              // Unbind old default by setting command to '-commandId'
              rules.push({
                keybinding: oldKeybinding,
                command: '-' + monacoCommandId
              });
            }
          }
        }

        // Bind the current (possibly new) keybinding
        const keybinding = parseToMonacoKeybinding(item.keys, monacoObj);
        if (keybinding !== 0) {
          rules.push({
            keybinding,
            command: monacoCommandId
          });
        }
      }
    });
  });
  
  if (rules.length > 0) {
    return monacoObj.editor.addKeybindingRules(rules);
  }
  return null;
};

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
    scala: 'scala', groovy: 'groovy', sql: 'sql',
    toad: 'toadcode'
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

const pathToUri = (p) => getCanonicalMonacoUriString(p);

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
      if (!globalAiConfig || globalAiConfig.autoCompleteEnabled === false) return { items: [], disposeInlineCompletions: () => {} }

      // 1. Debounce using cancellation token.
      // Default lowered from 2000ms to 300ms — with a 2s debounce, a
      // continuous typist re-triggers (and cancels the prior call) more
      // often than once every 2s, so the request never survives long
      // enough to fire. It only ever "completed" after a long pause, which
      // looked like "only triggers on Enter" since Enter is the most common
      // pause point. 300ms feels instant but still absorbs normal typing
      // cadence. Polling in small increments (instead of one long sleep)
      // also means a fast subsequent keystroke cancels this call almost
      // immediately instead of only checking at the very end of the wait.
      const debounceMs = globalAiConfig.autoCompleteDelay ?? 300
      const pollMs = 30
      for (let waited = 0; waited < debounceMs; waited += pollMs) {
        if (token.isCancellationRequested) return { items: [], disposeInlineCompletions: () => {} }
        await new Promise(resolve => setTimeout(resolve, pollMs))
      }
      if (token.isCancellationRequested) return { items: [], disposeInlineCompletions: () => {} }

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
        return { items: [], disposeInlineCompletions: () => {} }
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
        return { items: [], disposeInlineCompletions: () => {} }
      }

      return {
        items: [
          {
            insertText: completionText,
            range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
          }
        ],
        disposeInlineCompletions: () => {}
      }
    },
    disposeInlineCompletions: () => { },
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
          {hasError ? (counts.error > 9 ? '9+' : counts.error) : (counts.warning > 9 ? '9+' : counts.warning)}
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

// ─── ONE CANONICAL URI METHOD ──────────────────────────────────────
const getCanonicalMonacoUriString = (filePath) => {
  if (!filePath) return '';
  if (window.monaco) {
    // Rely exclusively on Monaco's internal normalizer (handles Windows case/slashes)
    return window.monaco.Uri.file(filePath).toString();
  }
  // Best-effort fallback before monaco loads
  let formatted = filePath.replace(/\\/g, '/');
  if (!formatted.startsWith('/')) formatted = '/' + formatted;
  formatted = formatted.replace(/^\/([A-Z]):\//, (match, drive) => `/${drive.toLowerCase()}:/`);
  return `file://${formatted}`;
};

const canonicalUri = (filePath) => {
  if (!filePath || !window.monaco) return null;
  // NEVER use Uri.parse() for file paths! Only Uri.file() guarantees consistency.
  return window.monaco.Uri.file(filePath);
};

// Model registry keyed by exact Monaco URI string.
const modelsByUri = new Map();

const registerModelPath = (model) => {
  if (!model || !model.uri) return;
  modelsByUri.set(model.uri.toString(), model);
};

const findMonacoModel = (filePath) => {
  if (!filePath || !window.monaco || !window.monaco.editor) return null;
  const targetUriString = getCanonicalMonacoUriString(filePath);

  const cached = modelsByUri.get(targetUriString);
  if (cached && !cached.isDisposed()) return cached;

  // Cache miss - rebuild using exact equality
  for (const m of window.monaco.editor.getModels()) {
    if (m.uri.toString() === targetUriString) {
      modelsByUri.set(targetUriString, m);
      return m;
    }
  }
  return null;
};

const getOrCreateModel = (filePath, content, languageId) => {
  const uri = canonicalUri(filePath);
  let model = window.monaco.editor.getModel(uri);
  if (!model) {
    model = window.monaco.editor.createModel(content ?? '', languageId, uri);
    registerModelPath(model);
  } else if (content != null && model.getValue() !== content) {
    model.setValue(content);
  }
  return model;
};

const formatLspDiagnosticsToMonaco = (diagnostics) => {
  // 🛡️ DEFENSIVE GUARD: Use safe integer fallbacks if window.monaco hasn't mounted in RAM yet
  const S = window.monaco && window.monaco.MarkerSeverity 
    ? window.monaco.MarkerSeverity 
    : { Error: 8, Warning: 4, Info: 2, Hint: 1 };
    
  const sevMap = { 1: S.Error, 2: S.Warning, 3: S.Info, 4: S.Hint };
  
  return (diagnostics || []).map((d) => {
    const sl = d.range?.start?.line ?? 0;
    const sc = d.range?.start?.character ?? 0;
    const el = d.range?.end?.line ?? sl;
    const ec = d.range?.end?.character ?? sc;

    let startLineNumber = Math.max(1, sl + 1);
    let startColumn     = Math.max(1, sc + 1);
    let endLineNumber   = Math.max(1, el + 1);
    let endColumn       = Math.max(1, ec + 1);

    // Monaco requires endColumn > startColumn on the same line to paint a
    // squiggle at all — a zero-width point range (common from clangd for
    // missing-token/EOF-style diagnostics) is accepted by setModelMarkers
    // but renders nothing. Widen it to cover at least one character so the
    // error is actually visible.
    if (startLineNumber === endLineNumber && endColumn <= startColumn) {
      endColumn = startColumn + 1;
    }

    return {
      severity: sevMap[d.severity] ?? S.Error,
      message: d.message ?? 'Syntax Error',
      source: d.source ?? 'clangd',
      code: d.code?.value ?? d.code,
      startLineNumber,
      startColumn,
      endLineNumber,
      endColumn,
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
      window.monaco = monaco
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
            // Fix double counting: if native monaco TS/JS worker provides counts, drop the background scanner's counts
            if (owner === 'typescript' || owner === 'javascript') {
              useDiagnosticsStore.getState().setDiagnostics(uriStr, `lsp-${owner}`, null)
            }
          }
        }
      })
      const disposeHTML = emmetHTML(window.monaco || monaco)
      const disposeCSS = emmetCSS(window.monaco || monaco)
      const disposeJSX = emmetJSX(window.monaco || monaco)

      return () => {
        disposeHTML()
        disposeCSS()
        disposeJSX()
        disposable.dispose()
      }
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
  const pendingMarkers = useRef(new Map())

  const flushPendingMarkers = (filePath) => {
    if (!filePath) return
    const key = getCanonicalMonacoUriString(filePath)
    const pendingObj = pendingMarkers.current.get(key)
    if (!pendingObj) return
    
    const { markers, language } = pendingObj
    const model = findMonacoModel(filePath)
    if (!model) return

    window.monaco.editor.setModelMarkers(model, `lsp-${language}`, markers)
    pendingMarkers.current.delete(key)
    requestAnimationFrame(() => editorRef.current?.layout())
  }

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
  const getShortcut = useShortcutStore(state => state.getShortcut)
  const formatShortcut = (id, fallback) => {
    const keys = getShortcut(id)
    return keys ? keys.join('+') : fallback
  }

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

  const shortcuts = useShortcutStore(state => state.shortcuts)

  useEffect(() => {
    syncMonacoKeybindings(shortcuts, monaco)
  }, [shortcuts])


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
    // Zero-latency: any diagnostics already delivered before this model was
    // registered are flushed immediately once the model exists in RAM.
    if (editorRef.current && activeFile) {
      flushPendingMarkers(activeFile);
    }
  }, [fileContents, activeFile]);

  useEffect(() => {
    const handler = (payload) => {
      try {
        const { uri, filePath, diagnostics, language = 'unknown' } = payload || {};
        const targetPath = filePath || uri;
        if (!targetPath) return;
        // JS/TS diagnostics stay owned by Monaco's native workers.
        if (targetPath.endsWith('.js') || targetPath.endsWith('.ts')) return;

        if (!window.monaco || !diagnostics) {
          return;
        }

        const markers = formatLspDiagnosticsToMonaco(diagnostics);
        const model = findMonacoModel(targetPath);
        
        if (model) {
          window.monaco.editor.setModelMarkers(model, `lsp-${language}`, markers);
          requestAnimationFrame(() => editorRef.current?.layout());
        } else {
          pendingMarkers.current.set(getCanonicalMonacoUriString(targetPath), { markers, language });
        }
      } catch (err) {
        console.error(`[Live IPC Receiver] CRASH:`, err);
      }
    };
    if (window.api?.onLspDiagnostics) {
      window.api.onLspDiagnostics(handler);
    }
    return () => { 
      if (window.api?.removeLspDiagnostics) window.api.removeLspDiagnostics(); 
    };
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

  // ─── Explicit tab-close: dispose model, clear markers, purge cache ───
  const closeTab = (filePath) => {
    if (!filePath) return
    try {
      if (window.monaco) {
        const uri = canonicalUri(filePath)
        const model = window.monaco.editor.getModel(uri)
        if (model) {
          model.dispose()
        }
      }
      pendingMarkers.current.delete(getCanonicalMonacoUriString(filePath))
      window.api?.send?.('lsp:document-close', { filePath })
    } catch (err) {
      console.error('[closeTab] Error during cleanup:', err)
    } finally {
      // ALWAYS call closeFile, even if Monaco cleanup fails, to prevent ghost tabs
      closeFile(filePath)
    }
  }

  // ─── Context Menu Handlers ───
  const handleContextMenu = (e, file, index) => {
    e.preventDefault()
    let x = e.clientX;
    let y = e.clientY;
    const menuWidth = 220;
    const menuHeight = 250;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight;
    setContextMenu({
      x,
      y,
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
        closeTab(path)
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
  // Tracks which (filePath -> content-hash) pairs we've already shipped to the
  // backend so we don't spam duplicate didOpen/didChange after every render.
  const lspOpenedFilesRef = useRef(new Map())

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

      client.onDiagnostics = (params) => {
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

    // Register whatever model <Editor> attached for this path so the
    // diagnostic dispatcher can resolve it.
    registerModelPath(editorRef.current?.getModel())

    // ── Critical: NEVER ship 'Loading...' or an undefined buffer to the LSP.
    // The load effect above populates fileContents async — until it resolves,
    // clangd/pyright would parse the placeholder string and emit either
    // nothing or bogus markers, then never re-parse. Wait for real content.
    const record = fileContents[activeFile]
    if (!record || record.isLoading) return
    const content = record.content
    if (typeof content !== 'string' || content === 'Loading...' || content.startsWith('Error:')) return

    const alreadyOpened = lspOpenedFilesRef.current.has(activeFile)
    window.api.send(alreadyOpened ? 'lsp:document-change' : 'lsp:document-open', {
      filePath: activeFile,
      text: content,
      languageId: lspKey
    })
    lspOpenedFilesRef.current.set(activeFile, content.length)

    // Instantly drain any diagnostics that arrived before the model existed.
    flushPendingMarkers(activeFile);

    return () => {
      // Intentionally omitted: we do not emit 'lsp:document-close' on tab switch
      // so the language server keeps the AST and diagnostics in RAM.
    }
  }, [activeFile, fileContents])

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
    const handleEditorAction = async (e) => {
      const actionId = e.detail
      if (!editorRef.current) return
      
      // Do not steal focus or hijack the event if a secondary view is currently focused
      const activeEl = document.activeElement;
      if (activeEl && activeEl.closest && (activeEl.closest('.postman-view') || activeEl.closest('.dsa-explainer-overlay'))) {
        return;
      }
      
      // The editor loses focus when you click the top menu,
      // which causes interactive prompts (like Go to Line) to instantly close
      // or keystrokes to fail. We MUST refocus the editor first!
      editorRef.current.focus()

      // Manually handle clipboard actions because native ones fail in Electron without an explicit edit menu
      if (actionId === 'edit.paste') {
        try {
          let text = ''
          if (window.api && window.api.readClipboardText) {
            const res = await window.api.readClipboardText()
            text = res?.success ? res.text : (typeof res === 'string' ? res : '')
          } else {
            text = await navigator.clipboard.readText()
          }
          if (text) {
            editorRef.current.executeEdits("keyboard-shortcut", [{
              range: editorRef.current.getSelection(),
              text: text,
              forceMoveMarkers: true
            }])
          }
        } catch (err) {
          console.error('Clipboard paste failed:', err)
        }
        return
      }

      if (actionId === 'edit.copy' || actionId === 'edit.cut') {
        const text = editorRef.current.getModel().getValueInRange(editorRef.current.getSelection());
        if (text) {
          if (window.api && window.api.writeClipboardText) {
            await window.api.writeClipboardText(text);
          } else {
            navigator.clipboard.writeText(text);
          }
          if (actionId === 'edit.cut') {
            editorRef.current.executeEdits("keyboard-shortcut", [{
              range: editorRef.current.getSelection(),
              text: ""
            }])
          }
        }
        return
      }

      const mappedId = mapCustomIdToMonacoCommandId(actionId) || actionId

      const action = editorRef.current.getAction(mappedId)
      if (action) {
        if (mappedId === 'editor.action.quickCommand') {
          // The Command Palette widget fails to open properly via action.run() due to internal focus/key state checks.
          editorRef.current.trigger('keyboard', mappedId, null)
        } else {
          action.run()
        }
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

  const isToadCodeEnabled = extensions.some(ext => ext.id === 'ext-lang-toadcode' && ext.enabled)
  useEffect(() => {
    if (isToadCodeEnabled && window.monaco) {
      registerToadCode(window.monaco)
    }
  }, [isToadCodeEnabled])
  const [cursorLine, setCursorLine] = useState(null)
  const monacoTheme = activeTheme === 'light-modern' ? 'vs' : 'vs-dark'
  const [originalText, setOriginalText] = useState(null)
  const [showDiff, setShowDiff] = useState(false)
  const [previewDiff, setPreviewDiff] = useState(null)
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
    if (!monacoInstance.editor._patched) {
      monacoInstance.editor._patched = true;
      const orig = monacoInstance.editor.setModelMarkers;
      monacoInstance.editor.setModelMarkers = function(model, owner, markers) {
        return orig.apply(this, arguments);
      };
    }

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

    // Register whatever model is already attached at first mount —
    // onDidChangeModel below only fires on later swaps.
    registerModelPath(editor.getModel())
    
    // Instantly drain any diagnostics that arrived before the model existed
    if (globalActiveFile) flushPendingMarkers(globalActiveFile);

    editor.onDidChangeModel(() => {
      // @monaco-editor/react creates/swaps models internally when the
      // `path` prop changes — register whatever model just became active
      // so findMonacoModel's normalized-path cache knows about it.
      registerModelPath(editor.getModel());
      if (activeFile) {
        restoreCachedDiagnostics(activeFile);
        flushPendingMarkers(activeFile);
      } else if (globalActiveFile) {
        flushPendingMarkers(globalActiveFile);
      }
    });
    
    editor.onContextMenu((e) => {
      e.event.preventDefault()
      
      if (e.target.position) {
        editor.setPosition(e.target.position)
      }

      let x = e.event.browserEvent.clientX;
      let y = e.event.browserEvent.clientY;
      const menuWidth = 260;
      const menuHeight = 310;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight;
      setEditorContextMenu({ x, y })
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
      keybindings: [ parseToMonacoKeybinding(useShortcutStore.getState().getShortcut('general.run'), monacoInstance) ],
      run: () => {
        window.dispatchEvent(new Event('global-run-file'))
      }
    })

    // Custom Action: Format Document
    editor.addAction({
      id: 'compile.formatDocument',
      label: 'Format Document (Prettier)',
      keybindings: [ parseToMonacoKeybinding(useShortcutStore.getState().getShortcut('edit.format'), monacoInstance) ],
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
      keybindings: [ parseToMonacoKeybinding(useShortcutStore.getState().getShortcut('edit.inlineAi'), monacoInstance) ],
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

  // Listen for 'preview-diff' events to show proposed agentic edits without saving
  useEffect(() => {
    const handlePreviewDiff = async (e) => {
      const { path, body, id, ids } = e.detail
      
      let model = null
      if (window.monaco) {
        model = window.monaco.editor.getModel(window.monaco.Uri.file(path))
      }

      let currentText = ''
      if (model) {
        currentText = model.getValue()
      } else {
        try {
          currentText = (await window.api.getFileContents(path)).content || ''
        } catch(err) {
          window.dispatchEvent(new CustomEvent('agentic-edit-error', { detail: { id, ids, error: "Failed to read file from disk." } }))
          return
        }
      }

      const { newText: diffedText, hasChanges, error } = applyDiff(currentText, body)
      
      if (error) {
        window.dispatchEvent(new CustomEvent('agentic-edit-error', { detail: { id, ids, error } }))
        return
      }

      if (hasChanges) {
        setPreviewDiff({ path, diffedText, originalText: currentText, id, ids })
      }
    }
    window.addEventListener('preview-diff', handlePreviewDiff)
    return () => window.removeEventListener('preview-diff', handlePreviewDiff)
  }, [activeFile])

  // Listen for 'cancel-preview-diff'
  useEffect(() => {
    const handleCancelPreview = (e) => {
      const { path } = e.detail
      setPreviewDiff(prev => (prev && prev.path === path) ? null : prev)
    }
    window.addEventListener('cancel-preview-diff', handleCancelPreview)
    return () => window.removeEventListener('cancel-preview-diff', handleCancelPreview)
  }, [])

  // Listen for 'force-apply-diff' events to approve an agentic edit
  useEffect(() => {
    const handleForceApplyDiff = async (e) => {
      const { path, body, id, ids } = e.detail
      const normalize = (p) => (p || '').replace(/\\/g, '/').toLowerCase()
      
      // 1. Try to get in-memory model (unsaved changes)
      let model = null
      if (window.monaco) {
        model = window.monaco.editor.getModel(window.monaco.Uri.file(path))
      }
      
      let baseText = ''
      if (model) {
        baseText = model.getValue()
      } else {
        try {
          const res = await window.api.getFileContents(path)
          baseText = res.content || ''
        } catch (err) {
           window.dispatchEvent(new CustomEvent('agentic-edit-error', { detail: { id, ids, error: "Failed to read file from disk." } }))
           return
        }
      }

      const { newText: diffedText, hasChanges, error } = applyDiff(baseText, body)

      if (error) {
        window.dispatchEvent(new CustomEvent('agentic-edit-error', { detail: { id, ids, error } }))
        return
      }

      if (hasChanges) {
        if (model) {
          // If file is open, apply to Monaco model to preserve undo stack
          const viewState = editorRef.current && normalize(activeFile) === normalize(path) ? editorRef.current.saveViewState() : null
          
          model.pushStackElement()
          model.pushEditOperations(
            [],
            [{ range: model.getFullModelRange(), text: diffedText }],
            () => null
          )
          model.pushStackElement()
          
          if (viewState) editorRef.current.restoreViewState(viewState)
          
          if (typeof markFileDirty === 'function') markFileDirty(path)
        } else {
          // File not open, write directly to disk
          try {
            await window.api.saveFileContents(path, diffedText)
          } catch (err) {
             window.dispatchEvent(new CustomEvent('agentic-edit-error', { detail: { id, ids, error: "Failed to save file to disk." } }))
             return
          }
        }
        
        // Clear preview if it was this file
        setPreviewDiff(prev => (prev && prev.path === path) ? null : prev)
        
        window.dispatchEvent(new CustomEvent('agentic-edit-success', { detail: { id, ids } }))
      }
    }
    
    window.addEventListener('force-apply-diff', handleForceApplyDiff)
    return () => window.removeEventListener('force-apply-diff', handleForceApplyDiff)
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

    // Notify the LSP backend via canonical URI IPC so clangd/pyright/etc.
    // re-parse and republish diagnostics against the latest buffer.
    const monacoLang = getLanguageFromPath(activeFile)
    const lspKey = lspLanguageKey(monacoLang)
    if (lspKey) {
      window.api.send('lsp:document-change', {
        filePath: activeFile,
        text: value,
        languageId: lspKey
      })
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

  const renderEmptyAction = (id, fallback, label) => {
    let keys = getShortcut(id);
    if (!keys) {
      keys = fallback.split(' ').reduce((acc, curr) => acc.concat(curr.split('+')), []);
    }
    
    const chords = [];
    let currentChord = [];
    const modifiers = ['Ctrl', 'Alt', 'Shift', 'Meta', 'Cmd'];
    let seenNonModifier = false;
    
    for (const key of keys) {
      if (modifiers.includes(key)) {
        if (seenNonModifier) {
          chords.push(currentChord);
          currentChord = [];
          seenNonModifier = false;
        }
        currentChord.push(key);
      } else {
        currentChord.push(key);
        seenNonModifier = true;
      }
    }
    if (currentChord.length > 0) chords.push(currentChord);

    return (
      <div 
        key={id}
        className="empty-action-item" 
        onClick={() => window.dispatchEvent(new CustomEvent('execute-global-action', { detail: id }))}
      >
        <span className="empty-action-label">{label}</span>
        <span className="empty-action-keys">
          {chords.map((chord, cIdx) => (
            <span key={cIdx} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: cIdx > 0 ? '8px' : '0' }}>
              {chord.map((key, kIdx) => (
                <React.Fragment key={kIdx}>
                  <span className="empty-keybind">{key}</span>
                  {kIdx < chord.length - 1 && <span style={{ opacity: 0.8, fontSize: '12px', margin: '0 2px' }}>+</span>}
                </React.Fragment>
              ))}
            </span>
          ))}
        </span>
      </div>
    )
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
          {renderEmptyAction('file.openFolder', 'Ctrl+K Ctrl+O', 'Open Folder')}
          {renderEmptyAction('file.open', 'Ctrl+O', 'Open File')}
          {renderEmptyAction('ai.chat', 'Ctrl+L', 'Open AI Agent')}
          {renderEmptyAction('general.settings', 'Ctrl+,', 'Open Settings')}
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
                onClose={() => closeTab(file.path)}
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

      {/* ── Editor Context Menu Overlay ── */}
      {editorContextMenu && (
        <div
          className="editor-context-menu"
          style={{
            position: 'fixed',
            top: editorContextMenu.y,
            left: editorContextMenu.x,
            zIndex: 9999
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="editor-context-menu-item" onClick={(e) => handleEditorContextAction('editor.action.revealDefinition', e)}>
            <span>Go to Definition</span>
            <span className="shortcut">{formatShortcut('nav.goToDef', 'F12')}</span>
          </div>
          <div className="editor-context-menu-item" onClick={(e) => handleEditorContextAction('editor.action.goToTypeDefinition', e)}>
            <span>Go to Type Definition</span>
          </div>
          <div className="editor-context-menu-item" onClick={(e) => handleEditorContextAction('editor.action.referenceSearch.trigger', e)}>
            <span>Go to References</span>
            <span className="shortcut">{formatShortcut('nav.goToRef', 'Shift+F12')}</span>
          </div>
          
          <div className="editor-context-menu-separator" />
          
          <div className="editor-context-menu-item" onClick={(e) => handleEditorContextAction('editor.action.rename', e)}>
            <span>Rename Symbol</span>
            <span className="shortcut">F2</span>
          </div>
          <div className="editor-context-menu-item" onClick={(e) => handleEditorContextAction('compile.formatDocument', e)}>
            <span>Format Document</span>
            <span className="shortcut">{formatShortcut('edit.format', 'Shift+Alt+F')}</span>
          </div>

          <div className="editor-context-menu-separator" />

          <div className="editor-context-menu-item" onClick={(e) => {
            e.stopPropagation()
            setEditorContextMenu(null)
            if (!editorRef.current) return
            const editor = editorRef.current
            const sel = editor.getSelection()
            let text = ''
            if (sel && !sel.isEmpty()) {
              text = editor.getModel().getValueInRange(sel)
            } else {
              text = editor.getModel().getValue()
            }
            let lang = 'javascript'
            if (activeFile) {
              const ext = String(activeFile.split('.').pop() || '').toLowerCase()
              if (ext === 'py') lang = 'python'
              else if (['cpp', 'cc', 'cxx', 'c++', 'h', 'hpp', 'hh'].includes(ext)) lang = 'cpp'
              else if (ext === 'java') lang = 'java'
            }
            window.dispatchEvent(new CustomEvent('open-dsa-explainer', {
              detail: { code: text, language: lang }
            }))
          }}>
            <span>Explain & Visualize</span>
          </div>

          <div className="editor-context-menu-separator" />
          
          <div className="editor-context-menu-item" onClick={(e) => handleEditorContextAction('editor.action.clipboardCutAction', e)}>
            <span>Cut</span>
            <span className="shortcut">{formatShortcut('edit.cut', 'Ctrl+X')}</span>
          </div>
          <div className="editor-context-menu-item" onClick={(e) => handleEditorContextAction('editor.action.clipboardCopyAction', e)}>
            <span>Copy</span>
            <span className="shortcut">{formatShortcut('edit.copy', 'Ctrl+C')}</span>
          </div>
          <div className="editor-context-menu-item" onClick={(e) => handleEditorContextAction('editor.action.clipboardPasteAction', e)}>
            <span>Paste</span>
            <span className="shortcut">{formatShortcut('edit.paste', 'Ctrl+V')}</span>
          </div>
          
          <div className="editor-context-menu-separator" />
          
          <div className="editor-context-menu-item" onClick={(e) => handleEditorContextAction('editor.action.quickCommand', e)}>
            <span>Command Palette...</span>
            <span className="shortcut">{formatShortcut('general.commandPalette', 'Ctrl+Shift+P')}</span>
          </div>
        </div>
      )}

      {activeFile && !activeFile.startsWith('settings:') && !activeFile.startsWith('postman:') && !activeFile.startsWith('ext:') && !activeFile.startsWith('git-graph:') && (() => {
        const relPath = projectRoot && activeFile.startsWith(projectRoot)
          ? activeFile.substring(projectRoot.length).replace(/^[\\/]/, '')
          : activeFile
        const parts = relPath.split(/[\\/]/).filter(Boolean)
        return (
          <div className="editor-breadcrumb" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              {parts.map((part, i) => (
                <span key={i} className="breadcrumb-segment">
                  {i > 0 && <ChevronRight size={12} className="breadcrumb-sep" />}
                  <span className={i === parts.length - 1 ? 'breadcrumb-current' : 'breadcrumb-part'}>{part}</span>
                </span>
              ))}
            </div>
            {activeFile.endsWith('.toad') && isToadCodeEnabled && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('global-run-file'));
                }}
                title="Run ToadCode"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--accent-blue, #007acc)',
                  color: 'var(--accent-text, #fff)',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontWeight: 600
                }}
              >
                <Play size={12} /> Run
              </button>
            )}
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
          (effectiveShowDiff || (previewDiff && previewDiff.path === activeFile)) ? (
            <DiffEditor
              height="100%"
              original={previewDiff && previewDiff.path === activeFile ? previewDiff.originalText : effectiveOriginalText}
              modified={previewDiff && previewDiff.path === activeFile ? previewDiff.diffedText : currentValue}
              language={getLanguageFromPath(activeFile)}
              theme={monacoTheme}
              onMount={handleDiffEditorMountWrapper}
              beforeMount={handleEditorBeforeMount}
              options={{
                renderSideBySide: true,
                minimap: { enabled: editorSettings.minimap },
                fontSize: Math.round(editorSettings.fontSize * Math.pow(1.1, editorSettings.zoomLevel || 0)),
                fontFamily: editorSettings.fontFamily,
                readOnly: (previewDiff && previewDiff.path === activeFile) ? true : !isGitDiff,
                padding: { top: 16 },
                glyphMargin: false,
                lineDecorationsWidth: 16,
                contextmenu: false
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
                contextmenu: false,
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