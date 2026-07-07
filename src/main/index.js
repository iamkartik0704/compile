import { app, shell, BrowserWindow, ipcMain, safeStorage, dialog, nativeTheme, Menu } from 'electron'
import { join, resolve, sep } from 'path'
import { readFileSync, writeFileSync, existsSync, chmodSync, promises as fsPromises } from 'fs'
import { exec as execCallback } from 'child_process'
import { promisify } from 'util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { terminalManager } from './terminal-manager.js'
import { setupLspIpcHandlers, setMainWindowLspRef } from './lsp-manager.js'
import { DapManager } from './dap-manager.js'
import { setupCompilationDbHandlers } from './compilation-db.js'
import { getCompilerPathsForLanguage, detectCppCompilers } from './compiler-detection.js'
import os from 'os'

const exec = promisify(execCallback)

const watchers = new Map();
const liveServers = new Map();
// ============================================================
// IN-MEMORY API KEY CACHE — per-provider map
// { provider: decryptedKey }
// The decrypted keys live here and ONLY here. They are never
// sent back to the renderer process.
// ============================================================
let apiKeyCache = {}

// ============================================================
// SECURITY — Valid provider whitelist
// Only these provider IDs are accepted via IPC. Prevents
// arbitrary strings from being used as storage keys.
// ============================================================
const VALID_PROVIDERS = ['openai', 'anthropic', 'google', 'deepseek', 'qwen', 'meta', 'oss', 'groq', 'custom']

// ============================================================
// SECURITY — API Key Format Validation
// ============================================================
function validateApiKey(key) {
  if (!key || typeof key !== 'string') return 'API key must be a non-empty string'
  const trimmed = key.trim()
  if (trimmed.length < 10) return 'API key is too short (minimum 10 characters)'
  if (trimmed.length > 512) return 'API key is too long (maximum 512 characters)'
  if (!/^[a-zA-Z0-9_\-.:]+$/.test(trimmed)) return 'API key contains invalid characters'
  return null // valid
}

// ============================================================
// AUTO MODE — KEYWORD ROUTER
// ============================================================
const COMPLEX_KEYWORDS = [
  'fix', 'bug', 'architect', 'complex', 'logic',
  'refactor', 'debug', 'optimize', 'design pattern',
  'security', 'vulnerability', 'error', 'crash',
  'performance', 'memory leak', 'race condition'
]

function resolveAutoMode(prompt) {
  const lower = prompt.toLowerCase()
  const isComplex = COMPLEX_KEYWORDS.some((kw) => lower.includes(kw))
  const idealModel = isComplex ? 'claude-opus' : 'gemini-flash'
  
  // If we have the key for the ideal model, use it
  if (apiKeyCache[MODEL_CONFIG[idealModel]?.provider]) {
    return idealModel
  }
  
  // Otherwise, fallback to the first model we have a key for
  for (const [modelId, config] of Object.entries(MODEL_CONFIG)) {
    if (apiKeyCache[config.provider]) {
      return modelId
    }
  }
  
  // If no keys configured at all, return ideal (will trigger standard no-key error)
  return idealModel
}

// ============================================================
// MODEL → PROVIDER + REAL API MODEL MAPPING
// ============================================================
const MODEL_CONFIG = {
  'gemini-flash': {
    provider: 'google',
    apiModel: 'gemini-2.5-flash',
    type: 'gemini'
  },
  'gemini-pro': {
    provider: 'google',
    apiModel: 'gemini-2.5-pro',
    type: 'gemini'
  },
  'claude-sonnet': {
    provider: 'anthropic',
    apiModel: 'claude-sonnet-4-20250514',
    type: 'anthropic'
  },
  'claude-opus': {
    provider: 'anthropic',
    apiModel: 'claude-opus-4-20250514',
    type: 'anthropic'
  },
  'deepseek-chat': {
    provider: 'deepseek',
    apiModel: 'deepseek-chat',
    type: 'openai-compatible',
    baseURL: 'https://api.deepseek.com/v1'
  },
  'deepseek-r1': {
    provider: 'deepseek',
    apiModel: 'deepseek-reasoner',
    type: 'openai-compatible',
    baseURL: 'https://api.deepseek.com/v1'
  },
  'qwen-plus': {
    provider: 'qwen',
    apiModel: 'qwen-plus',
    type: 'openai-compatible',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  },
  'groq-llama-3': {
    provider: 'groq',
    apiModel: 'llama-3.3-70b-versatile',
    type: 'openai-compatible',
    baseURL: 'https://api.groq.com/openai/v1'
  },
  'groq-mixtral': {
    provider: 'groq',
    apiModel: 'mixtral-8x7b-32768',
    type: 'openai-compatible',
    baseURL: 'https://api.groq.com/openai/v1'
  },
  'gpt-oss-120b': {
    provider: 'oss',
    apiModel: null,
    type: 'simulation'
  },
  'llama-4': {
    provider: 'meta',
    apiModel: null,
    type: 'simulation'
  }
}

// ============================================================
// SIMULATION FALLBACK RESPONSES
// Used when a model has no hosted API or no API key is set.
// ============================================================
const SIMULATION_RESPONSES = {
  'gpt-oss-120b': {
    tokens: ['// GPT-OSS 120B 🔓 (Simulated — no hosted API)\n', 'export ', 'default ', 'function ', 'handler(', 'req, res', ') {\n', '  const { ', 'prompt ', '} = req.body;\n', '  const result ', '= model.', 'generate(prompt);\n', '  res.json({ result });\n', '}'],
    delay: [80, 40, 40, 40, 40, 40, 30, 40, 30, 40, 50, 30, 50, 50, 30]
  },
  'llama-4': {
    tokens: ['// Llama 4 🔓 Open Source (Simulated — no hosted API)\n', 'import ', 'torch\n', 'from ', 'transformers ', 'import ', 'AutoModelForCausalLM\n\n', 'model ', '= AutoModelForCausalLM.', 'from_pretrained(\n', '  "meta-llama/Llama-4"\n', ')\n', 'output = ', 'model.generate(', 'input_ids, ', 'max_length=512', ')\n', ''],
    delay: [90, 40, 30, 30, 50, 30, 60, 20, 40, 60, 50, 50, 30, 40, 50, 40, 50, 30]
  }
}

// ============================================================
// REAL API STREAMING FUNCTIONS
// ============================================================

/**
 * Stream from Anthropic (Claude Sonnet, Claude Opus)
 */
async function streamAnthropic(apiModel, prompt, sender, images = [], emitEvent = 'ai-stream-chunk') {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: apiKeyCache['anthropic'] })

  let content = prompt
  if (images && images.length > 0) {
    content = [
      ...images.map(img => {
        const [header, base64] = img.split(',')
        const media_type = header.match(/:(.*?);/)[1]
        return {
          type: 'image',
          source: { type: 'base64', media_type, data: base64 }
        }
      }),
      { type: 'text', text: prompt }
    ]
  }

  const stream = client.messages.stream({
    model: apiModel,
    max_tokens: 4096,
    messages: [{ role: 'user', content }]
  })

  stream.on('text', (text) => {
    sender.send(emitEvent, text)
  })

  // Wait for stream to complete
  await stream.finalMessage()
}

/**
 * Stream from Google Gemini (Gemini Flash, Gemini Pro)
 */
async function streamGemini(apiModel, prompt, sender, images = [], emitEvent = 'ai-stream-chunk') {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(apiKeyCache['google'])
  const model = genAI.getGenerativeModel({ model: apiModel })

  let parts = [prompt]
  if (images && images.length > 0) {
    parts = [
      prompt,
      ...images.map(img => {
        const [header, base64] = img.split(',')
        const mimeType = header.match(/:(.*?);/)[1]
        return {
          inlineData: {
            data: base64,
            mimeType
          }
        }
      })
    ]
  }

  const result = await model.generateContentStream(parts)

  for await (const chunk of result.stream) {
    const text = chunk.text()
    if (text) {
      sender.send(emitEvent, text)
    }
  }
}

/**
 * Stream from OpenAI-compatible APIs (OpenAI, DeepSeek, Qwen)
 * These providers expose OpenAI-compatible endpoints.
 */
async function streamOpenAICompatible(apiModel, prompt, sender, baseURL, provider, images = [], emitEvent = 'ai-stream-chunk') {
  const OpenAI = (await import('openai')).default
  const isOpenRouter = baseURL && baseURL.includes('openrouter.ai')
  const client = new OpenAI({
    apiKey: apiKeyCache[provider],
    baseURL: baseURL || undefined,
    defaultHeaders: isOpenRouter ? {
      'HTTP-Referer': 'https://github.com/comiple/ide',
      'X-Title': 'comiple IDE'
    } : undefined
  })

  let content = prompt
  if (images && images.length > 0) {
    content = [
      { type: 'text', text: prompt },
      ...images.map(img => ({ type: 'image_url', image_url: { url: img } }))
    ]
  }

  const stream = await client.chat.completions.create({
    model: apiModel,
    stream: true,
    max_tokens: 4096,
    messages: [{ role: 'user', content }]
  })

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content
    if (text) {
      sender.send(emitEvent, text)
    }
  }
}

/**
 * Simulation fallback for models without hosted APIs
 */
async function streamSimulation(modelId, sender, emitEvent = 'ai-stream-chunk') {
  const config = SIMULATION_RESPONSES[modelId]
  if (!config) {
    sender.send(emitEvent, `// No simulation available for model: ${modelId}\n`)
    return
  }

  for (let i = 0; i < config.tokens.length; i++) {
    await new Promise((r) => setTimeout(r, config.delay[i] || 80))
    sender.send(emitEvent, config.tokens[i])
  }
}

// ============================================================
// MAIN PROVIDER ROUTER — Real API calls
// ============================================================
async function routeToProvider(modelId, prompt, sender, fullConfig = {}) {
  let config = MODEL_CONFIG[modelId]
  const emitEvent = fullConfig.emitEvent || 'ai-stream-chunk'

  // Handle Dynamic Custom Provider
  if (modelId === 'custom') {
    config = {
      provider: 'custom',
      apiModel: fullConfig.customConfig?.modelId || '',
      type: 'openai-compatible',
      baseURL: fullConfig.customConfig?.baseURL || ''
    }
  }

  if (!config) {
    sender.send(emitEvent, `// Unknown model: ${modelId}\n`)
    return
  }

  // Simulation-only models (no hosted API)
  if (config.type === 'simulation') {
    sender.send(emitEvent, `// ℹ️ ${modelId} uses local/self-hosted inference.\n// This is a simulated response.\n\n`)
    await streamSimulation(modelId, sender, emitEvent)
    return
  }

  // Check if API key exists for this provider
  const apiKey = apiKeyCache[config.provider]
  if (!apiKey) {
    sender.send(
      emitEvent,
      `// ⚠️ No API key configured for "${config.provider}".\n` +
      `// Go to Settings (gear icon) → Select "${config.provider}" → Paste your API key → Save.\n` +
      `// Then try again.\n`
    )
    return
  }

  // Route to the correct SDK
  try {
    switch (config.type) {
      case 'anthropic':
        await streamAnthropic(config.apiModel, prompt, sender, fullConfig.images, emitEvent)
        break
      case 'gemini':
        await streamGemini(config.apiModel, prompt, sender, fullConfig.images, emitEvent)
        break
      case 'openai-compatible':
        await streamOpenAICompatible(config.apiModel, prompt, sender, config.baseURL, config.provider, fullConfig.images, emitEvent)
        break
      default:
        sender.send(emitEvent, `// Unknown provider type: ${config.type}\n`)
    }
  } catch (err) {
    // Handle API-specific errors gracefully
    const errorMessage = err.message || 'Unknown error'
    let userFriendlyError = errorMessage

    if (errorMessage.includes('401') || errorMessage.includes('authentication') || errorMessage.includes('invalid_api_key') || errorMessage.includes('Unauthorized')) {
      userFriendlyError = `Invalid API key for "${config.provider}". Please check your key in Settings.`
    } else if (errorMessage.includes('429') || errorMessage.includes('rate_limit') || errorMessage.includes('Rate limit')) {
      userFriendlyError = `Rate limit exceeded for "${config.provider}". Please wait a moment and try again.`
    } else if (errorMessage.includes('insufficient_quota') || errorMessage.includes('billing')) {
      userFriendlyError = `Billing/quota issue with your "${config.provider}" account. Check your API plan.`
    } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
      userFriendlyError = `Network error — cannot reach "${config.provider}" API. Check your internet connection.`
    }

    sender.send(emitEvent, `\n// ❌ Error: ${userFriendlyError}\n`)
    console.error(`Provider error (${config.provider}/${config.apiModel}):`, err)
  }
}

// ============================================================
// SECURE KEY FILE PATH — multi-provider JSON map
// ============================================================
function getKeyFilePath() {
  return join(app.getPath('userData'), '.compile-api-keys')
}

/**
 * Read the multi-key JSON file from disk.
 * Returns { provider: encryptedBase64String } or {} if not found.
 */
function readKeyFile() {
  try {
    const filePath = getKeyFilePath()
    if (!existsSync(filePath)) return {}
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * Write the multi-key JSON map to disk with restrictive permissions.
 * mode 0o600 = owner read/write only (no group/others access).
 */
function writeKeyFile(keyMap) {
  const filePath = getKeyFilePath()
  writeFileSync(filePath, JSON.stringify(keyMap, null, 2), { encoding: 'utf-8', mode: 0o600 })

  // On Windows, writeFileSync mode flag doesn't work the same way.
  // Use chmodSync as a best-effort to restrict permissions.
  try {
    chmodSync(filePath, 0o600)
  } catch {
    // chmodSync may fail on some Windows configurations — that's OK,
    // the file is still encrypted via safeStorage.
  }
}

// ============================================================
// WINDOW CREATION
// ============================================================
function createWindow() {
  // Create the browser window.

  // --- EXISTING HANDLERS ---
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0c0c14',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // ── SECURITY: These two settings are NON-NEGOTIABLE ──
      // Note: sandbox is false because @electron-toolkit/preload
      // requires Node.js APIs in the preload context. Security is
      // enforced via contextIsolation + nodeIntegration:false instead.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized-changed', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized-changed', false))

  // Allow native clipboard reading (fixes Monaco pasting via context menu)
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    return true
  })
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true)
  })

  // Log renderer console messages to terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message} (at ${sourceId}:${line})`)
  })

  // Force dark theme so native inputs (like <select> dropdown popups) render correctly
  nativeTheme.themeSource = 'dark'

  // Disable Electron's built-in pinch/Ctrl+Scroll zoom so our custom editor zoom works
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  })

  // Intercept Ctrl+=/Ctrl+-/Ctrl+0 BEFORE Electron consumes them for its own zoom.
  // Forward them to the renderer so our custom editor zoom handler can process them.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && !input.alt && !input.meta) {
      if (input.key === '-' || input.key === '=' || input.key === '+' || input.key === '0') {
        event.preventDefault()
        mainWindow.webContents.send('zoom-shortcut', input.key)
      }
    }
  })

  // Prevent white flash — show only when fully rendered
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  terminalManager.init()
  setMainWindowLspRef(mainWindow)
  // Route external links to the OS browser, never in-app
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // ── Load the renderer ──
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }


  // ============================================================

  /**
   * Handler: File Read
   */
  const windowId = mainWindow.webContents.id;
  mainWindow.on('closed', () => {
    if (watchers.has(windowId)) {
      watchers.get(windowId).close();
      watchers.delete(windowId);
    }
    if (liveServers.has(windowId)) {
      liveServers.get(windowId).kill();
      liveServers.delete(windowId);
    }
  });
}



  // ============================================================
  // IPC HANDLERS — The Backend Logic



// --- FILE EXPLORER HANDLERS ---
ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(options || {})
  if (result.canceled) return null
  return result.filePath
})

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile']
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('read-directory', async (event, dirPath) => {
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true })
    const files = []
    const folders = []
    
    for (const entry of entries) {
      const isDirectory = entry.isDirectory()
      const item = {
        name: entry.name,
        path: join(dirPath, entry.name),
        isDirectory
      }
      if (isDirectory) folders.push(item)
      else files.push(item)
    }
    
    return [
      ...folders.sort((a, b) => a.name.localeCompare(b.name)),
      ...files.sort((a, b) => a.name.localeCompare(b.name))
    ]
  } catch (error) {
    console.error('Error reading directory:', error)
    return null
  }
})

ipcMain.handle('get-project-tree', async (event, dirPath) => {
  async function walk(dir) {
    let results = []
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          const sub = await walk(fullPath)
          results = results.concat(sub)
        } else {
          results.push(fullPath)
        }
      }
    } catch (err) {}
    return results
  }
  return walk(dirPath)
})

ipcMain.handle('create-file', async (event, filePath) => {
  try {
    await fsPromises.writeFile(filePath, '')
    return { success: true }
  } catch (error) {
    console.error('Error creating file:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('create-folder', async (event, folderPath) => {
  try {
    await fsPromises.mkdir(folderPath, { recursive: true })
    return { success: true }
  } catch (error) {
    console.error('Error creating folder:', error)
    return { success: false, error: error.message }
  }
})

// --- Native Context Menu IPC Handlers ---
function assertInWorkspace(targetPath, workspaceRoot) {
  const resolvedPath = resolve(targetPath)
  const root = resolve(workspaceRoot)
  if (resolvedPath !== root && !resolvedPath.startsWith(root + sep)) {
    throw new Error('Path is outside the workspace root')
  }
  return resolvedPath
}

ipcMain.handle('rename-item', async (event, oldPath, newPath, workspaceRoot) => {
  try {
    assertInWorkspace(oldPath, workspaceRoot)
    assertInWorkspace(newPath, workspaceRoot)
    try {
      await fsPromises.access(newPath)
      return { success: false, error: 'exists' }
    } catch (e) {
      // expected, does not exist
    }
    await fsPromises.rename(oldPath, newPath)
    return { success: true, oldPath, newPath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('delete-item', async (event, itemPath, workspaceRoot) => {
  try {
    assertInWorkspace(itemPath, workspaceRoot)
    await shell.trashItem(itemPath)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('delete-item-permanent', async (event, itemPath, workspaceRoot) => {
  try {
    assertInWorkspace(itemPath, workspaceRoot)
    await fsPromises.rm(itemPath, { recursive: true, force: true })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('copy-item', async (event, src, dest, workspaceRoot, mode) => {
  try {
    assertInWorkspace(src, workspaceRoot)
    const resolvedDest = assertInWorkspace(dest, workspaceRoot)
    const resolvedSrc = resolve(src)
    
    // Prevent copying into its own subtree
    if (resolvedDest.startsWith(resolvedSrc + sep)) {
      return { success: false, error: 'destination is inside source' }
    }

    if (mode !== 'overwrite') {
      try {
        await fsPromises.access(dest)
        return { success: false, error: 'exists' }
      } catch (e) {
        // does not exist
      }
    }
    await fsPromises.cp(src, dest, { recursive: true })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('reveal-in-explorer', async (event, itemPath) => {
  try {
    shell.showItemInFolder(require('path').normalize(itemPath))
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('write-clipboard', async (event, text) => {
  try {
    const { clipboard } = require('electron')
    clipboard.writeText(text)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('read-clipboard', async (event) => {
  try {
    const { clipboard } = require('electron')
    return { success: true, text: clipboard.readText() }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('paste-from-os-clipboard', async (event, destFolder) => {
  try {
    const { clipboard } = require('electron')
    const fs = require('fs')
    const path = require('path')

    const img = clipboard.readImage()
    if (img && !img.isEmpty()) {
      const buffer = img.toPNG()
      let counter = 1
      let filename = 'image.png'
      let destPath = path.join(destFolder, filename)
      while (fs.existsSync(destPath)) {
        filename = `image_${counter}.png`
        destPath = path.join(destFolder, filename)
        counter++
      }
      await require('fs').promises.writeFile(destPath, buffer)
      return { success: true, type: 'image', path: destPath }
    }

    const fileBuffer = clipboard.readBuffer('FileNameW')
    if (fileBuffer && fileBuffer.length > 0) {
      let filePath = fileBuffer.toString('ucs2').replace(/\0/g, '')
      if (filePath && fs.existsSync(filePath)) {
        const fileName = path.basename(filePath)
        let destPath = path.join(destFolder, fileName)
        let counter = 1
        const parts = fileName.split('.')
        const ext = parts.length > 1 ? `.${parts.pop()}` : ''
        const base = parts.join('.')
        while (fs.existsSync(destPath)) {
          destPath = path.join(destFolder, `${base} copy ${counter}${ext}`)
          counter++
        }
        await require('fs').promises.cp(filePath, destPath, { recursive: true })
        return { success: true, type: 'file', path: destPath }
      }
    }
    
    return { success: false, error: 'No image or file found in OS clipboard' }
  } catch (err) {
    return { success: false, error: err.message }
  }
})


ipcMain.handle('watch-project', async (event, rootPath) => {
  const id = event.sender.id;
  if (watchers.has(id)) {
    await watchers.get(id).close()
    watchers.delete(id)
  }
  
  if (!rootPath) return

  const { default: chokidar } = await import('chokidar')

  const currentWatcher = chokidar.watch(rootPath, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    depth: 10
  })

  currentWatcher.on('all', (eventName, path) => {
    if (['add', 'unlink', 'addDir', 'unlinkDir'].includes(eventName)) {
      if (!event.sender.isDestroyed()) {
        event.sender.send('fs-changed', { event: eventName, path })
      }
    }
  })
  watchers.set(id, currentWatcher);
})

// ── Window control IPC (for custom title bar) ──
ipcMain.handle('window-minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
ipcMain.handle('window-maximize-toggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.handle('window-close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
ipcMain.handle('window-is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized())
  ipcMain.handle('get-file-contents', async (_event, filePath) => {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (error) {
      console.error('Error reading file:', error)
      return { success: false, error: error.message }
    }
  })

  /**
   * Handler: File Save
   */
  ipcMain.handle('save-file-contents', async (_event, filePath, content) => {
    try {
      await fsPromises.mkdir(require('path').dirname(filePath), { recursive: true })
      await fsPromises.writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (error) {
      console.error('Error saving file:', error)
      return { success: false, error: error.message }
    }
  })

  // ============================================================
  // LANGUAGE SERVER PROTOCOL (LSP) — Multi-language
  // ============================================================

  // ── Git Operations ──
  ipcMain.handle('git-status', async (event, cwd) => {
    try {
      if (!existsSync(join(cwd, '.git'))) return { error: 'Not a git repository' }
      const { stdout } = await exec('git status --porcelain', { cwd })
      return { status: stdout }
    } catch (e) {
      return { error: e.message }
    }
  })

  ipcMain.handle('git-action', async (event, cwd, action, ...args) => {
    try {
      let command = ''
      if (action === 'add') command = `git add "${args[0]}"`
      else if (action === 'unstage') command = `git restore --staged "${args[0]}"`
      else if (action === 'commit') {
        const msg = args[0].replace(/"/g, '\\"')
        command = `git commit -m "${msg}"`
      }
      else if (action === 'push') command = `git push`
      else if (action === 'pull') command = `git pull`
      else if (action === 'show-head') {
        const filepath = args[0].replace(/\\/g, '/')
        command = `git show HEAD:"${filepath}"`
      }
      else if (action === 'blame') {
        const filepath = args[0].replace(/\\/g, '/')
        const line = args[1]
        command = `git blame -L ${line},${line} --porcelain "${filepath}"`
      }
      else if (action === 'log') {
        command = `git log --graph --pretty=format:"%h|||%an|||%ar|||%s" --all -n 100`
      }
      else return { error: 'Unknown action' }

      const { stdout, stderr } = await exec(command, { cwd })
      return { success: true, stdout, stderr }
    } catch (e) {
      return { error: e.message }
    }
  })

  setupLspIpcHandlers()
  setupCompilationDbHandlers()

  /**
   * Handler: AI Prompt → Auto Mode + SDK Router + Streaming
   *
   * Flow:
   *   1. Receive prompt + config { model }
   *   2. If model === 'auto', resolve via keyword analysis
   *   3. Notify renderer which model was selected
   *   4. Route to real SDK provider for streaming
   *   5. Handle errors gracefully
   */
  ipcMain.handle('send-ai-prompt', async (event, prompt, config = {}) => {
    let model = config.model || 'auto'

    // Auto Mode resolution
    if (model === 'auto') {
      model = resolveAutoMode(prompt)
      console.log(`Auto Mode resolved: "${prompt.substring(0, 40)}..." → ${model}`)
    }

    // Notify renderer which model is being used
    event.sender.send('ai-model-resolved', model)
    console.log(`Routing to provider: ${model}`)

    // Route to provider (async streaming)
    try {
      await routeToProvider(model, prompt, event.sender, config)
      event.sender.send('ai-stream-chunk', '\n')
      return { status: 'done', model }
    } catch (err) {
      console.error('Provider error:', err)
      event.sender.send('ai-stream-chunk', `\n// ❌ Error: ${err.message}`)
      return { status: 'error', model, error: err.message }
    }
  })

  /**
   * Handler: Inline AI Prompt (Ctrl+K)
   * Streams to 'inline-ai-stream-chunk' to separate from chat
   */
  ipcMain.handle('send-inline-ai-prompt', async (event, prompt, config = {}) => {
    let model = config.model || 'auto'

    if (model === 'auto') {
      model = resolveAutoMode(prompt)
    }

    try {
      await routeToProvider(model, prompt, event.sender, { ...config, emitEvent: 'inline-ai-stream-chunk' })
      return { status: 'done', model }
    } catch (err) {
      console.error('Provider error:', err)
      event.sender.send('inline-ai-stream-chunk', `\n// ❌ Error: ${err.message}`)
      return { status: 'error', model, error: err.message }
    }
  })

  /**
   * Handler: Ghost Text Completion
   * Collects the stream server-side and returns a resolved string.
   */
  ipcMain.handle('get-ai-completion', async (event, prompt, config = {}) => {
    console.log('GET AI COMPLETION TRIGGERED:', prompt.substring(0, 50) + '...')
    let model = config.model || 'auto'
    if (model === 'auto') model = resolveAutoMode(prompt)
    
    let fullResponse = ''
    const mockSender = {
      send: (eventName, chunk) => {
        if (eventName === 'ghost-text-stream') {
          // ignore status/info comments like // Unknown provider
          if (!chunk.startsWith('//')) {
            fullResponse += chunk
          }
        }
      }
    }
    
    try {
      await routeToProvider(model, prompt, mockSender, { ...config, emitEvent: 'ghost-text-stream' })
      return { success: true, text: fullResponse }
    } catch (err) {
      console.error('Provider error:', err)
      return { success: false, error: err.message }
    }
  })

  /**
   * Handler: Stream AI Debugger
   * Streams responses to the ai-debugger-stream event
   */
  ipcMain.handle('stream-ai-debugger', async (event, prompt, config = {}) => {
    console.log('STREAM AI DEBUGGER TRIGGERED:', prompt.substring(0, 50) + '...')
    let model = config.model || 'auto'
    if (model === 'auto') model = resolveAutoMode(prompt)
    
    try {
      const emitEvent = config.emitEvent || 'ai-debugger-stream'
      await routeToProvider(model, prompt, event.sender, { ...config, emitEvent })
      return { success: true }
    } catch (err) {
      console.error('Provider error:', err)
      const emitEvent = config.emitEvent || 'ai-debugger-stream'
      event.sender.send(emitEvent, `\n// ❌ Error: ${err.message}`)
      return { success: false, error: err.message }
    }
  })

  // ============================================================
  // SECURE CREDENTIAL STORAGE HANDLERS — Multi-provider
  // ============================================================

  /**
   * Handler: Save API Key for a specific provider
   *
   * Security:
   *   - Provider name must be in VALID_PROVIDERS whitelist
   *   - Key is validated for format (length, characters)
   *   - Encrypted via safeStorage (OS credential manager)
   *   - File written with restrictive permissions (0o600)
   *   - Raw key NEVER returned to renderer
   */
  ipcMain.handle('save-api-key', async (_event, provider, key) => {
    try {
      // ── Security: Validate provider name ──
      if (!provider || typeof provider !== 'string') {
        return { success: false, error: 'Provider is required.' }
      }
      if (!VALID_PROVIDERS.includes(provider)) {
        return { success: false, error: `Unknown provider "${provider}".` }
      }

      // ── Security: Validate key format ──
      if (!key || typeof key !== 'string') {
        return { success: false, error: 'API key is required.' }
      }
      const validationError = validateApiKey(key)
      if (validationError) {
        return { success: false, error: validationError }
      }

      if (!safeStorage.isEncryptionAvailable()) {
        console.error('safeStorage: Encryption not available on this OS')
        return {
          success: false,
          error: 'OS credential manager is not available. Cannot encrypt securely.'
        }
      }

      // Encrypt the key and store as base64
      const trimmedKey = key.trim()
      const encrypted = safeStorage.encryptString(trimmedKey)
      const encryptedBase64 = encrypted.toString('base64')

      // Read existing map, update, write back (with restrictive permissions)
      const keyMap = readKeyFile()
      keyMap[provider] = encryptedBase64
      writeKeyFile(keyMap)

      // Cache in memory for SDK calls
      apiKeyCache[provider] = trimmedKey

      // Return masked hint — NEVER the raw key
      const hint = trimmedKey.length > 4 ? '••••' + trimmedKey.slice(-4) : '••••'
      console.log(`API key saved for provider "${provider}" (encrypted on disk)`)

      return { success: true, provider, hint }
    } catch (err) {
      console.error('Failed to save API key:', err)
      return { success: false, error: err.message }
    }
  })

  /**
   * Handler: Get All Saved Keys Status
   *
   * Returns { [provider]: { exists, hint } } — NEVER raw keys.
   */
  ipcMain.handle('get-all-keys', async () => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return {}
      }

      const keyMap = readKeyFile()
      const result = {}

      for (const [provider, encryptedBase64] of Object.entries(keyMap)) {
        // ── Security: Skip unknown providers ──
        if (!VALID_PROVIDERS.includes(provider)) {
          console.warn(`Skipping unknown provider in key file: "${provider}"`)
          continue
        }

        try {
          const encrypted = Buffer.from(encryptedBase64, 'base64')
          const decrypted = safeStorage.decryptString(encrypted)

          // Cache in memory
          apiKeyCache[provider] = decrypted

          // Return masked hint — NEVER the raw key
          const hint = decrypted.length > 4 ? '••••' + decrypted.slice(-4) : '••••'
          result[provider] = { exists: true, hint }
        } catch (decryptErr) {
          console.error(`Failed to decrypt key for provider "${provider}":`, decryptErr)
          result[provider] = { exists: false, error: 'Decryption failed' }
        }
      }

      console.log(`Loaded ${Object.keys(result).length} API key(s) from encrypted storage`)
      return result
    } catch (err) {
      console.error('Failed to load API keys:', err)
      return {}
    }
  })

  /**
   * Handler: Custom Config Persistence
   */
  const CONFIG_FILE = join(app.getPath('userData'), 'custom_config.json')

  ipcMain.handle('get-custom-config', () => {
    try {
      if (existsSync(CONFIG_FILE)) {
        return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
      }
    } catch (e) {
      console.error('Failed to read custom config', e)
    }
    return null
  })

  ipcMain.handle('save-custom-config', (_event, config) => {
    try {
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
      return true
    } catch (e) {
      console.error('Failed to write custom config', e)
      return false
    }
  })

  /**
   * Handler: Delete API Key for a specific provider
   *
   * Security:
   *   - Provider must be in VALID_PROVIDERS whitelist
   *   - Key removed from both disk and memory
   */
  ipcMain.handle('delete-api-key', async (_event, provider) => {
    try {
      // ── Security: Validate provider name ──
      if (!provider || typeof provider !== 'string') {
        return { success: false, error: 'Provider is required.' }
      }
      if (!VALID_PROVIDERS.includes(provider)) {
        return { success: false, error: `Unknown provider "${provider}".` }
      }

      const keyMap = readKeyFile()

      if (!keyMap[provider]) {
        return { success: false, error: `No key found for provider "${provider}".` }
      }

      // Remove from map and write back
      delete keyMap[provider]
      writeKeyFile(keyMap)

      // ── Security: Clear from in-memory cache ──
      if (apiKeyCache[provider]) {
        apiKeyCache[provider] = '' // overwrite before delete
        delete apiKeyCache[provider]
      }

      console.log(`API key deleted for provider "${provider}"`)
      return { success: true, provider }
    } catch (err) {
      console.error('Failed to delete API key:', err)
      return { success: false, error: err.message }
    }
  })

  // ============================================================
  // EXTENSION COMMANDS (PRODUCTIVITY)
  // ============================================================
  
  ipcMain.handle('run-command', async (event, command, cwd) => {
    return new Promise((resolve) => {
      execCallback(command, { cwd }, (error, stdout, stderr) => {
        resolve({ 
          error: error ? error.message : null, 
          stdout, 
          stderr 
        })
      })
    })
  })

  ipcMain.handle('open-url', async (event, url) => {
    const { shell } = require('electron')
    await shell.openExternal(url)
    return { success: true }
  })

  ipcMain.handle('postman-request', async (event, url, options) => {
    try {
      const res = await fetch(url, options)
      
      const headers = {}
      res.headers.forEach((val, key) => { headers[key] = val })
      
      let data = await res.text()
      
      return {
        success: true,
        status: res.status,
        statusText: res.statusText,
        headers,
        data
      }
    } catch (err) {
      return {
        success: false,
        error: err.message
      }
    }
  })
  let liveServerProcess = null

  ipcMain.handle('start-live-server', async (event, rootPath, openPath = '') => {
    if (liveServerProcess) {
      return { success: false, error: 'Server already running' }
    }
    return new Promise((resolve) => {
      // Spawn npx http-server
      const { spawn } = require('child_process')
      liveServerProcess = spawn('npx', ['http-server', './', '-c-1', '-p', '3000'], {
        cwd: rootPath,
        shell: true
      })
      
      // Wait a moment for it to start
      setTimeout(() => {
        const targetUrl = `http://localhost:3000/${openPath.replace(/\\/g, '/')}`
        const { shell } = require('electron')
        shell.openExternal(targetUrl)
        resolve({ success: true, url: targetUrl, baseUrl: 'http://localhost:3000' })
      }, 1500)

      liveServerProcess.on('exit', () => {
        liveServers.delete(id);
      })
    })
  })

  ipcMain.handle('stop-live-server', async (event) => {
    const id = event.sender.id;
    if (liveServers.has(id)) {
      liveServers.get(id).kill();
      liveServers.delete(id);
    }
    return { success: true }
  })

ipcMain.handle('create-new-window', () => createWindow())

// ============================================================
// DSA EXPLAINER — Sandboxed instrumented-code execution
// Executes AI-instrumented JS / Python / C++ / Java snippets
// in an isolated child process and captures the emitted JSON
// trace snapshots. Snapshots are printed one-per-line prefixed
// with __DSA__. Compilation (C++/Java) uses its own timeout so
// slow compiles don't eat into the 10 s trace-capture window.
// ============================================================
const MAX_TRACE_FRAMES = 200
const DSA_EXEC_TIMEOUT_MS = 10000
const DSA_COMPILE_TIMEOUT_MS = 15000
const JAVA_MAIN_CLASS = 'DsaTrace'

// ── Per-renderer concurrent-invocation backstop ─────────────
// The renderer already gates re-entry via a synchronous ref +
// disabled button. If any of that is ever bypassed (dev tools,
// script-injected click, another renderer window sharing this
// main), reject overlapping runs so we don't spawn parallel
// compilers / children fighting for the same tmp dir.
const dsaInFlight = new Set()

// ── JDK tool resolution ─────────────────────────────────────
// spawn('javac', ...) with the default env is unreliable on Windows
// because GUI-launched Electron processes don't always see PATH
// updates the JDK installer made. Try, in order:
//   1. JAVA_HOME/bin/<name>
//   2. Common install roots (per-platform)
//   3. Bare name + shell:true so the OS shell resolves PATH
// Returns { path: absPath | null, useShell: boolean, error?: string }.
async function resolveJdkTool(name) {
  const path = require('path')
  const isWin = os.platform() === 'win32'
  const exe = isWin ? `${name}.exe` : name

  // 1. JAVA_HOME wins if it points at a real JDK.
  if (process.env.JAVA_HOME) {
    const p = path.join(process.env.JAVA_HOME, 'bin', exe)
    if (existsSync(p)) return { path: p, useShell: false }
  }

  // 2. Common install roots.
  const roots = isWin
    ? [
        'C:\\Program Files\\Java',
        'C:\\Program Files\\Eclipse Adoptium',
        'C:\\Program Files\\Eclipse Foundation',
        'C:\\Program Files\\Microsoft',
        'C:\\Program Files\\Zulu',
        'C:\\Program Files\\Amazon Corretto',
        'C:\\Program Files (x86)\\Java'
      ]
    : [
        '/usr/lib/jvm',
        '/opt/homebrew/opt/openjdk',
        '/opt/homebrew/opt',
        '/usr/local/opt/openjdk',
        '/opt/java',
        '/Library/Java/JavaVirtualMachines'
      ]

  for (const root of roots) {
    if (!existsSync(root)) continue
    try {
      const entries = await fsPromises.readdir(root)
      for (const entry of entries) {
        // Try <root>/<entry>/bin/<exe>
        let candidate = path.join(root, entry, 'bin', exe)
        if (existsSync(candidate)) return { path: candidate, useShell: false }
        // macOS bundles use <root>/<entry>/Contents/Home/bin/<exe>
        candidate = path.join(root, entry, 'Contents', 'Home', 'bin', exe)
        if (existsSync(candidate)) return { path: candidate, useShell: false }
      }
    } catch {}
  }

  // 3. Homebrew symlinked bin locations (macOS).
  const homebrewBins = [
    '/opt/homebrew/opt/openjdk/bin/' + name,
    '/opt/homebrew/bin/' + name,
    '/usr/local/opt/openjdk/bin/' + name,
    '/usr/local/bin/' + name
  ]
  for (const p of homebrewBins) {
    if (existsSync(p)) return { path: p, useShell: false }
  }

  // 4. PATH fallback via shell — the shell's own resolver often finds
  //    tools that Node's spawn can't when GUI-launched.
  return { path: name, useShell: true }
}

// Resolve the g++ / clang++ path. Prefer the compiler already saved
// by clangd's detection (so we don't ship a second detection path);
// fall back to the first auto-detected compiler; then to PATH.
async function resolveCppCompilerPath() {
  const configured = getCompilerPathsForLanguage('cpp')
  if (configured && existsSync(configured)) return configured

  const detected = await detectCppCompilers()
  if (detected.length > 0) {
    const isClang = detected[0].binDir.toLowerCase().includes('clang')
    const exe = isClang ? 'clang++' : 'g++'
    const suffix = os.platform() === 'win32' ? '.exe' : ''
    const candidate = require('path').join(detected[0].binDir, exe + suffix).replace(/\\/g, '/')
    if (existsSync(candidate)) return candidate
  }
  // Fall back to PATH — spawn will error if it's still missing.
  return os.platform() === 'win32' ? 'g++.exe' : 'g++'
}

// Spawn a compiler, resolve with { success, stderr } — bounded by
// DSA_COMPILE_TIMEOUT_MS. This is a separate wall-clock from the
// execution timeout so a slow compile doesn't shrink the trace window.
function runCompiler(cmd, args, cwd, useShell = false) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process')
    let stderrBuf = ''
    let stdoutBuf = ''
    let done = false

    const child = spawn(cmd, args, { cwd, windowsHide: true, shell: useShell })

    const finish = (result) => {
      if (done) return
      done = true
      try { child.kill('SIGKILL') } catch {}
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ success: false, stderr: stderrBuf + '\n[compilation timed out]' })
    }, DSA_COMPILE_TIMEOUT_MS)

    child.stdout.on('data', (c) => { stdoutBuf += c.toString('utf-8') })
    child.stderr.on('data', (c) => { stderrBuf += c.toString('utf-8') })
    child.on('error', (err) => {
      clearTimeout(timer)
      finish({ success: false, stderr: err.message })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      finish({ success: exitCode === 0, exitCode, stderr: stderrBuf, stdout: stdoutBuf })
    })
  })
}

// Spawn an instrumented binary / interpreter and capture the trace.
// Reused across all four languages — the only difference between
// them is what `cmd`/`args` point at.
function captureTrace(cmd, args, cwd, cleanupPaths, extraEnv, useShell = false) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process')
    const trace = []
    let truncated = false
    let stderrBuf = ''
    let stdoutBuf = ''
    let finalOutput = ''
    let finished = false

    const env = { ...process.env, ...(extraEnv || {}) }
    const child = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: useShell })

    const finish = (result) => {
      if (finished) return
      finished = true
      try { child.kill('SIGKILL') } catch {}
      for (const p of cleanupPaths) fsPromises.unlink(p).catch(() => {})
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({
        success: true, trace, truncated: true,
        stderr: stderrBuf, note: 'Execution timed out — partial trace returned'
      })
    }, DSA_EXEC_TIMEOUT_MS)

    const processLine = (line) => {
      if (!line) return
      if (line.startsWith('__DSA__')) {
        const jsonPart = line.slice(7)
        try {
          const snap = JSON.parse(jsonPart)
          if (trace.length < MAX_TRACE_FRAMES) {
            trace.push(snap)
          } else {
            truncated = true
            try { child.kill('SIGKILL') } catch {}
          }
        } catch {
          // Ignore malformed JSON snapshot lines
        }
      } else {
        finalOutput += line + '\n'
      }
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf-8')
      let idx
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx).replace(/\r$/, '')
        stdoutBuf = stdoutBuf.slice(idx + 1)
        processLine(line)
      }
    })

    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf-8')
      if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000)
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      finish({ success: false, error: err.message, trace })
    })

    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (stdoutBuf.length) processLine(stdoutBuf.trim())
      finish({ success: true, trace, truncated, exitCode, stderr: stderrBuf, stdout: finalOutput.trim() })
    })
  })
}

ipcMain.handle('run-instrumented-code', async (event, payload) => {
  const { language, code } = payload || {}
  if (!language || !code) {
    return { success: false, error: 'Missing language or code' }
  }
  const supported = ['javascript', 'python', 'cpp', 'java']
  if (!supported.includes(language)) {
    return { success: false, error: `Unsupported language: ${language}` }
  }

  // Reject overlapping runs from the same renderer webContents.
  const rendererId = event.sender.id
  if (dsaInFlight.has(rendererId)) {
    return { success: false, error: 'A DSA run is already in progress for this window.' }
  }
  dsaInFlight.add(rendererId)
  try {
    return await runInstrumentedCodeCore(language, code)
  } finally {
    dsaInFlight.delete(rendererId)
  }
})

async function runInstrumentedCodeCore(language, code) {

  const path = require('path')
  const crypto = require('crypto')
  const tmpDir = os.tmpdir()

  // ── Interpreted: JS / Python — write file, spawn, capture. ──
  if (language === 'javascript' || language === 'python') {
    const ext = language === 'javascript' ? 'js' : 'py'
    const scriptPath = path.join(tmpDir, `dsa-explainer-${crypto.randomBytes(6).toString('hex')}.${ext}`)

    try {
      await fsPromises.writeFile(scriptPath, code, 'utf-8')
    } catch (err) {
      return { success: false, error: 'Failed to write temp file: ' + err.message }
    }

    const cmd = language === 'javascript' ? process.execPath : 'python'
    const args = language === 'javascript' ? ['--no-warnings', scriptPath] : ['-u', scriptPath]
    const extraEnv = language === 'javascript' ? { ELECTRON_RUN_AS_NODE: '1' } : {}

    return captureTrace(cmd, args, tmpDir, [scriptPath], extraEnv)
  }

  // ── Compiled: C++ — compile with detected g++/clang++, run binary. ──
  if (language === 'cpp') {
    const suffix = crypto.randomBytes(6).toString('hex')
    const srcPath = path.join(tmpDir, `dsa-explainer-${suffix}.cpp`)
    const binName = `dsa-explainer-${suffix}${os.platform() === 'win32' ? '.exe' : ''}`
    const binPath = path.join(tmpDir, binName)

    try {
      await fsPromises.writeFile(srcPath, code, 'utf-8')
    } catch (err) {
      return { success: false, error: 'Failed to write temp file: ' + err.message }
    }

    const compilerPath = await resolveCppCompilerPath()
    const compileResult = await runCompiler(
      compilerPath,
      ['-std=c++17', '-O0', '-w', srcPath, '-o', binPath],
      tmpDir
    )

    if (!compileResult.success) {
      // Clean up source; there is no binary to clean up.
      fsPromises.unlink(srcPath).catch(() => {})
      return {
        success: false,
        error: 'C++ compilation failed',
        stage: 'compile',
        stderr: compileResult.stderr || '(no stderr)'
      }
    }

    return captureTrace(binPath, [], tmpDir, [srcPath, binPath], {})
  }

  // ── Compiled: Java — wrap with fixed class name, javac, java -cp. ──
  if (language === 'java') {
    // Java requires the public class name to match the source filename.
    // We always name the source DsaTrace.java + put it in a per-run dir
    // so multiple concurrent runs don't clobber each other's .class files.
    const runDir = path.join(tmpDir, `dsa-java-${crypto.randomBytes(6).toString('hex')}`)
    try {
      await fsPromises.mkdir(runDir, { recursive: true })
    } catch (err) {
      return { success: false, error: 'Failed to create tmp dir: ' + err.message }
    }
    const srcPath = path.join(runDir, `${JAVA_MAIN_CLASS}.java`)
    const classPath = path.join(runDir, `${JAVA_MAIN_CLASS}.class`)

    try {
      await fsPromises.writeFile(srcPath, code, 'utf-8')
    } catch (err) {
      return { success: false, error: 'Failed to write temp file: ' + err.message }
    }

    // Resolve javac/java robustly — see resolveJdkTool.
    const javacTool = await resolveJdkTool('javac')
    const compileResult = await runCompiler(javacTool.path, [srcPath], runDir, javacTool.useShell)

    // On failure OR success we always want the whole runDir cleaned up
    // at the end. Track everything we need to unlink; the runDir itself
    // is best-effort removed after captureTrace resolves.
    const cleanupAll = async () => {
      try {
        const files = await fsPromises.readdir(runDir).catch(() => [])
        await Promise.all(files.map(f => fsPromises.unlink(path.join(runDir, f)).catch(() => {})))
        await fsPromises.rmdir(runDir).catch(() => {})
      } catch {}
    }

    if (!compileResult.success) {
      await cleanupAll()
      // Map ENOENT / "not recognized" / "not found" → an actionable message
      // instead of a raw shell error. This is what the user sees.
      const stderr = compileResult.stderr || ''
      const missing = /ENOENT|is not recognized|command not found|No such file/i.test(stderr)
        || (compileResult.exitCode !== 0 && stderr.trim().length === 0)
      if (missing) {
        return {
          success: false,
          error: 'Java compiler (javac) not found',
          stage: 'compile',
          stderr: 'javac could not be located. Install a JDK (Adoptium Temurin, Zulu, or Oracle JDK) and either set the JAVA_HOME environment variable to the JDK install directory, or add the JDK bin folder to your PATH. Then restart the IDE.'
        }
      }
      return {
        success: false,
        error: 'Java compilation failed',
        stage: 'compile',
        stderr
      }
    }

    const javaTool = await resolveJdkTool('java')
    const traceResult = await captureTrace(javaTool.path, ['-cp', runDir, JAVA_MAIN_CLASS], runDir, [srcPath, classPath], {}, javaTool.useShell)
    await cleanupAll()
    return traceResult
  }

  return { success: false, error: `Unsupported language: ${language}` }
}

// ============================================================
// APP LIFECYCLE
// ============================================================

// Force chromium to render native UI (dropdowns, scrollbars) in dark mode
app.commandLine.appendSwitch('force-dark-mode')

// Handle single instance lock and deep linking
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      
      const url = commandLine.find(arg => arg.startsWith('comiple://'))
      if (url) {
        event.sender.send('auth-callback', url)
      }
    }
  })
  
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow) {
      event.sender.send('auth-callback', url)
    }
  })

  // Register the protocol
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('comiple', process.execPath, [require('path').resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('comiple')
  }

  // ---- Debug Adapter Protocol (DAP) Manager ----
const dapManager = new DapManager()

dapManager.on('dap-paused', (body) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send('dap-paused', body)
})
dapManager.on('dap-output', (output) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send('dap-output', output)
})
dapManager.on('dap-error', (error) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send('dap-error', error)
})
dapManager.on('dap-exit', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send('dap-exit')
})

ipcMain.handle('dap-start', async (event, filePath, language, breakpoints) => {
  try {
    console.log('[DAP] Starting debug session...', { filePath, language, breakpoints })
    await dapManager.start(filePath, language, breakpoints)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})
ipcMain.handle('dap-stop', async () => {
  dapManager.stop()
  return true
})
ipcMain.handle('dap-step', async () => {
  try { await dapManager.sendRequest('next'); return true } catch(e) { return false }
})
ipcMain.handle('dap-step-in', async () => {
  try { await dapManager.sendRequest('stepIn'); return true } catch(e) { return false }
})
ipcMain.handle('dap-step-out', async () => {
  try { await dapManager.sendRequest('stepOut'); return true } catch(e) { return false }
})
ipcMain.handle('dap-continue', async () => {
  try { await dapManager.sendRequest('continue'); return true } catch(e) { return false }
})
ipcMain.handle('dap-evaluate', async (event, expression) => {
  try {
    const res = await dapManager.sendRequest('evaluate', { expression })
    return res.result
  } catch (err) {
    return 'error'
  }
})
ipcMain.handle('dap-get-variables', async () => {
  try {
    const res = await dapManager.sendRequest('variables')
    return res.variables || []
  } catch(e) {
    return []
  }
})

ipcMain.handle('toggle-dev-tools', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (win) {
    win.webContents.toggleDevTools()
  }
})

app.whenReady().then(() => {
    // Set app user model id for Windows
    electronApp.setAppUserModelId('com.compile.editor')

    // ── Application menu ──────────────────────────────────────
    // Without this template, Ctrl+V / Ctrl+C / Ctrl+X / Ctrl+A
    // have NO accelerators registered anywhere in the app —
    // Chromium relies on the Electron menu's role: 'paste' etc.
    // to wire them up. autoHideMenuBar:true on the BrowserWindow
    // keeps this menu bar visually hidden; the accelerators still
    // work. Roles include: undo, redo, cut, copy, paste, selectAll.
    // This is a real fix for a real bug — do NOT delete this.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' }
        ]
      }
    ]))

    // Default open or close DevTools by F12 in dev, ignore in production
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    if (process.env.TEMP_TEST === '1') {
      setTimeout(async () => {
        const { openDoc } = await import('./lsp-manager.js')
        const path = require('path')
        const absPath = path.join(process.cwd(), 'dev-fixtures', 'broken.py')
        openDoc(absPath, 'print(naem)', 'python')
      }, 5000)
    }
  })
}

// ============================================================
// AUTH TOKEN STORAGE (Secure)
// ============================================================
ipcMain.handle('save-auth-token', async (_event, key, value) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: 'Encryption not available' }
    }
    const encrypted = safeStorage.encryptString(value)
    const filePath = join(app.getPath('userData'), `.compile-${key}`)
    writeFileSync(filePath, encrypted)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('get-auth-token', async (_event, key) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: 'Encryption not available' }
    }
    const filePath = join(app.getPath('userData'), `.compile-${key}`)
    if (existsSync(filePath)) {
      const encrypted = readFileSync(filePath)
      const decrypted = safeStorage.decryptString(encrypted)
      return { success: true, value: decrypted }
    }
    return { success: true, value: null }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('delete-auth-token', async (_event, key) => {
  try {
    const filePath = join(app.getPath('userData'), `.compile-${key}`)
    if (existsSync(filePath)) {
      const { unlinkSync } = require('fs')
      unlinkSync(filePath)
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

app.on('window-all-closed', () => {
  terminalManager.killAll()
  // ── Security: Clear all decrypted keys from memory ──
  for (const key of Object.keys(apiKeyCache)) {
    apiKeyCache[key] = '' // overwrite the string reference
    delete apiKeyCache[key]
  }
  apiKeyCache = {}
  console.log('API key cache cleared from memory')

  if (process.platform !== 'darwin') {
    app.quit()
  }
})
