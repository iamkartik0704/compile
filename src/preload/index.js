import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// ============================================================
// SECURE API SURFACE
// These functions are the ONLY way React can talk to Node.js.
// React can NEVER access fs, path, child_process, safeStorage,
// or any Node.js / Electron module directly.
// ============================================================
const api = {
  // ── File Operations ──

  // File Explorer
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readDirectory: (path) => ipcRenderer.invoke('read-directory', path),
  createFile: (path) => ipcRenderer.invoke('create-file', path),
  createFolder: (path) => ipcRenderer.invoke('create-folder', path),
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
  saveFileContents: (filePath, content) => ipcRenderer.invoke('save-file-contents', filePath, content),

  // ── Language Server Protocol (LSP) — Multi-language ──
  startLanguageServer: (language) => ipcRenderer.invoke('start-lsp', language),
  listAvailableLsp: () => ipcRenderer.invoke('list-available-lsp'),
  sendLspMessage: (language, message) => ipcRenderer.send('lsp-client-message', { language, message }),
  onLspMessage: (callback) => {
    ipcRenderer.removeAllListeners('lsp-server-message')
    ipcRenderer.on('lsp-server-message', (_event, { language, message }) => callback(language, message))
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
