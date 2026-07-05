import { spawn } from 'child_process'
import { ipcMain } from 'electron'
import { LSP_REGISTRY } from './lsp-config.js'
import { detectCppCompilers, getCompilerConfig, saveCompilerConfig, validateHostToolchain, getMacOsSdkPath, getResolvedQueryDriverArg, clearToolchainCache } from './compiler-detection.js'
import fs from 'fs'
import path from 'path'
import url from 'url'
import { pathToFileURL } from 'node:url'

// ─── Canonical LSP URI: byte-identical to renderer's monaco.Uri.file() ───
const toLspUri = (absPath) => pathToFileURL(absPath).toString()

const normalizeCanonicalPath = (filePath) => {
  if (!filePath || typeof filePath !== 'string') return '';
  let cleaned = filePath;
  try {
    cleaned = decodeURIComponent(filePath);
  } catch (e) {
    cleaned = filePath;
  }
  return cleaned
    .replace(/^file:\/\/\//i, '')
    .replace(/^file:\/\//i, '')
    .replace(/\\/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
    .trim();
};

const diagnosticCache = new Map();

const uriToPath = (uri) => {
  if (!uri) return ''
  let p = uri.replace(/^file:\/\//, '')
  if (process.platform === 'win32' && p.match(/^\/[a-zA-Z]:\//)) {
    p = p.substring(1)
  }
  return path.normalize(p)
}

const pathToUri = (p) => {
  if (!p) return ''
  let formatted = p.replace(/\\/g, '/')
  if (!formatted.startsWith('/')) formatted = '/' + formatted
  formatted = formatted.replace(/^\/([A-Z]):\//, (match, drive) => `/${drive.toLowerCase()}:/`)
  return `file://${formatted}`
}
// Map to track running language servers: { language: { process, buffer, status } }
const lspProcesses = new Map()

const lspWindows = new Set()

export function setMainWindowLspRef(win) {
  lspWindows.add(win)
  win.on('closed', () => lspWindows.delete(win))
}

function sendToWindow(channel, payload) {
  for (const win of lspWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function parseAndForwardMessages(language, entry, onMessage, setStatus) {
  let buffer = entry.buffer
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) break

    const headerText = buffer.slice(0, headerEnd).toString('utf8')
    const match = headerText.match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      // Malformed header, just clear the buffer to prevent infinite loop
      buffer = Buffer.alloc(0)
      break
    }

    const contentLength = parseInt(match[1], 10)
    const totalLength = headerEnd + 4 + contentLength

    if (buffer.length < totalLength) break

    const messageBuffer = buffer.slice(headerEnd + 4, totalLength)
    buffer = buffer.slice(totalLength)

    try {
      const message = JSON.parse(messageBuffer.toString('utf8'))
      
      if (entry.status === 'starting' && message.id === entry.initId) {
        sendToLanguageServer(language, { jsonrpc: '2.0', method: 'initialized', params: {} })
        if (setStatus) setStatus('ready')
        if (entry.requestQueue && entry.requestQueue.length > 0) {
          for (const req of entry.requestQueue) {
            sendToLanguageServer(language, req)
          }
          entry.requestQueue = []
        }
      } else {
        if (message.method === 'textDocument/publishDiagnostics' && message.params && message.params.uri) {
          // Zero-debounce forwarding: keep the canonical LSP URI intact so the
          // renderer's monaco.Uri.file() lookup hits on the first try, but ALSO
          // ship a normalized fsPath for the fuzzy fallback path.
          const canonicalUri = message.params.uri
          const filePath = uriToPath(canonicalUri)
          const canonicalPath = normalizeCanonicalPath(filePath)
          const diagnostics = message.params.diagnostics || []
          diagnosticCache.set(canonicalPath, diagnostics)
          sendToWindow('lsp:diagnostics', {
            uri: canonicalUri,
            filePath: canonicalPath,
            diagnostics
          })
        }
        if (onMessage) onMessage(message)
        else sendToWindow('lsp-server-message', { language, message })
      }
    } catch (e) {
      console.error(`[LSP ${language}] JSON parse error:`, e)
    }
  }
  entry.buffer = buffer
}

export async function startLanguageServer(language, rootUri = null, onMessage, onError, onStatusChange) {
  if (lspProcesses.has(language)) {
    const entry = lspProcesses.get(language)
    if (entry.status === 'starting' || entry.status === 'ready') {
      return { success: true, alreadyRunning: true, status: entry.status }
    }
  }

  const setStatus = (status) => {
    const entry = lspProcesses.get(language)
    if (entry) {
      entry.status = status
      if (onStatusChange) onStatusChange(status)
      else sendToWindow('lsp-status-change', { language, status })
    }
  }

  const config = LSP_REGISTRY[language]
  if (!config) {
    return {
      success: false,
      error: `No language server configuration for "${language}"`
    }
  }

  let { command, args } = config

  // Pre-flight Validation for C/C++
  let spawnEnv = { ...process.env };
  if (language === 'cpp' || language === 'c') {
    const validation = await validateHostToolchain()
    if (!validation.success) {
      sendToWindow('show-missing-toolchain-modal', validation)
      return { success: false, error: validation.error }
    }
    
    // Industrial-grade command-line flags for clangd
    args = [
      '--background-index',
      '--clang-tidy',
      '--suggest-missing-includes',
      '--completion-style=detailed',
      '--header-insertion=iwyu',
      '--fallback-style=llvm',
      '--query-driver=**/*'
    ]
    
    // Sandbox environment for macOS
    if (process.platform === 'darwin') {
      const sdkPath = await getMacOsSdkPath()
      if (sdkPath) {
        spawnEnv.SDKROOT = sdkPath
      }
    }
  }

  console.log(`[LSP] Starting ${language}: ${command} ${args.join(' ')}`)

  try {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: spawnEnv
    })

    const entry = { process: child, buffer: Buffer.alloc(0), status: 'starting', requestQueue: [], initId: 1, openDocs: new Map() }
    lspProcesses.set(language, entry)
    setStatus('starting')

    sendToLanguageServer(language, {
      jsonrpc: '2.0',
      id: entry.initId,
      method: 'initialize',
      params: {
        processId: process.pid,
        rootUri: rootUri,
        capabilities: {
          textDocument: {
            completion: { completionItem: { snippetSupport: false, labelDetailsSupport: true }, contextSupport: true },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            publishDiagnostics: { relatedInformation: true },
            synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false, dynamicRegistration: false }
          },
          workspace: {}
        },
        initializationOptions: {}
      }
    })

    child.on('error', (err) => {
      console.error(`[LSP ${language}] Process error:`, err)
      if (err.code === 'ENOENT') {
        sendToWindow('show-toast', { 
          message: `LSP Dependency Missing: Could not find ${command} for ${language}`, 
          type: 'error' 
        })
      }
      setStatus('error')
    })

    child.stdout.on('data', (data) => {
      entry.buffer = Buffer.concat([entry.buffer, data])
      parseAndForwardMessages(language, entry, onMessage, setStatus)
    })

    child.stderr.on('data', (data) => {
      const msg = data.toString()
      console.error(`[LSP ${language}] stderr:`, msg)
      if (onError) onError(msg)
    })

    child.on('exit', (code) => {
      console.log(`[LSP ${language}] exited with code ${code}`)
      setStatus('idle')
      lspProcesses.delete(language)
    })

    return { success: true, status: 'starting' }
  } catch (error) {
    console.error(`[LSP] Error spawning ${language}:`, error)
    return { success: false, error: error.message }
  }
}

export function killLanguageServer(language) {
  return new Promise((resolve) => {
    if (lspProcesses.has(language)) {
      console.log(`[LSP] Killing ${language} server`)
      const entry = lspProcesses.get(language)
      if (entry.process && !entry.process.killed) {
        entry.process.once('exit', () => {
          lspProcesses.delete(language)
          sendToWindow('lsp-status-change', { language, status: 'idle' })
          resolve(true)
        })
        entry.process.kill()
      } else {
        lspProcesses.delete(language)
        sendToWindow('lsp-status-change', { language, status: 'idle' })
        resolve(true)
      }
    } else {
      resolve(false)
    }
  })
}

// ─── Canonical-URI document tracking ─────────────────────────────
// Keyed by toLspUri(absPath) so main-side lifecycle and renderer-side
// monaco.Uri.file() land on byte-identical strings.
export async function openDoc(absPath, text, languageId) {
  if (!absPath) return null
  const uri = toLspUri(absPath)
  const language = languageId || 'plaintext'

  let entry = lspProcesses.get(language)
  if (!entry) {
    const parts = absPath.replace(/\\/g, '/').split('/')
    parts.pop()
    await startLanguageServer(language, toLspUri(parts.join('/')))
    entry = lspProcesses.get(language)
  }
  if (!entry) return null

  if (entry.openDocs && entry.openDocs.has(uri)) return uri
  if (!entry.openDocs) entry.openDocs = new Map()
  entry.openDocs.set(uri, 1)

  const msg = {
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri, languageId: language, version: 1, text: text ?? '' } }
  }
  if (entry.status === 'starting') entry.requestQueue.push(msg)
  else sendToLanguageServer(language, msg)
  return uri
}

export function changeDoc(absPath, text, languageId) {
  if (!absPath) return
  const uri = toLspUri(absPath)
  const language = languageId || 'plaintext'
  const entry = lspProcesses.get(language)
  if (!entry) return
  const prev = (entry.openDocs && entry.openDocs.get(uri)) || 0
  const version = prev + 1
  if (entry.openDocs) entry.openDocs.set(uri, version)
  const msg = {
    jsonrpc: '2.0',
    method: 'textDocument/didChange',
    params: {
      textDocument: { uri, version },
      contentChanges: [{ text: text ?? '' }]
    }
  }
  if (entry.status === 'starting') entry.requestQueue.push(msg)
  else sendToLanguageServer(language, msg)
}

export function closeDoc(absPath, languageId) {
  if (!absPath) return
  const uri = toLspUri(absPath)
  const language = languageId || 'plaintext'
  const entry = lspProcesses.get(language)
  diagnosticCache.delete(normalizeCanonicalPath(absPath))
  if (!entry) return
  if (entry.openDocs) entry.openDocs.delete(uri)
  const msg = {
    jsonrpc: '2.0',
    method: 'textDocument/didClose',
    params: { textDocument: { uri } }
  }
  if (entry.status === 'starting') entry.requestQueue.push(msg)
  else sendToLanguageServer(language, msg)
}

export function sendToLanguageServer(language, message) {
  const entry = lspProcesses.get(language)
  if (!entry || !entry.process || !entry.process.stdin) {
    console.warn(`[LSP] Cannot send message, server not running for ${language}`)
    return false
  }

  const messageStr = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(messageStr, 'utf8')}\r\n\r\n`
  entry.process.stdin.write(header + messageStr)
  return true
}

export function getLanguageServerStatusForLanguage(language) {
  return lspProcesses.get(language)?.status || 'idle'
}

// IPC Handlers
export function setupLspIpcHandlers() {
  ipcMain.handle('start-lsp', (_event, language) => {
    return startLanguageServer(language)
  })

  ipcMain.on('lsp-client-message', (_event, { language, message }) => {
    const entry = lspProcesses.get(language)
    const parsed = JSON.parse(message)
    if (entry && entry.status === 'starting') {
      entry.requestQueue.push(parsed)
    } else {
      sendToLanguageServer(language, parsed)
    }
  })

  ipcMain.on('lsp:document-open', async (event, { filePath, text, languageId }) => {
    if (!filePath) return
    const language = languageId || 'plaintext'

    if (language === 'cpp' || language === 'c') {
      const validation = await validateHostToolchain()
      if (!validation.success) {
        if (event && event.sender && !event.sender.isDestroyed()) {
          event.sender.send('show-missing-toolchain-modal', validation)
        }
        return
      }
    }

    let actualText = text
    if (!actualText || actualText.trim() === '') {
      try {
        if (fs.existsSync(filePath)) {
          actualText = fs.readFileSync(filePath, 'utf8')
          console.log(`[LSP Manager] Empty buffer intercepted. Read ${actualText.length} bytes directly from disk for: ${filePath}`)
        }
      } catch (e) {
        console.error(`[LSP Manager] Disk read fallback failed for ${filePath}:`, e)
        return
      }
    }

    await openDoc(filePath, actualText, language)
  })

  ipcMain.on('lsp:document-change', (_event, { filePath, text, languageId }) => {
    if (!filePath) return
    const language = languageId || 'plaintext'
    // If the server isn't running yet for whatever reason, degrade to didOpen.
    const entry = lspProcesses.get(language)
    if (!entry || !(entry.openDocs && entry.openDocs.has(toLspUri(filePath)))) {
      openDoc(filePath, text ?? '', language)
      return
    }
    changeDoc(filePath, text ?? '', language)
  })

  ipcMain.on('lsp:document-close', (_event, { filePath, languageId }) => {
    closeDoc(filePath, languageId || 'plaintext')
  })

  ipcMain.handle('lsp-status', (_event, language) => {
    return getLanguageServerStatusForLanguage(language)
  })

  ipcMain.handle('lsp:get-cached-diagnostics', async (_event, { filePath }) => {
    const canonicalKey = normalizeCanonicalPath(filePath);
    return diagnosticCache.get(canonicalKey) || []
  })

  ipcMain.handle('list-available-lsp', () => {
    return LSP_REGISTRY
  })

  ipcMain.handle('kill-lsp', (_event, language) => {
    return killLanguageServer(language)
  })

  ipcMain.handle('lsp:get-cpp-compilers', async () => {
    return {
      compilers: await detectCppCompilers(),
      config: getCompilerConfig()
    }
  })

  ipcMain.handle('lsp:recheck-toolchain-status', async (_event, language) => {
    clearToolchainCache() // Reset macOS SDK cache in case it was just installed
    const validation = await validateHostToolchain()
    if (validation.success) {
      // Validated, now spawn the language servers without requiring restart
      if (language === 'c' || language === 'cpp') {
        // start both since they share the toolchain
        startLanguageServer('c')
        startLanguageServer('cpp')
      } else {
        startLanguageServer(language)
      }
      return { success: true }
    }
    return { success: false, validation }
  })

  let isRestartingCpp = false
  ipcMain.handle('lsp:set-cpp-compiler', async (_event, configUpdate) => {
    if (isRestartingCpp) return { success: false, error: 'Already restarting' }
    isRestartingCpp = true
    try {
      const config = getCompilerConfig()
      saveCompilerConfig({ ...config, ...configUpdate })
      
      // Tell renderer to clear diagnostics for cpp and c
      sendToWindow('lsp-server-reset', { language: 'cpp' })
      sendToWindow('lsp-server-reset', { language: 'c' })
      
      // Kill both gracefully
      await Promise.all([
        killLanguageServer('cpp'),
        killLanguageServer('c')
      ])
      
      // Restart if they were open (we can just start them if we want, or let renderer restart them)
      // Actually let's just start them to be safe
      startLanguageServer('cpp')
      startLanguageServer('c')
      
      return { success: true }
    } finally {
      isRestartingCpp = false
    }
  })

}
