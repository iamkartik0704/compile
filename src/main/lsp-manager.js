import { spawn, execSync } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'

/**
 * LSP Manager — Handles language server detection, spawning, and management
 * Coordinates between the Electron main process and language servers via stdio
 */

// Store active LSP processes
const lspProcesses = new Map() // language → { process, buffer, status }
// Status enum: 'idle', 'installing', 'starting', 'ready', 'crashed'

/**
 * Check if a command exists in PATH
 */
export function commandExists(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Find a binary in PATH or common installation locations
 */
export function findBinary(name) {
  // Check PATH first
  if (commandExists(name)) return name

  // Windows-specific locations
  if (process.platform === 'win32') {
    const candidates = [
      join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', `${name}.exe`),
      join('C:', 'Program Files', 'LLVM', 'bin', `${name}.exe`),
      join(homedir(), 'AppData', 'Local', 'Programs', 'LLVM', 'bin', `${name}.exe`),
      join(homedir(), '.cargo', 'bin', `${name}.exe`),
      join(homedir(), 'go', 'bin', `${name}.exe`),
      join(homedir(), '.dotnet', 'tools', `${name}.exe`),
    ]
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
  }

  // macOS/Linux locations
  const unixCandidates = [
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    join(homedir(), '.cargo', 'bin', name),
    join(homedir(), '.local', 'bin', name),
  ]
  for (const p of unixCandidates) {
    if (existsSync(p)) return p
  }

  return null
}

/**
 * Get LSP command for a language
 * Returns [command, args] or null if not available
 */
export function getLspCommand(language) {
  switch (language) {
    case 'python': {
      const serverPath = join(process.cwd(), 'node_modules', 'pyright', 'langserver.index.js')
      if (existsSync(serverPath)) return ['node', [serverPath, '--stdio']]
      if (commandExists('pylsp')) return ['pylsp', []]
      return null
    }

    case 'c':
    case 'cpp': {
      const clangd = findBinary('clangd')
      return clangd ? [clangd, ['--log=error']] : null
    }

    case 'go': {
      const gopls = findBinary('gopls')
      return gopls ? [gopls, ['serve']] : null
    }

    case 'rust': {
      const ra = findBinary('rust-analyzer')
      return ra ? [ra, []] : null
    }

    case 'typescript':
    case 'javascript': {
      const tsLsPath = join(process.cwd(), 'node_modules', 'typescript-language-server', 'lib', 'cli.js')
      if (existsSync(tsLsPath)) return ['node', [tsLsPath, '--stdio']]
      if (commandExists('typescript-language-server')) {
        return ['typescript-language-server', ['--stdio']]
      }
      return null
    }

    case 'shell':
    case 'bash': {
      return commandExists('bash-language-server') ? ['bash-language-server', ['start']] : null
    }

    case 'java': {
      const jdtls = findBinary('jdtls')
      return jdtls ? [jdtls, []] : null
    }

    case 'csharp':
    case 'cs': {
      const omnisharp = findBinary('omnisharp')
      return omnisharp ? [omnisharp, ['--loglevel', 'error']] : null
    }

    default:
      return null
  }
}

/**
 * Metadata for all supported languages and their requirements
 */
export const LANGUAGE_METADATA = {
  python: {
    name: 'Python',
    lspServer: 'Pyright (bundled)',
    installUrl: 'https://www.python.org',
    setupInstructions: 'Already bundled with the IDE'
  },
  cpp: {
    name: 'C++',
    lspServer: 'clangd',
    installUrl: 'https://releases.llvm.org/',
    setupInstructions: 'Install LLVM: winget install LLVM.LLVM (Windows) or brew install llvm (macOS)'
  },
  c: {
    name: 'C',
    lspServer: 'clangd',
    installUrl: 'https://releases.llvm.org/',
    setupInstructions: 'Install LLVM: winget install LLVM.LLVM (Windows) or brew install llvm (macOS)'
  },
  go: {
    name: 'Go',
    lspServer: 'gopls',
    installUrl: 'https://github.com/golang/tools/tree/master/gopls',
    setupInstructions: 'go install github.com/golang/tools/gopls@latest'
  },
  rust: {
    name: 'Rust',
    lspServer: 'rust-analyzer',
    installUrl: 'https://rust-analyzer.github.io/',
    setupInstructions: 'rustup component add rust-analyzer'
  },
  typescript: {
    name: 'TypeScript',
    lspServer: 'typescript-language-server',
    installUrl: 'https://www.npmjs.com/package/typescript-language-server',
    setupInstructions: 'npm install -g typescript-language-server typescript'
  },
  javascript: {
    name: 'JavaScript',
    lspServer: 'typescript-language-server',
    installUrl: 'https://www.npmjs.com/package/typescript-language-server',
    setupInstructions: 'npm install -g typescript-language-server typescript'
  },
  bash: {
    name: 'Bash',
    lspServer: 'bash-language-server',
    installUrl: 'https://www.npmjs.com/package/bash-language-server',
    setupInstructions: 'npm install -g bash-language-server'
  },
  java: {
    name: 'Java',
    lspServer: 'Eclipse JDTLS',
    installUrl: 'https://github.com/eclipse-jdtls/eclipse.jdt.ls/wiki',
    setupInstructions: 'Download JDTLS from https://github.com/eclipse-jdtls/eclipse.jdt.ls/releases'
  },
  csharp: {
    name: 'C#',
    lspServer: 'OmniSharp',
    installUrl: 'https://github.com/OmniSharp/omnisharp-roslyn',
    setupInstructions: 'dotnet tool install -g omnisharp'
  }
}

/**
 * Start a language server process and bridge stdio
 */
export function startLanguageServer(language, onMessage, onError, onStatusChange) {
  // If already running, return existing process
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
    }
  }

  const cmdInfo = getLspCommand(language)
  if (!cmdInfo) {
    const metadata = LANGUAGE_METADATA[language]
    return {
      success: false,
      error: `No language server available for "${language}"`,
      metadata: metadata,
      suggestion: metadata ? `Install: ${metadata.setupInstructions}` : null
    }
  }

  const [cmd, args] = cmdInfo
  console.log(`[LSP] Starting ${language}: ${cmd} ${args.join(' ')}`)

  try {
    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    })

    const entry = { process: child, buffer: '', status: 'starting' }
    lspProcesses.set(language, entry)
    if (onStatusChange) onStatusChange('starting')

    // Handle stdout (messages from LSP server)
    child.stdout.on('data', (data) => {
      entry.buffer += data.toString()
      parseAndForwardMessages(language, entry, onMessage, setStatus)
    })

    // Handle stderr
    child.stderr.on('data', (data) => {
      const msg = data.toString()
      console.error(`[LSP ${language}] stderr:`, msg)
      if (onError) onError(msg)
    })

    // Handle process exit
    child.on('exit', (code) => {
      console.log(`[LSP ${language}] exited with code ${code}`)
      setStatus('idle')
      lspProcesses.delete(language)
    })

    // Handle process error
    child.on('error', (err) => {
      console.error(`[LSP ${language}] error:`, err)
      setStatus('crashed')
      lspProcesses.delete(language)
      if (onError) onError(err.message)
    })

    return { success: true }
  } catch (err) {
    console.error(`[LSP] Failed to start ${language}:`, err)
    return { success: false, error: err.message }
  }
}

/**
 * Parse LSP messages from buffer and forward them
 * LSP uses Content-Length header format
 */
function parseAndForwardMessages(language, entry, onMessage, setStatus) {
  while (true) {
    const headerMatch = entry.buffer.match(/Content-Length: (\d+)\r\n\r\n/i)
    if (!headerMatch) break

    const contentLength = parseInt(headerMatch[1], 10)
    const headerLength = headerMatch[0].length

    if (entry.buffer.length >= headerLength + contentLength) {
      const message = entry.buffer.slice(headerLength, headerLength + contentLength)
      entry.buffer = entry.buffer.slice(headerLength + contentLength)

      try {
        const parsed = JSON.parse(message)
        
        // Transition to ready if we receive a response to initialize
        if (parsed.id !== undefined && parsed.result && parsed.result.capabilities) {
          if (entry.status !== 'ready') setStatus('ready')
        }
        
        if (onMessage) onMessage(language, JSON.stringify(parsed))
      } catch (err) {
        console.error(`[LSP ${language}] failed to parse message:`, err)
      }
    } else {
      break
    }
  }
}

/**
 * Send a message to a language server
 */
export function sendToLanguageServer(language, message) {
  const entry = lspProcesses.get(language)
  if (!entry || !entry.process || !entry.process.stdin) {
    console.warn(`[LSP ${language}] process not found`)
    return false
  }

  const contentLength = Buffer.byteLength(message, 'utf-8')
  const header = `Content-Length: ${contentLength}\r\n\r\n`

  try {
    entry.process.stdin.write(header + message)
    return true
  } catch (err) {
    console.error(`[LSP ${language}] failed to send message:`, err)
    return false
  }
}

/**
 * Get the current status of an LSP
 */
export function getLanguageServerStatusForLanguage(language) {
  const entry = lspProcesses.get(language)
  return entry ? entry.status : 'idle'
}

/**
 * Stop a language server
 */
export function stopLanguageServer(language) {
  const entry = lspProcesses.get(language)
  if (!entry) return

  try {
    entry.process.kill()
  } catch (err) {
    console.error(`[LSP ${language}] failed to kill process:`, err)
  }

  lspProcesses.delete(language)
}

/**
 * Get status of all language servers
 */
export function getLanguageServerStatus() {
  const status = {}
  for (const [lang, meta] of Object.entries(LANGUAGE_METADATA)) {
    const isRunning = lspProcesses.has(lang)
    const available = getLspCommand(lang) !== null
    status[lang] = {
      name: meta.name,
      available,
      running: isRunning,
      lspServer: meta.lspServer
    }
  }
  return status
}

/**
 * Stop all language servers (cleanup on app exit)
 */
export function stopAllLanguageServers() {
  for (const lang of lspProcesses.keys()) {
    stopLanguageServer(lang)
  }
}
