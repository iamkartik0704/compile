import { create } from 'zustand'

// ─────────────────────────────────────────────────────────────
// Central diagnostics store.
//
// Every source of diagnostics in the app (Monaco built-in JS/TS,
// LSP publishDiagnostics, ESLint) funnels into this store so that
// the Sidebar file tree, the editor tabs, and any status-bar UI
// can render a unified "N errors / N warnings" badge per file
// WITHOUT having to actually open that file.
//
// The store keys diagnostics by absolute file path (normalized to
// forward slashes with a lowercased Windows drive letter) so that
// paths coming from the sidebar and from Monaco Uri.parse() match.
// ─────────────────────────────────────────────────────────────

export const normalizePath = (p) => {
  if (!p || typeof p !== 'string') return ''

  let prev = String(p)
  // Robustly decode URI components (e.g. %20 for spaces, %3A for colon)
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(prev)
      if (decoded === prev) break
      prev = decoded
    } catch {
      break
    }
  }

  let out = prev.replace(/\\/g, '/')
  // Strip file:// prefix that arrives from LSP / monaco.Uri.
  out = out.replace(/^file:\/\//, '')
  // If we ended up with /C:/foo, drop the leading slash so it
  // matches paths coming from the file tree ("C:/foo").
  if (/^\/[a-zA-Z]:\//.test(out)) out = out.slice(1)
  // Lowercase Windows drive letter so cross-source paths match.
  out = out.replace(/^([a-zA-Z]):/, (_, d) => `${d.toLowerCase()}:`)
  // Trim trailing slash.
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

const emptyCounts = { error: 0, warning: 0, info: 0, hint: 0 }

const summarize = (diags) => {
  const out = { ...emptyCounts }
  for (const d of diags) {
    // Monaco severity: 8 = Error, 4 = Warning, 2 = Info, 1 = Hint.
    // Our normalized shape stores a lowercase string in `severity`.
    if (d.severity === 'error') out.error++
    else if (d.severity === 'warning') out.warning++
    else if (d.severity === 'info') out.info++
    else if (d.severity === 'hint') out.hint++
  }
  return out
}

export const useDiagnosticsStore = create((set, get) => ({
  // { [normalizedPath]: { [sourceKey]: DiagnosticEntry[] } }
  bySource: {},
  // { [normalizedPath]: { error, warning, info, hint } } — derived for fast render.
  counts: {},
  // { [normalizedPath]: { [sourceKey]: true } } — every source that has emitted
  // ANY publishDiagnostics for this file at least once (empty array included).
  // Lets the sidebar/tabs distinguish "confirmed clean by source X" from
  // "source X hasn't looked yet" without lying with a "0" badge either way.
  analyzed: {},

  /**
   * Replace all diagnostics for a single (file, source) pair.
   * `source` is a string like `lsp-cpp`, `eslint`, `monaco-typescript`.
   * `diagnostics` is an array of `{ severity, message, line, column }`.
   * An empty array is a positive assertion — "I looked, nothing wrong" —
   * and marks the file as analyzed by that source.
   */
  setDiagnostics: (path, source, diagnostics) => {
    const key = normalizePath(path)
    if (!key || !source) return
    set((state) => {
      const fileSources = { ...(state.bySource[key] || {}) }
      if (!diagnostics || diagnostics.length === 0) {
        delete fileSources[source]
      } else {
        fileSources[source] = diagnostics
      }

      const nextBySource = { ...state.bySource }
      const nextCounts = { ...state.counts }

      if (Object.keys(fileSources).length === 0) {
        delete nextBySource[key]
        delete nextCounts[key]
      } else {
        nextBySource[key] = fileSources
        const flat = Object.values(fileSources).flat()
        nextCounts[key] = summarize(flat)
      }

      const nextAnalyzed = { ...state.analyzed }
      const analyzedSources = { ...(state.analyzed[key] || {}), [source]: true }
      nextAnalyzed[key] = analyzedSources

      return { bySource: nextBySource, counts: nextCounts, analyzed: nextAnalyzed }
    })
  },

  /**
   * Drop every diagnostic contributed by a source (e.g. an LSP that
   * just shut down). Used when the user switches C++ compilers.
   * Also drops the analyzed marker for that source so a subsequent
   * scan doesn't show stale "clean" status.
   */
  clearSource: (source) => {
    set((state) => {
      const nextBySource = {}
      const nextCounts = {}
      const nextAnalyzed = {}
      for (const [file, sources] of Object.entries(state.bySource)) {
        const filtered = { ...sources }
        delete filtered[source]
        if (Object.keys(filtered).length === 0) continue
        nextBySource[file] = filtered
        nextCounts[file] = summarize(Object.values(filtered).flat())
      }
      for (const [file, sources] of Object.entries(state.analyzed)) {
        const filtered = { ...sources }
        delete filtered[source]
        if (Object.keys(filtered).length === 0) continue
        nextAnalyzed[file] = filtered
      }
      return { bySource: nextBySource, counts: nextCounts, analyzed: nextAnalyzed }
    })
  },

  /**
   * Evict every trace of `path` from the store. If `path` is a
   * directory, all descendants are dropped too — file-deleted events
   * can fire for a directory and we don't want ghost counts under
   * files inside it.
   */
  clearForPath: (path) => {
    const key = normalizePath(path)
    if (!key) return
    const prefix = key + '/'
    set((state) => {
      const shouldDrop = (k) => k === key || k.startsWith(prefix)
      const filter = (map) => {
        let dropped = false
        const next = {}
        for (const [k, v] of Object.entries(map)) {
          if (shouldDrop(k)) { dropped = true; continue }
          next[k] = v
        }
        return dropped ? next : map
      }
      const nextBySource = filter(state.bySource)
      const nextCounts = filter(state.counts)
      const nextAnalyzed = filter(state.analyzed)
      if (nextBySource === state.bySource && nextCounts === state.counts && nextAnalyzed === state.analyzed) {
        return state
      }
      return { bySource: nextBySource, counts: nextCounts, analyzed: nextAnalyzed }
    })
  },

  /**
   * Move all diagnostics from oldPath → newPath. Handles the case where
   * a whole directory is renamed by moving every key with the prefix.
   * Called from App.jsx's file-renamed handler so the badge follows
   * the file instead of orphaning under the old path.
   */
  renamePath: (oldPath, newPath) => {
    const oldKey = normalizePath(oldPath)
    const newKey = normalizePath(newPath)
    if (!oldKey || !newKey || oldKey === newKey) return
    const oldPrefix = oldKey + '/'
    set((state) => {
      const rewriteKey = (k) => {
        if (k === oldKey) return newKey
        if (k.startsWith(oldPrefix)) return newKey + '/' + k.slice(oldPrefix.length)
        return null
      }
      const migrate = (map) => {
        const next = {}
        let dirty = false
        for (const [k, v] of Object.entries(map)) {
          const rewritten = rewriteKey(k)
          if (rewritten) {
            next[rewritten] = v
            dirty = true
          } else {
            next[k] = v
          }
        }
        return dirty ? next : map
      }
      return {
        bySource: migrate(state.bySource),
        counts: migrate(state.counts),
        analyzed: migrate(state.analyzed)
      }
    })
  },

  /**
   * Mark a file as analyzed by a source WITHOUT publishing diagnostics.
   * The workspace scanner calls this after every didOpen has been ack'd
   * so files with genuinely-zero errors still register as "looked at"
   * even though setDiagnostics(path, source, []) doesn't fire for them
   * (the LSP simply never publishes for clean files, so we have to
   * assert it ourselves once the batch is done).
   */
  markAnalyzed: (path, source) => {
    const key = normalizePath(path)
    if (!key || !source) return
    set((state) => {
      const existing = state.analyzed[key] || {}
      if (existing[source]) return state
      return {
        analyzed: { ...state.analyzed, [key]: { ...existing, [source]: true } }
      }
    })
  },

  clearAll: () => set({ bySource: {}, counts: {}, analyzed: {} }),

  getCountsFor: (path) => {
    const key = normalizePath(path)
    return get().counts[key] || emptyCounts
  },

  /**
   * Aggregate counts for every file that lives under `folderPath`.
   * Used by the sidebar so that a collapsed folder can still show
   * "◉ 3" if any file inside it has errors.
   */
  getFolderCounts: (folderPath) => {
    const prefix = normalizePath(folderPath) + '/'
    const acc = { ...emptyCounts }
    const counts = get().counts
    for (const key of Object.keys(counts)) {
      if (key === normalizePath(folderPath) || key.startsWith(prefix)) {
        acc.error += counts[key].error
        acc.warning += counts[key].warning
        acc.info += counts[key].info
        acc.hint += counts[key].hint
      }
    }
    return acc
  }
}))

// Convenience selector: subscribe to a single file's counts.
export const useFileCounts = (path) => {
  const key = normalizePath(path)
  return useDiagnosticsStore((s) => s.counts[key] || emptyCounts)
}

// Convenience selector: has ANY source analyzed this file yet?
// Returns false until at least one publishDiagnostics or markAnalyzed
// call has landed for this path. Sidebar/tab UX can use this to
// visually differentiate "no badge because clean" from "no badge because
// we haven't looked yet" — the default UI intentionally treats them the
// same (no visual difference), but keeping the state honest here means
// future tooltips or a status bar can surface the distinction without
// having to re-derive it.
export const useIsAnalyzed = (path) => {
  const key = normalizePath(path)
  return useDiagnosticsStore((s) => {
    const entry = s.analyzed[key]
    return !!(entry && Object.keys(entry).length > 0)
  })
}

// Convenience selector: subscribe to a whole folder's aggregated counts.
export const useFolderCounts = (folderPath) => {
  const prefix = normalizePath(folderPath) + '/'
  const self = normalizePath(folderPath)
  const countsStr = useDiagnosticsStore((s) => {
    let err = 0, warn = 0, info = 0, hint = 0
    for (const key of Object.keys(s.counts)) {
      if (key === self || key.startsWith(prefix)) {
        err += s.counts[key].error
        warn += s.counts[key].warning
        info += s.counts[key].info
        hint += s.counts[key].hint
      }
    }
    return `${err},${warn},${info},${hint}`
  })
  
  const [error, warning, info, hint] = countsStr.split(',').map(Number)
  return { error, warning, info, hint }
}

// Map various severity shapes to our lowercase string form.
export const monacoSeverityToString = (sev) => {
  // monaco.MarkerSeverity.Hint = 1, Info = 2, Warning = 4, Error = 8.
  if (sev === 8) return 'error'
  if (sev === 4) return 'warning'
  if (sev === 2) return 'info'
  if (sev === 1) return 'hint'
  return 'info'
}

export const lspSeverityToString = (sev) => {
  if (sev === 1) return 'error'
  if (sev === 2) return 'warning'
  if (sev === 3) return 'info'
  if (sev === 4) return 'hint'
  return 'info'
}
