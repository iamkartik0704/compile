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
  if (!p) return ''
  let out = String(p).replace(/\\/g, '/')
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

  /**
   * Replace all diagnostics for a single (file, source) pair.
   * `source` is a string like `lsp-cpp`, `eslint`, `monaco-typescript`.
   * `diagnostics` is an array of `{ severity, message, line, column }`.
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

      return { bySource: nextBySource, counts: nextCounts }
    })
  },

  /**
   * Drop every diagnostic contributed by a source (e.g. an LSP that
   * just shut down). Used when the user switches C++ compilers.
   */
  clearSource: (source) => {
    set((state) => {
      const nextBySource = {}
      const nextCounts = {}
      for (const [file, sources] of Object.entries(state.bySource)) {
        const filtered = { ...sources }
        delete filtered[source]
        if (Object.keys(filtered).length === 0) continue
        nextBySource[file] = filtered
        nextCounts[file] = summarize(Object.values(filtered).flat())
      }
      return { bySource: nextBySource, counts: nextCounts }
    })
  },

  clearAll: () => set({ bySource: {}, counts: {} }),

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
