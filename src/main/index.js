import { app, shell, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, chmodSync, promises as fsPromises } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

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
const VALID_PROVIDERS = ['openai', 'anthropic', 'google', 'deepseek', 'qwen', 'meta', 'oss']

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
  return isComplex ? 'claude-opus' : 'gemini-flash'
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
    tokens: ['// Llama 4 🔓 Open Source (Simulated — no hosted API)\n', 'import ', 'torch\n', 'from ', 'transformers ', 'import ', 'AutoModelForCausalLM\n\n', 'model ', '= AutoModelForCausalLM.', 'from_pretrained(\n', '  "meta-llama/Llama-4"\n', ')\n', 'output = ', 'model.generate(', 'input_ids, ', 'max_length=512', ')'],
    delay: [90, 40, 30, 30, 50, 30, 60, 20, 40, 60, 50, 50, 30, 40, 50, 40, 50, 30]
  }
}

// ============================================================
// REAL API STREAMING FUNCTIONS
// ============================================================

/**
 * Stream from Anthropic (Claude Sonnet, Claude Opus)
 */
async function streamAnthropic(apiModel, prompt, sender) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: apiKeyCache['anthropic'] })

  const stream = client.messages.stream({
    model: apiModel,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  })

  stream.on('text', (text) => {
    sender.send('ai-stream-chunk', text)
  })

  // Wait for stream to complete
  await stream.finalMessage()
}

/**
 * Stream from Google Gemini (Gemini Flash, Gemini Pro)
 */
async function streamGemini(apiModel, prompt, sender) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(apiKeyCache['google'])
  const model = genAI.getGenerativeModel({ model: apiModel })

  const result = await model.generateContentStream(prompt)

  for await (const chunk of result.stream) {
    const text = chunk.text()
    if (text) {
      sender.send('ai-stream-chunk', text)
    }
  }
}

/**
 * Stream from OpenAI-compatible APIs (OpenAI, DeepSeek, Qwen)
 * These providers expose OpenAI-compatible endpoints.
 */
async function streamOpenAICompatible(apiModel, prompt, sender, baseURL, provider) {
  const OpenAI = (await import('openai')).default
  const client = new OpenAI({
    apiKey: apiKeyCache[provider],
    baseURL: baseURL || undefined
  })

  const stream = await client.chat.completions.create({
    model: apiModel,
    stream: true,
    messages: [{ role: 'user', content: prompt }]
  })

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content
    if (text) {
      sender.send('ai-stream-chunk', text)
    }
  }
}

/**
 * Simulation fallback for models without hosted APIs
 */
async function streamSimulation(modelId, sender) {
  const config = SIMULATION_RESPONSES[modelId]
  if (!config) {
    sender.send('ai-stream-chunk', `// No simulation available for model: ${modelId}\n`)
    return
  }

  for (let i = 0; i < config.tokens.length; i++) {
    await new Promise((r) => setTimeout(r, config.delay[i] || 80))
    sender.send('ai-stream-chunk', config.tokens[i])
  }
}

// ============================================================
// MAIN PROVIDER ROUTER — Real API calls
// ============================================================
async function routeToProvider(modelId, prompt, sender) {
  const config = MODEL_CONFIG[modelId]
  if (!config) {
    sender.send('ai-stream-chunk', `// Unknown model: ${modelId}\n`)
    return
  }

  // Simulation-only models (no hosted API)
  if (config.type === 'simulation') {
    sender.send('ai-stream-chunk', `// ℹ️ ${modelId} uses local/self-hosted inference.\n// This is a simulated response.\n\n`)
    await streamSimulation(modelId, sender)
    return
  }

  // Check if API key exists for this provider
  const apiKey = apiKeyCache[config.provider]
  if (!apiKey) {
    sender.send(
      'ai-stream-chunk',
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
        await streamAnthropic(config.apiModel, prompt, sender)
        break
      case 'gemini':
        await streamGemini(config.apiModel, prompt, sender)
        break
      case 'openai-compatible':
        await streamOpenAICompatible(config.apiModel, prompt, sender, config.baseURL, config.provider)
        break
      default:
        sender.send('ai-stream-chunk', `// Unknown provider type: ${config.type}\n`)
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

    sender.send('ai-stream-chunk', `\n// ❌ Error: ${userFriendlyError}\n`)
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

  // --- EXISTING HANDLERS ---
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0c0c14',
    titleBarStyle: 'hiddenInset',
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

  // Prevent white flash — show only when fully rendered
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

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
  const { spawn, execSync } = require('child_process')
  const lspProcesses = new Map() // language → { process, buffer }

  // Detects whether a command exists on the system PATH
  function commandExists(cmd) {
    try {
      execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' })
      return true
    } catch { return false }
  }

  // Finds the full path of a binary, checking PATH and common install locations
  const { existsSync } = require('fs')
  const homedir = require('os').homedir()

  function findBinary(name) {
    // 1. Check PATH first
    if (commandExists(name)) return name

    // 2. Check common Windows install locations
    if (process.platform === 'win32') {
      const candidates = [
        join(homedir, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', `${name}.exe`),
        join(homedir, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', '**', `${name}.exe`),
        join('C:', 'Program Files', 'LLVM', 'bin', `${name}.exe`),
        join(homedir, 'AppData', 'Local', 'Programs', 'LLVM', 'bin', `${name}.exe`),
        join(homedir, 'AppData', 'Local', 'JetBrains', 'Fleet', 'language_server', 'jbclangd', `${name}.exe`),
        join(homedir, '.cargo', 'bin', `${name}.exe`),
        join(homedir, 'go', 'bin', `${name}.exe`),
      ]
      for (const p of candidates) {
        if (existsSync(p)) return p
      }
    }

    return null
  }

  // Returns [command, args] for a given language, or null if unavailable
  function getLspCommand(language) {
    switch (language) {
      case 'python': {
        const serverPath = join(process.cwd(), 'node_modules', 'pyright', 'langserver.index.js')
        return ['node', [serverPath, '--stdio']]
      }
      case 'c':
      case 'cpp': {
        const clangd = findBinary('clangd')
        if (clangd) return [clangd, ['--log=error']]
        return null
      }
      case 'go': {
        const gopls = findBinary('gopls')
        if (gopls) return [gopls, ['serve']]
        return null
      }
      case 'rust': {
        const ra = findBinary('rust-analyzer')
        if (ra) return [ra, []]
        return null
      }
      case 'shell':
      case 'bash':
        if (commandExists('bash-language-server')) return ['bash-language-server', ['start']]
        return null
      default:
        return null
    }
  }

  // Helper: create stdio bridge for an LSP child process
  function bridgeLspProcess(language, childProcess) {
    const entry = { process: childProcess, buffer: '' }
    lspProcesses.set(language, entry)

    childProcess.stdout.on('data', (data) => {
      entry.buffer += data.toString()

      while (true) {
        const match = entry.buffer.match(/Content-Length: (\d+)\r\n\r\n/i)
        if (!match) break

        const contentLength = parseInt(match[1], 10)
        const headerLength = match[0].length

        if (entry.buffer.length >= headerLength + contentLength) {
          const message = entry.buffer.slice(headerLength, headerLength + contentLength)
          entry.buffer = entry.buffer.slice(headerLength + contentLength)

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('lsp-server-message', { language, message })
          }
        } else {
          break
        }
      }
    })

    childProcess.stderr.on('data', (data) => {
      console.error(`LSP [${language}] stderr: ${data}`)
    })

    childProcess.on('exit', (code) => {
      console.log(`LSP [${language}] exited with code ${code}`)
      lspProcesses.delete(language)
    })
  }

  ipcMain.handle('start-lsp', async (event, language) => {
    // If already running for this language, reuse it
    if (lspProcesses.has(language)) {
      return { success: true, alreadyRunning: true }
    }

    const cmdInfo = getLspCommand(language)
    if (!cmdInfo) {
      return { success: false, error: `No language server available for "${language}"` }
    }

    const [cmd, args] = cmdInfo
    console.log(`Starting LSP for ${language}: ${cmd} ${args.join(' ')}`)

    try {
      const child = spawn(cmd, args)
      bridgeLspProcess(language, child)
      return { success: true }
    } catch (err) {
      console.error(`Failed to spawn LSP [${language}]:`, err)
      return { success: false, error: err.message }
    }
  })

  // List which language servers are available
  ipcMain.handle('list-available-lsp', async () => {
    const languages = ['python', 'c', 'cpp', 'go', 'rust', 'shell']
    const available = {}
    for (const lang of languages) {
      available[lang] = getLspCommand(lang) !== null
    }
    return available
  })

  ipcMain.on('lsp-client-message', (event, { language, message }) => {
    const entry = lspProcesses.get(language)
    if (entry && entry.process && entry.process.stdin) {
      const contentLength = Buffer.byteLength(message, 'utf-8')
      const header = `Content-Length: ${contentLength}\r\n\r\n`
      entry.process.stdin.write(header + message)
    }
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
    routeToProvider(model, prompt, mainWindow.webContents)
      .then(() => {
        mainWindow.webContents.send('ai-stream-chunk', '\n')
      })
      .catch((err) => {
        console.error('Provider error:', err)
        mainWindow.webContents.send('ai-stream-chunk', `\n// ❌ Error: ${err.message}`)
      })

    return { status: 'streaming', model }
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
}

// ============================================================
// APP LIFECYCLE
// ============================================================
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
