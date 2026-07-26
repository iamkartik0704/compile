import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// ============================================================
// SECURE API SURFACE
// These functions are the ONLY way React can talk to Node.js.
// React can NEVER access fs, path, child_process, safeStorage,
// or any Node.js / Electron module directly.
// ============================================================
const api = {
  // ── Window Controls ──
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateDownloaded: (callback) => {
    ipcRenderer.removeAllListeners('update-downloaded')
    ipcRenderer.on('update-downloaded', (_event, data) => callback(data))
  },
  onUpdateAvailableMacos: (callback) => {
    ipcRenderer.removeAllListeners('update-available-macos')
    ipcRenderer.on('update-available-macos', (_event, url) => callback(url))
  },
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize-toggle'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  newWindow: () => ipcRenderer.invoke('create-new-window'),
  send: (channel, data) => ipcRenderer.send(channel, data),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    const wrapped = (_event, data) => callback(data)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  // ── File Operations ──

  // File Explorer
  selectFolder: () => ipcRenderer.invoke('select-folder'),
      selectFile: () => ipcRenderer.invoke('select-file'),
      showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
      openRecent: () => ipcRenderer.invoke('open-recent'),
  readDirectory: (path) => ipcRenderer.invoke('read-directory', path),
  getProjectTree: (path) => ipcRenderer.invoke('get-project-tree', path),
  createFile: (path) => ipcRenderer.invoke('create-file', path),
  createFolder: (path) => ipcRenderer.invoke('create-folder', path),
  renameItem: (oldPath, newPath, workspaceRoot) => ipcRenderer.invoke('rename-item', oldPath, newPath, workspaceRoot),
  deleteItem: (itemPath, workspaceRoot) => ipcRenderer.invoke('delete-item', itemPath, workspaceRoot),
  deleteItemPermanent: (itemPath, workspaceRoot) => ipcRenderer.invoke('delete-item-permanent', itemPath, workspaceRoot),
  revealInExplorer: (itemPath) => ipcRenderer.invoke('reveal-in-explorer', itemPath),
  writeClipboardText: (text) => ipcRenderer.invoke('write-clipboard', text),
  readClipboardText: () => ipcRenderer.invoke('read-clipboard'),
  pasteFromOsClipboard: (destFolder) => ipcRenderer.invoke('paste-from-os-clipboard', destFolder),
  copyItem: (src, dest, workspaceRoot, mode) => ipcRenderer.invoke('copy-item', src, dest, workspaceRoot, mode),
  watchProject: (path) => ipcRenderer.invoke('watch-project', path),
  onFsChanged: (callback) => {
    ipcRenderer.removeAllListeners('fs-changed')
    ipcRenderer.on('fs-changed', (_event, data) => callback(data))
  },

  /**
   * File Read — Invoke/Handle Promise pattern.
   * Sends a request to Main, awaits a single resolved value.
   */
  getFileContents: (filePath) => ipcRenderer.invoke('get-file-contents', filePath),
  getWasmContent: (filePath) => ipcRenderer.invoke('get-wasm-content', filePath),
  saveFileContents: (filePath, content) => ipcRenderer.invoke('save-file-contents', filePath, content),

  // ── Git Operations ──
  gitStatus: (cwd) => ipcRenderer.invoke('git-status', cwd),
  gitAction: (cwd, action, ...args) => ipcRenderer.invoke('git-action', cwd, action, ...args),

  // ── Language Server Protocol (LSP) — Multi-language ──
  startLanguageServer: (language, rootUri) => ipcRenderer.invoke('start-lsp', language, rootUri),
  listAvailableLsp: () => ipcRenderer.invoke('list-available-lsp'),
  killLsp: (language) => ipcRenderer.invoke('kill-lsp', language),
  sendLspMessage: (language, message) => ipcRenderer.send('lsp-client-message', { language, message }),
  
  // New LSP robust methods
  getCppCompilers: () => ipcRenderer.invoke('lsp:get-cpp-compilers'),
  setCppCompiler: (config) => ipcRenderer.invoke('lsp:set-cpp-compiler', config),
  ensureCompilationDb: (args) => ipcRenderer.invoke('lsp:ensure-compilation-db', args),
  recheckToolchainStatus: (language) => ipcRenderer.invoke('lsp:recheck-toolchain-status', language),

  onLspDiagnostics: (callback) => {
    ipcRenderer.removeAllListeners('lsp:diagnostics')
    ipcRenderer.on('lsp:diagnostics', (_event, data) => callback(data))
  },
  removeLspDiagnostics: () => {
    ipcRenderer.removeAllListeners('lsp:diagnostics')
  },

  onLspMessage: (callback) => {
    ipcRenderer.removeAllListeners('lsp-server-message')
    ipcRenderer.on('lsp-server-message', (_event, { language, message }) => callback(language, message))
  },
  onLspStatusChange: (callback) => {
    ipcRenderer.removeAllListeners('lsp-status-change')
    ipcRenderer.on('lsp-status-change', (_event, { language, status }) => callback(language, status))
  },
  onLspServerReset: (callback) => {
    ipcRenderer.on('lsp-server-reset', (_event, { language }) => callback(language))
  },
  onShowMissingToolchainModal: (callback) => {
    ipcRenderer.removeAllListeners('show-missing-toolchain-modal')
    ipcRenderer.on('show-missing-toolchain-modal', (_event, validation) => callback(validation))
  },

  // ── AI Communication ──

  /**
   * AI Prompt — Invoke/Handle Promise pattern.
   * Accepts prompt text and config object { model: string }.
   * Triggers streaming on the Main side; returns an immediate ack.
   * Actual data arrives via the 'ai-stream-chunk' push channel.
   */
  sendAIPrompt: (prompt, config) => ipcRenderer.invoke('send-ai-prompt', prompt, config),

  /**
   * AI Stream Listener — Push model (Main → Renderer).
   * Clears previous listeners to prevent memory leaks on re-mount,
   * then registers a fresh callback for incoming token chunks.
   */
  onAIStream: (callback) => {
    ipcRenderer.removeAllListeners('ai-stream-chunk')
    ipcRenderer.on('ai-stream-chunk', (_event, chunk) => callback(chunk))
  },

  /**
   * Inline AI Handlers
   */
  sendInlineAiPrompt: (prompt, config) => ipcRenderer.invoke('send-inline-ai-prompt', prompt, config),
  onInlineAiStreamChunk: (callback) => {
    ipcRenderer.removeAllListeners('inline-ai-stream-chunk')
    ipcRenderer.on('inline-ai-stream-chunk', (_event, chunk) => callback(chunk))
  },
  getAiCompletion: (prompt, config) => ipcRenderer.invoke('get-ai-completion', prompt, config),
  streamAiDebugger: (prompt, config) => ipcRenderer.invoke('stream-ai-debugger', prompt, config),
  onAiDebuggerStream: (callback) => {
    ipcRenderer.removeAllListeners('ai-debugger-stream')
    ipcRenderer.on('ai-debugger-stream', (_event, chunk) => callback(chunk))
  },
  onPostmanDebuggerStream: (callback) => {
    ipcRenderer.removeAllListeners('postman-debugger-stream')
    ipcRenderer.on('postman-debugger-stream', (_event, chunk) => callback(chunk))
  },

  /**
   * Model Resolution Listener — Push model (Main → Renderer).
   * When Auto Mode resolves to a specific model, this fires
   * so the UI can display which model was selected.
   */
  onModelResolved: (callback) => {
    ipcRenderer.removeAllListeners('ai-model-resolved')
    ipcRenderer.on('ai-model-resolved', (_event, model) => callback(model))
  },

  // ── Secure Credential Storage (Multi-provider) ──

  /**
   * Save API Key for a specific provider — Invoke/Handle Promise pattern.
   * The key is sent to Main which encrypts it via safeStorage
   * and writes the encrypted buffer to disk. The raw key is
   * stored in Node.js memory only — NEVER sent back to renderer.
   */
  saveApiKey: (provider, key) => ipcRenderer.invoke('save-api-key', provider, key),

  /**
   * Get All Saved Keys Status — Invoke/Handle Promise pattern.
   * Returns { [provider]: { exists, hint } } where hint is
   * a masked version like '••••abcd'. NEVER returns raw keys.
   */
  getAllKeys: () => ipcRenderer.invoke('get-all-keys'),

  /**
   * Delete API Key for a specific provider — Invoke/Handle Promise pattern.
   * Removes the provider's encrypted key from disk and memory.
   * Returns { success: boolean, provider? }.
   */
  deleteApiKey: (provider) => ipcRenderer.invoke('delete-api-key', provider),

  // ── Custom Configuration Persistence ──
  getCustomConfig: () => ipcRenderer.invoke('get-custom-config'),
  saveCustomConfig: (config) => ipcRenderer.invoke('save-custom-config', config),

  // ── Terminal ──
  createTerminal: (options) => ipcRenderer.invoke('create-terminal', options),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke('resize-terminal', { id, cols, rows }),
  sendTerminalData: (id, data) => ipcRenderer.invoke('send-terminal-data', { id, data }),
  killTerminal: (id) => ipcRenderer.invoke('kill-terminal', id),
  onTerminalData: (id, callback) => {
    const channel = `terminal-data-${id}`
    ipcRenderer.removeAllListeners(channel)
    ipcRenderer.on(channel, (_event, data) => callback(data))
  },
  onTerminalExit: (id, callback) => {
    const channel = `terminal-exit-${id}`
    ipcRenderer.removeAllListeners(channel)
    ipcRenderer.on(channel, (_event, data) => callback(data))
  },

  // ── Extension Commands ──
  runCommand: (command, cwd) => ipcRenderer.invoke('run-command', command, cwd),
  startLiveServer: (rootPath, openPath) => ipcRenderer.invoke('start-live-server', rootPath, openPath),
  stopLiveServer: () => ipcRenderer.invoke('stop-live-server'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  postmanRequest: (url, options) => ipcRenderer.invoke('postman-request', url, options),
  toggleDevTools: () => ipcRenderer.invoke('toggle-dev-tools'),

  // ── Auth Token Storage & Callbacks ──
  saveAuthToken: (key, value) => ipcRenderer.invoke('save-auth-token', key, value),
  getAuthToken: (key) => ipcRenderer.invoke('get-auth-token', key),
  deleteAuthToken: (key) => ipcRenderer.invoke('delete-auth-token', key),
  onAuthCallback: (callback) => {
    ipcRenderer.removeAllListeners('auth-callback')
    ipcRenderer.on('auth-callback', (_event, url) => callback(url))
  },

  // ── DSA Explainer ──
  runInstrumentedCode: (payload) => ipcRenderer.invoke('run-instrumented-code', payload),

  // ── Debug Adapter Protocol (DAP) ──
  dapStart: (filePath, language, breakpoints = []) => ipcRenderer.invoke('dap-start', filePath, language, breakpoints),
  dapStop: () => ipcRenderer.invoke('dap-stop'),
  dapStep: () => ipcRenderer.invoke('dap-step'),
  dapStepIn: () => ipcRenderer.invoke('dap-step-in'),
  dapStepOut: () => ipcRenderer.invoke('dap-step-out'),
  dapContinue: () => ipcRenderer.invoke('dap-continue'),
  dapEvaluate: (expression) => ipcRenderer.invoke('dap-evaluate', expression),
  dapGetVariables: () => ipcRenderer.invoke('dap-get-variables'),
  onDapPaused: (callback) => {
    ipcRenderer.removeAllListeners('dap-paused')
    ipcRenderer.on('dap-paused', (_event, data) => callback(data))
  },
  onDapOutput: (callback) => {
    ipcRenderer.removeAllListeners('dap-output')
    ipcRenderer.on('dap-output', (_event, data) => callback(data))
  },
  onDapExit: (callback) => {
    ipcRenderer.removeAllListeners('dap-exit')
    ipcRenderer.on('dap-exit', () => callback())
  },
  onDapError: (callback) => {
    ipcRenderer.removeAllListeners('dap-error')
    ipcRenderer.on('dap-error', (_event, data) => callback(data))
  }
}

// ============================================================
// CONTEXT BRIDGE INJECTION
// ============================================================
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
