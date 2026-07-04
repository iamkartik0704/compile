import { useDiagnosticsStore, lspSeverityToString } from '../store/diagnosticsStore'

// ─────────────────────────────────────────────────────────────
// WorkspaceDiagnosticsScanner
//
// The IDE's LSP clients only publish diagnostics for files that
// have been through `textDocument/didOpen`.  Historically that
// only happened when the user clicked a file in the sidebar,
// which meant `Sidebar.jsx` and the tab strip could never show
// error counts for files the user hadn't looked at yet.
//
// This scanner walks the project tree, groups files by language,
// spins up the correct LSP for each group, and issues silent
// `didOpen` notifications so that publishDiagnostics fires for
// every file.  The diagnostics land in `diagnosticsStore` and
// the sidebar/tabs then render badges from there — no editor
// interaction required.
//
// The scanner is intentionally decoupled from `CodeEditor.jsx`
// so it can run before any editor mounts.  It uses a lightweight
// direct IPC LSP client rather than Monaco so we don't need to
// create hidden models for every workspace file.
// ─────────────────────────────────────────────────────────────

const EXT_TO_LSP = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', pyw: 'python', pyi: 'python',
  c: 'c',
  h: 'c', // matches CodeEditor.jsx's language detection.
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp', 'c++': 'cpp',
  go: 'go',
  rs: 'rust',
  java: 'java'
}

const LANG_ID_FOR_LSP = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  c: 'c',
  cpp: 'cpp',
  go: 'go',
  rust: 'rust',
  java: 'java'
}

const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
  '.cache', '.next', '.nuxt', '.turbo', '.pnpm-store', 'coverage',
  '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode'
])

// Guardrails so the scanner never eats the LSP alive on huge repos.
const MAX_FILES_PER_LANGUAGE = 400
const MAX_FILE_BYTES = 512 * 1024 // 512 KB
const DID_OPEN_BATCH_SIZE = 6
const DID_OPEN_DELAY_MS = 40

const pathToUri = (p) => {
  if (!p) return ''
  let formatted = p.replace(/\\/g, '/')
  if (!formatted.startsWith('/')) formatted = '/' + formatted
  formatted = formatted.replace(/^\/([A-Z]):\//, (_, drive) => `/${drive.toLowerCase()}:/`)
  return `file://${formatted}`
}

const extOf = (p) => {
  const idx = p.lastIndexOf('.')
  if (idx === -1) return ''
  return p.slice(idx + 1).toLowerCase()
}

const groupFilesByLsp = (files) => {
  const groups = {}
  for (const f of files) {
    const ext = extOf(f)
    const lsp = EXT_TO_LSP[ext]
    if (!lsp) continue
    if (SKIP_DIR_NAMES.has(f)) continue
    if (!groups[lsp]) groups[lsp] = []
    if (groups[lsp].length >= MAX_FILES_PER_LANGUAGE) continue
    groups[lsp].push(f)
  }
  return groups
}

const shouldSkipPath = (p) => {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts.some((seg) => SKIP_DIR_NAMES.has(seg))
}

// Track active scans so we can cancel when the user switches
// project roots mid-scan.
let currentScanToken = 0
const activeMessageHandlers = new Map() // lspKey → handler

/**
 * Root entry point — start a fresh workspace scan.
 */
export async function scanWorkspaceForDiagnostics(projectRoot, { onProgress } = {}) {
  if (!projectRoot || !window.api?.getProjectTree) return

  const token = ++currentScanToken
  const isStale = () => token !== currentScanToken

  useDiagnosticsStore.getState().clearAll()

  const allFiles = await window.api.getProjectTree(projectRoot)
  if (isStale() || !Array.isArray(allFiles)) return

  const filtered = allFiles.filter((f) => !shouldSkipPath(f))
  const groups = groupFilesByLsp(filtered)

  const langs = Object.keys(groups)
  if (langs.length === 0) return

  // Install the shared LSP message dispatcher exactly once —
  // multiple sinks can now register for the same channel.
  installSharedLspDispatcher()

  const rootUri = pathToUri(projectRoot)

  let processed = 0
  const total = langs.reduce((a, k) => a + groups[k].length, 0)

  for (const lspKey of langs) {
    if (isStale()) return

    const files = groups[lspKey]
    if (files.length === 0) continue

    // Kick the LSP off — no-op if it's already up.
    const startRes = await window.api.startLanguageServer(lspKey)
    if (!startRes?.success) {
      console.warn(`[Scanner] LSP ${lspKey} unavailable, skipping ${files.length} files`)
      continue
    }

    // Wire this LSP's diagnostics into the shared store.
    registerLspSink(lspKey)

    // Ensure the compilation DB knows about every C/C++ file
    // BEFORE we send didOpen — otherwise clangd will diagnose
    // the file with default flags and cache the wrong answer.
    if (lspKey === 'c' || lspKey === 'cpp') {
      for (const f of files) {
        if (isStale()) return
        try {
          await window.api.ensureCompilationDb({ filepath: f, workspaceRoot: projectRoot })
        } catch (e) {
          console.warn(`[Scanner] ensureCompilationDb failed for ${f}:`, e?.message)
        }
      }
    }

    // Perform a bare-bones initialize once per language.
    await initializeLsp(lspKey, rootUri)
    if (isStale()) return

    // didOpen every file in small batches with a tiny delay so
    // the LSP has time to breathe on multi-hundred-file repos.
    for (let i = 0; i < files.length; i += DID_OPEN_BATCH_SIZE) {
      if (isStale()) return
      const batch = files.slice(i, i + DID_OPEN_BATCH_SIZE)
      await Promise.all(batch.map(async (f) => {
        try {
          const res = await window.api.getFileContents(f)
          if (!res?.success || typeof res.content !== 'string') return
          if (res.content.length > MAX_FILE_BYTES) return
          sendLspNotification(lspKey, 'textDocument/didOpen', {
            textDocument: {
              uri: pathToUri(f),
              languageId: LANG_ID_FOR_LSP[lspKey] || lspKey,
              version: 1,
              text: res.content
            }
          })
        } catch (e) {
          // Best-effort — one file blowing up shouldn't kill the sweep.
        }
      }))
      processed += batch.length
      onProgress?.({ processed, total })
      await sleep(DID_OPEN_DELAY_MS)
    }
  }
}

// ─── Direct-IPC LSP helpers ─────────────────────────────────

const initializedLspKeys = new Set()

async function initializeLsp(lspKey, rootUri) {
  if (initializedLspKeys.has(lspKey)) return
  initializedLspKeys.add(lspKey)

  const id = Date.now() % 1_000_000
  sendLspRequest(lspKey, id, 'initialize', {
    processId: null,
    rootUri,
    capabilities: {
      textDocument: {
        publishDiagnostics: { relatedInformation: true },
        synchronization: { didSave: true }
      },
      workspace: {}
    },
    initializationOptions: {}
  })
  // We don't need the initialize result to fire didOpen — clangd,
  // pyright and typescript-language-server all queue notifications.
  sendLspNotification(lspKey, 'initialized', {})
}

const sendLspRequest = (lspKey, id, method, params) => {
  window.api.sendLspMessage(lspKey, JSON.stringify({ jsonrpc: '2.0', id, method, params }))
}

const sendLspNotification = (lspKey, method, params) => {
  window.api.sendLspMessage(lspKey, JSON.stringify({ jsonrpc: '2.0', method, params }))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─── Shared dispatcher ───────────────────────────────────────
// CodeEditor already calls `window.api.onLspMessage`; we can't
// just call it again because it does `removeAllListeners` first.
// Instead we register once here and expose an internal fan-out
// that CodeEditor also plugs into via `subscribeToLspMessages`.

const sinks = new Map() // lspKey → Set<handler>
let dispatcherInstalled = false

export function installSharedLspDispatcher() {
  if (dispatcherInstalled) return
  dispatcherInstalled = true

  window.api.onLspMessage((language, raw) => {
    const set = sinks.get(language)
    if (!set || set.size === 0) return
    for (const fn of set) {
      try { fn(raw) } catch (e) { console.error('[LSP sink]', e) }
    }
  })
}

export function subscribeToLspMessages(lspKey, handler) {
  if (!sinks.has(lspKey)) sinks.set(lspKey, new Set())
  sinks.get(lspKey).add(handler)
  return () => sinks.get(lspKey)?.delete(handler)
}

function registerLspSink(lspKey) {
  if (activeMessageHandlers.has(lspKey)) return
  const handler = (raw) => {
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (msg.method !== 'textDocument/publishDiagnostics') return
      const { uri, diagnostics } = msg.params || {}
      if (!uri) return
      const normalized = (diagnostics || []).map((d) => ({
        severity: lspSeverityToString(d.severity),
        message: d.message,
        line: (d.range?.start?.line ?? 0) + 1,
        column: (d.range?.start?.character ?? 0) + 1,
        source: d.source || lspKey
      }))
      useDiagnosticsStore.getState().setDiagnostics(uri, `lsp-${lspKey}`, normalized)
    } catch (e) {
      console.error('[Scanner] failed to parse diagnostics:', e)
    }
  }
  const unsubscribe = subscribeToLspMessages(lspKey, handler)
  activeMessageHandlers.set(lspKey, unsubscribe)
}
