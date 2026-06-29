import { app, shell, BrowserWindow, ipcMain, safeStorage, dialog, nativeTheme } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, chmodSync, promises as fsPromises } from 'fs'
import { exec as execCallback } from 'child_process'
import { promisify } from 'util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { terminalManager } from './terminal-manager.js'
import { startLanguageServer, sendToLanguageServer, getLanguageServerStatusForLanguage, LANGUAGE_METADATA } from './lsp-manager.js'

const exec = promisify(execCallback)

let currentWatcher = null

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

  // --- FILE EXPLORER HANDLERS ---
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

  ipcMain.handle('watch-project', async (event, rootPath) => {
    if (currentWatcher) {
      await currentWatcher.close()
    }
    
    if (!rootPath) return

    const { default: chokidar } = await import('chokidar')

    currentWatcher = chokidar.watch(rootPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      depth: 10
    })

    currentWatcher.on('all', (eventName, path) => {
      // Forward add, unlink, change events to frontend
      if (['add', 'unlink', 'addDir', 'unlinkDir'].includes(eventName)) {
        event.sender.send('fs-changed', { event: eventName, path })
      }
    })
  })

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

  // ── Window control IPC (for custom title bar) ──
  ipcMain.handle('window-minimize', () => mainWindow.minimize())
  ipcMain.handle('window-maximize-toggle', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle('window-close', () => mainWindow.close())
  ipcMain.handle('window-is-maximized', () => mainWindow.isMaximized())
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized-changed', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized-changed', false))

  // Force dark theme so native inputs (like <select> dropdown popups) render correctly
  nativeTheme.themeSource = 'dark'

  // Prevent white flash — show only when fully rendered
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  terminalManager.init(mainWindow)

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
  // IPC HANDLERS — The Backend Logic
  // ============================================================

  /**
   * Handler: File Read
   */
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


  ipcMain.handle('start-lsp', async (event, language) => {
    return startLanguageServer(
      language,
      // onMessage
      (lang, message) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lsp-server-message', { language: lang, message })
        }
      },
      // onError
      (err) => {
        console.error(`LSP Manager Error: ${err}`)
      },
      // onStatusChange
      (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lsp-status-change', { language, status })
        }
      }
    )
  })

  // List which language servers are available
  ipcMain.handle('list-available-lsp', async () => {
    const available = {}
    for (const [lang, meta] of Object.entries(LANGUAGE_METADATA)) {
      available[lang] = true // Simplified for now since we rely on lsp-manager
    }
    return available
  })

  ipcMain.on('lsp-client-message', (event, { language, message }) => {
    sendToLanguageServer(language, message)
  })

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
    mainWindow.webContents.send('ai-model-resolved', model)
    console.log(`Routing to provider: ${model}`)

    // Route to provider (async streaming)
    try {
      await routeToProvider(model, prompt, mainWindow.webContents, config)
      mainWindow.webContents.send('ai-stream-chunk', '\n')
      return { status: 'done', model }
    } catch (err) {
      console.error('Provider error:', err)
      mainWindow.webContents.send('ai-stream-chunk', `\n// ❌ Error: ${err.message}`)
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
      await routeToProvider(model, prompt, mainWindow.webContents, { ...config, emitEvent: 'inline-ai-stream-chunk' })
      return { status: 'done', model }
    } catch (err) {
      console.error('Provider error:', err)
      mainWindow.webContents.send('inline-ai-stream-chunk', `\n// ❌ Error: ${err.message}`)
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
      await routeToProvider(model, prompt, mainWindow.webContents, { ...config, emitEvent: 'ai-debugger-stream' })
      return { success: true }
    } catch (err) {
      console.error('Provider error:', err)
      mainWindow.webContents.send('ai-debugger-stream', `\n// ❌ Error: ${err.message}`)
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
        liveServerProcess = null
      })
    })
  })

  ipcMain.handle('stop-live-server', async () => {
    if (liveServerProcess) {
      liveServerProcess.kill()
      liveServerProcess = null
    }
    return { success: true }
  })
}

// ============================================================
// APP LIFECYCLE
// ============================================================

// Force chromium to render native UI (dropdowns, scrollbars) in dark mode
app.commandLine.appendSwitch('force-dark-mode')

app.whenReady().then(() => {
  // Set app user model id for Windows
  electronApp.setAppUserModelId('com.compile.editor')

  // Default open or close DevTools by F12 in dev, ignore in production
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
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
