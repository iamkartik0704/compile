import { spawn } from 'child_process'
import { ipcMain } from 'electron'
import { LSP_REGISTRY } from './lsp-config.js'
import { detectCppCompilers, getCompilerConfig, saveCompilerConfig, validateHostToolchain, getMacOsSdkPath, getResolvedQueryDriverArg, clearToolchainCache } from './compiler-detection.js'

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
      if (onMessage) onMessage(message)
      else sendToWindow('lsp-server-message', { language, message })
      
      if (setStatus && entry.status === 'starting') {
        setStatus('ready')
      }
    } catch (e) {
      console.error(`[LSP ${language}] JSON parse error:`, e)
    }
  }
  entry.buffer = buffer
}

export async function startLanguageServer(language, onMessage, onError, onStatusChange) {
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
    
    // Explicitly inject --query-driver dynamically
    args = [await getResolvedQueryDriverArg()]
    
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

    const entry = { process: child, buffer: Buffer.alloc(0), status: 'starting' }
    lspProcesses.set(language, entry)
    setStatus('starting')

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
    sendToLanguageServer(language, JSON.parse(message))
  })

  ipcMain.handle('lsp-status', (_event, language) => {
    return getLanguageServerStatusForLanguage(language)
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
