import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { Search, File, FileCode, FileText, FileJson, Image, Palette, Command, ListTree, ArrowDownToLine, FolderOpen, CornerDownLeft } from 'lucide-react'
import { scorePath, scoreLabel, highlightRuns } from '../utils/fuzzyMatch'
import { getDocumentSymbols } from '../utils/documentSymbols'
import { useAppStore } from '../store/appStore'
import { useShortcutStore } from '../store/shortcutStore'
import '../assets/quickopen.css'

// Quick Open: one palette for files (default), commands (">"), symbols in the
// current file ("@") and go-to-line (":").

const MAX_RESULTS = 80
const RECENT_FILES_KEY = 'quickopen-recent-files'
const RECENT_COMMANDS_KEY = 'quickopen-recent-commands'
const MAX_RECENT_FILES = 30
const MAX_RECENT_COMMANDS = 8

const THEMES = [
  { id: 'compile-dark', label: 'comπle Dark', keywords: 'compile dark' },
  { id: 'dark-plus', label: 'Dark Plus' },
  { id: 'light-modern', label: 'Light Modern' },
  { id: 'dracula', label: 'Dracula' }
]

// ─── Recently used ─────────────────────────────────────────────────
const readList = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

const pushToList = (key, value, max) => {
  try {
    const next = [value, ...readList(key).filter((entry) => entry !== value)].slice(0, max)
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    // Storage full or unavailable: recents are a convenience, not worth surfacing.
  }
}

// Tabs like "settings:main" or "untitled:Untitled-1" are not files on disk.
const isRealFile = (path) => typeof path === 'string' && path.length > 0 && !/^[a-z][\w-]*:(?![\\/])/i.test(path)

/** Call when a file becomes the active tab so it shows up first next time. */
export function recordRecentFile(path) {
  if (isRealFile(path)) pushToList(RECENT_FILES_KEY, path, MAX_RECENT_FILES)
}

// ─── Active editor tracking ────────────────────────────────────────
// The palette steals focus, so remember which editor had it last.
let lastFocusedEditor = null
monaco.editor.onDidCreateEditor((editor) => {
  if (typeof editor.onDidFocusEditorText !== 'function') return
  editor.onDidFocusEditorText(() => { lastFocusedEditor = editor })
  editor.onDidDispose(() => { if (lastFocusedEditor === editor) lastFocusedEditor = null })
})

const isUsableEditor = (editor) => {
  try {
    const node = editor.getDomNode()
    return !!(editor.getModel() && node && node.isConnected && node.offsetParent !== null)
  } catch {
    return false
  }
}

function findActiveEditor() {
  const editors = monaco.editor.getEditors()
  return (
    editors.find((editor) => isUsableEditor(editor) && editor.hasTextFocus()) ||
    (lastFocusedEditor && isUsableEditor(lastFocusedEditor) ? lastFocusedEditor : null) ||
    editors.find(isUsableEditor) ||
    null
  )
}

// After a file is opened from the palette, put the caret in it so you can type straight away.
function focusActiveEditor() {
  const editor = findActiveEditor()
  if (editor) editor.focus()
}

const editorFileName = (editor) => {
  const model = editor && editor.getModel()
  return model ? decodeURIComponent(model.uri.path.split('/').pop() || '') : ''
}

// ─── Commands contributed by the menu bar ──────────────────────────
const SELF_REFERENTIAL = /^(command palette|open view|go to file|version:)/i

/**
 * Flatten the title-bar menus into palette commands, so anything reachable
 * from a menu is also reachable from the keyboard.
 */
export function buildMenuCommands(menus, formatShortcut) {
  const commands = []
  const usedIds = new Set()

  const add = (trail, item) => {
    if (!item || item.type === 'separator' || item.disabled || !item.label) return
    const label = String(item.label).trim()
    const plain = label.replace(/✓/g, '').replace(/\.{3}$/, '').trim()
    if (item.hasSubmenu && Array.isArray(item.submenu)) {
      item.submenu.forEach((sub) => add([...trail, plain], sub))
      return
    }
    if (typeof item.action !== 'function' || SELF_REFERENTIAL.test(plain)) return
    let id = `menu:${[...trail, plain].join('/')}`
    for (let n = 2; usedIds.has(id); n++) id = `menu:${[...trail, plain].join('/')}#${n}`
    usedIds.add(id)
    commands.push({
      id,
      label: `${trail[0]}: ${[...trail.slice(1), label.replace(/\.{3}$/, '')].join(' › ')}`,
      shortcut: formatShortcut ? formatShortcut(item.shortcutId, item.shortcut) || '' : item.shortcut || '',
      run: item.action
    })
  }

  for (const menu of menus || []) {
    for (const item of menu.items || []) add([menu.name], item)
  }
  return commands
}

// ─── Project file index ────────────────────────────────────────────
const fileIndexCache = new Map() // projectRoot -> entries

const pathKey = (path) => path.replace(/\\/g, '/').toLowerCase()

const toEntry = (path, root) => {
  const trimmedRoot = root ? root.replace(/[\\/]+$/, '') : ''
  const inside = trimmedRoot && path.toLowerCase().startsWith(trimmedRoot.toLowerCase())
  const rel = (inside ? path.slice(trimmedRoot.length) : path).replace(/\\/g, '/').replace(/^\/+/, '')
  const slash = rel.lastIndexOf('/')
  return { path, key: pathKey(path), rel, name: rel.slice(slash + 1), dir: slash === -1 ? '' : rel.slice(0, slash) }
}

// ─── Input parsing ─────────────────────────────────────────────────
const toInt = (text) => (text && /^-?\d+$/.test(text) ? parseInt(text, 10) : null)

function parseInput(raw) {
  const first = raw[0]
  if (first === '>') return { mode: 'commands', query: raw.slice(1).trim() }
  if (first === '@') return { mode: 'symbols', query: raw.slice(1).trim() }
  if (first === '?') return { mode: 'help', query: '' }
  if (first === ':') {
    const [line, column] = raw.slice(1).split(/[:,]/)
    return { mode: 'line', query: raw.slice(1).trim(), line: toInt(line && line.trim()), column: toInt(column && column.trim()) }
  }
  // "app.jsx:120" or "app.jsx:120:8" opens the file at that position.
  const located = /^(.+?):(\d*)(?::(\d*))?$/.exec(raw)
  if (located) return { mode: 'files', query: located[1].trim(), line: toInt(located[2]), column: toInt(located[3]) }
  return { mode: 'files', query: raw.trim() }
}

// ─── Presentation helpers ──────────────────────────────────────────
const EXT_STYLE = {
  js: ['#e8d44d', FileCode], jsx: ['#61dafb', FileCode], mjs: ['#e8d44d', FileCode], cjs: ['#e8d44d', FileCode],
  ts: ['#4f9cf0', FileCode], tsx: ['#4f9cf0', FileCode],
  py: ['#5aa9e6', FileCode], java: ['#e76f51', FileCode], go: ['#4fd1c5', FileCode], rs: ['#e08a5b', FileCode],
  c: ['#7aa2f7', FileCode], h: ['#7aa2f7', FileCode], cpp: ['#7aa2f7', FileCode], hpp: ['#7aa2f7', FileCode], cs: ['#9d7cd8', FileCode],
  php: ['#9d7cd8', FileCode], rb: ['#e06c75', FileCode], sh: ['#8fd694', FileCode], toad: ['#8fd694', FileCode],
  html: ['#e8734a', FileCode], css: ['#c792ea', FileCode], scss: ['#e879b5', FileCode], vue: ['#5fd3a0', FileCode],
  json: ['#d9a94f', FileJson], yml: ['#d9a94f', FileJson], yaml: ['#d9a94f', FileJson], toml: ['#d9a94f', FileJson],
  md: [null, FileText], txt: [null, FileText], log: [null, FileText],
  png: ['#c792ea', Image], jpg: ['#c792ea', Image], jpeg: ['#c792ea', Image], gif: ['#c792ea', Image], svg: ['#e8a84d', Image], ico: ['#c792ea', Image], webp: ['#c792ea', Image]
}

const FileIcon = ({ name }) => {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  const [color, Icon] = EXT_STYLE[ext] || [null, File]
  return <Icon size={15} strokeWidth={1.75} style={color ? { color } : undefined} />
}

const KIND_BADGE = {
  function: 'ƒ', method: 'm', constructor: 'c', class: 'C', struct: 'S', interface: 'I', type: 'T', enum: 'E',
  namespace: 'N', impl: 'I', variable: 'v', heading: '#', key: 'k', rule: '{}'
}

const Highlighted = ({ text, positions }) => (
  <>
    {highlightRuns(text, positions).map((run, index) =>
      run.match ? <mark key={index}>{run.text}</mark> : <React.Fragment key={index}>{run.text}</React.Fragment>
    )}
  </>
)

const Keys = ({ shortcut }) => (
  <span className="qo-keys">
    {shortcut.split(/\s+/).map((chord, index) => (
      <kbd key={index}>{chord}</kbd>
    ))}
  </span>
)

// Current binding for a shortcut id, honouring user remaps (e.g. "Ctrl+P").
const shortcutFor = (id, fallback) => {
  for (const group of useShortcutStore.getState().shortcuts || []) {
    const item = group.items.find((candidate) => candidate.id === id)
    if (item && item.keys && item.keys.length) return item.keys.join('+')
  }
  return fallback
}

const toast = (message, type = 'info') => window.dispatchEvent(new CustomEvent('show-toast', { detail: { message, type } }))

export function QuickOpen({ initialInput = '', projectRoot, openFiles = [], activeFile, getCommands, onOpenFile, onClose }) {
  const [input, setInput] = useState(initialInput)
  const [selected, setSelected] = useState(0)
  const [fileEntries, setFileEntries] = useState(() => (projectRoot && fileIndexCache.get(projectRoot)) || null)
  const [filesLoading, setFilesLoading] = useState(!!projectRoot)
  const [symbols, setSymbols] = useState({ status: 'idle', list: [] })
  const [picker, setPicker] = useState(null)

  const inputRef = useRef(null)
  const listRef = useRef(null)
  const pickerRef = useRef(null)
  pickerRef.current = picker

  // Captured once, before the palette takes focus.
  const [editor] = useState(findActiveEditor)
  const [previousFocus] = useState(() => document.activeElement)
  const [recentFiles] = useState(() => readList(RECENT_FILES_KEY))
  const [recentCommands] = useState(() => readList(RECENT_COMMANDS_KEY))
  const savedViewState = useRef(editor ? editor.saveViewState() : null)
  const previewDecorations = useRef(null)
  const didPreview = useRef(false)

  const parsed = useMemo(() => parseInput(input), [input])
  const mode = picker ? 'picker' : parsed.mode
  const query = picker ? input.trim() : parsed.query

  // ── Editor preview (":" and "@" scroll the editor as you move) ──
  const previewPosition = (line) => {
    if (!editor || !isUsableEditor(editor)) return
    const target = Math.min(Math.max(1, line), editor.getModel().getLineCount())
    if (!previewDecorations.current) previewDecorations.current = editor.createDecorationsCollection([])
    previewDecorations.current.set([
      { range: new monaco.Range(target, 1, target, 1), options: { isWholeLine: true, className: 'quickopen-line-preview' } }
    ])
    editor.revealLineInCenter(target)
    didPreview.current = true
  }

  const clearPreview = (restoreView) => {
    if (previewDecorations.current) previewDecorations.current.clear()
    if (restoreView && didPreview.current && editor && isUsableEditor(editor) && savedViewState.current) {
      editor.restoreViewState(savedViewState.current)
    }
    didPreview.current = false
  }

  const goToPosition = (line, column) => {
    if (!editor || !isUsableEditor(editor)) return
    const model = editor.getModel()
    const lineNumber = Math.min(Math.max(1, line), model.getLineCount())
    const position = { lineNumber, column: Math.min(Math.max(1, column || 1), model.getLineMaxColumn(lineNumber)) }
    editor.setPosition(position)
    editor.revealPositionInCenter(position)
    editor.focus()
  }

  // ── Closing ──
  const close = (accepted, restoreFocus = true) => {
    clearPreview(!accepted)
    if (!accepted && pickerRef.current && pickerRef.current.onCancel) pickerRef.current.onCancel()
    onClose()
    if (!restoreFocus) return
    // Hand focus back to wherever it came from (editor, terminal, a panel input).
    if (previousFocus && previousFocus !== document.body && previousFocus.isConnected && previousFocus.focus) previousFocus.focus()
    else if (editor && isUsableEditor(editor)) editor.focus()
  }

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    inputRef.current && inputRef.current.focus()
    return () => {
      mounted.current = false
      // If the palette is torn down from outside, don't leave a highlight behind.
      if (previewDecorations.current) previewDecorations.current.clear()
    }
  }, [])

  // ── Load the project file list (cached copy shows instantly, then refreshes) ──
  useEffect(() => {
    if (!projectRoot || !window.api || !window.api.getProjectTree) {
      setFilesLoading(false)
      return
    }
    let cancelled = false
    setFilesLoading(true)
    window.api
      .getProjectTree(projectRoot)
      .then((paths) => {
        if (cancelled) return
        const entries = (Array.isArray(paths) ? paths : []).map((path) => toEntry(path, projectRoot))
        entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
        fileIndexCache.set(projectRoot, entries)
        setFileEntries(entries)
      })
      .catch((error) => console.warn('[quick-open] could not list project files:', error))
      .finally(() => { if (!cancelled) setFilesLoading(false) })
    return () => { cancelled = true }
  }, [projectRoot])

  // ── Parse symbols the first time "@" mode is entered ──
  const symbolsRequested = useRef(false)
  useEffect(() => {
    if (mode !== 'symbols' || symbolsRequested.current) return
    symbolsRequested.current = true
    if (!editor || !isUsableEditor(editor)) {
      setSymbols({ status: 'ready', list: [] })
      return
    }
    setSymbols({ status: 'loading', list: [] })
    getDocumentSymbols(editor.getModel().getValue(), editorFileName(editor) || activeFile || '')
      .then((list) => { if (mounted.current) setSymbols({ status: 'ready', list }) })
      .catch(() => { if (mounted.current) setSymbols({ status: 'ready', list: [] }) })
  }, [mode])

  // ── Commands: palette built-ins + menu bar + the active editor's own actions ──
  const commands = useMemo(() => {
    const builtIn = [
      { id: 'quickopen.files', label: 'Go: Go to File', shortcut: shortcutFor('nav.goToFile', 'Ctrl+P'), setInput: '' },
      { id: 'quickopen.symbols', label: 'Go: Go to Symbol in File', hint: '@', setInput: '@' },
      { id: 'quickopen.line', label: 'Go: Go to Line', hint: ':', setInput: ':' },
      {
        id: 'quickopen.theme',
        label: 'Preferences: Color Theme',
        openPicker: () => {
          const original = useAppStore.getState().activeTheme
          return {
            title: 'Color Theme',
            placeholder: 'Select a color theme — arrow keys to preview',
            initialKey: original,
            onCancel: () => useAppStore.getState().setActiveTheme(original),
            items: THEMES.map((theme) => ({
              key: theme.id,
              label: theme.label,
              keywords: theme.keywords,
              tag: theme.id === original ? 'current' : '',
              icon: <Palette size={15} strokeWidth={1.75} />,
              preview: () => useAppStore.getState().setActiveTheme(theme.id),
              run: () => useAppStore.getState().setActiveTheme(theme.id)
            }))
          }
        }
      }
    ]

    let contributed = []
    try {
      contributed = (getCommands && getCommands()) || []
    } catch (error) {
      console.warn('[quick-open] could not collect commands:', error)
    }

    const all = [...builtIn, ...contributed]
    const taken = new Set(all.map((command) => command.label.replace(/^[^:]+:\s*/, '').replace(/[^a-z0-9]/gi, '').toLowerCase()))

    if (editor && isUsableEditor(editor)) {
      for (const action of editor.getSupportedActions()) {
        if (!action.label || action.id === 'editor.action.quickCommand') continue
        const normalized = action.label.replace(/[^a-z0-9]/gi, '').toLowerCase()
        if (taken.has(normalized)) continue
        taken.add(normalized)
        all.push({
          id: `editor:${action.id}`,
          label: `Editor: ${action.label}`,
          run: () => { editor.focus(); return action.run() }
        })
      }
    }
    return all
  }, [])

  const knownFileKeys = useMemo(() => new Set((fileEntries || []).map((entry) => entry.key)), [fileEntries])

  // ── Build the visible rows for the current mode ──
  const view = useMemo(() => {
    if (mode === 'picker') {
      const rows = picker.items
        .map((item) => {
          if (!query) return { ...item, labelPositions: [], score: 0 }
          const match = scoreLabel(query, item.label)
          if (match) return { ...item, labelPositions: match.positions, score: match.score }
          // Plain-text alias for labels you can't type as written ("compile" finds "comπle").
          const alias = item.keywords ? scoreLabel(query, item.keywords) : null
          return alias ? { ...item, labelPositions: [], score: alias.score } : null
        })
        .filter(Boolean)
      if (query) rows.sort((a, b) => b.score - a.score)
      return { rows, empty: 'No matches', status: picker.title }
    }

    if (mode === 'help') {
      return {
        status: 'Help',
        rows: [
          { key: 'files', label: 'Go to file', description: 'type part of a name — add :42 to land on a line', badge: '…', setInput: '' },
          { key: 'commands', label: 'Run a command', description: 'menus, views, editor actions, themes', badge: '>', setInput: '>' },
          { key: 'symbols', label: 'Go to symbol in this file', description: 'functions, classes, headings', badge: '@', setInput: '@' },
          { key: 'line', label: 'Go to line', description: ':120 or :120:8, negative counts from the end', badge: ':', setInput: ':' }
        ]
      }
    }

    if (mode === 'line') {
      const fileName = editorFileName(editor)
      if (!editor || !isUsableEditor(editor)) {
        return { rows: [], empty: 'Open a file first to jump to a line.', status: 'Go to line' }
      }
      const lineCount = editor.getModel().getLineCount()
      const current = editor.getPosition()
      if (parsed.line === null || parsed.line === 0) {
        const where = current ? `Currently at line ${current.lineNumber}, column ${current.column}. ` : ''
        return { rows: [], empty: `${where}Type a line number from 1 to ${lineCount}.`, status: `Go to line · ${fileName}` }
      }
      const line = parsed.line < 0 ? Math.max(1, lineCount + parsed.line + 1) : Math.min(parsed.line, lineCount)
      const column = parsed.column && parsed.column > 0 ? parsed.column : 1
      return {
        status: `Go to line · ${fileName}`,
        rows: [
          {
            key: `line-${line}-${column}`,
            label: column > 1 ? `Go to line ${line}, column ${column}` : `Go to line ${line}`,
            description: oneLinePreview(editor.getModel().getLineContent(line)),
            badge: ':',
            preview: () => previewPosition(line),
            run: () => goToPosition(line, column)
          }
        ]
      }
    }

    if (mode === 'symbols') {
      const fileName = editorFileName(editor)
      const status = fileName ? `Symbols · ${fileName}` : 'Symbols'
      if (!editor || !isUsableEditor(editor)) return { rows: [], empty: 'Open a file first to browse its symbols.', status }
      if (symbols.status !== 'ready') return { rows: [], empty: 'Reading symbols…', status }

      const toRow = (symbol, index, match) => ({
        key: `symbol-${index}`,
        label: symbol.name,
        labelPositions: match ? match.positions : [],
        description: symbol.container ? `${symbol.kind} · ${symbol.container}` : symbol.kind,
        badge: KIND_BADGE[symbol.kind] || '•',
        badgeKind: symbol.kind,
        indent: match ? 0 : Math.min(symbol.depth, 6),
        detail: `:${symbol.line}`,
        preview: () => previewPosition(symbol.line),
        run: () => goToPosition(symbol.line, symbol.column)
      })

      if (!query) {
        return { status, total: symbols.list.length, rows: symbols.list.slice(0, 400).map((symbol, index) => toRow(symbol, index, null)), empty: 'No symbols found in this file.' }
      }
      const scored = []
      symbols.list.forEach((symbol, index) => {
        const match = scoreLabel(query, symbol.name)
        if (match) scored.push({ symbol, index, match })
      })
      scored.sort((a, b) => b.match.score - a.match.score || a.index - b.index)
      return {
        status,
        total: symbols.list.length,
        rows: scored.slice(0, MAX_RESULTS).map(({ symbol, index, match }) => toRow(symbol, index, match)),
        empty: `No symbols match “${query}”.`
      }
    }

    if (mode === 'commands') {
      const toRow = (command, match, tag) => ({
        key: command.id,
        commandId: command.id,
        label: command.label,
        labelPositions: match ? match.positions : [],
        shortcut: command.shortcut,
        hint: command.hint,
        tag,
        icon: command.openPicker ? <Palette size={15} strokeWidth={1.75} /> : <Command size={15} strokeWidth={1.75} />,
        setInput: command.setInput,
        openPicker: command.openPicker,
        run: command.run
      })

      if (!query) {
        const byId = new Map(commands.map((command) => [command.id, command]))
        const recent = recentCommands.map((id) => byId.get(id)).filter(Boolean)
        const recentIds = new Set(recent.map((command) => command.id))
        const rest = commands.filter((command) => !recentIds.has(command.id))
        return {
          status: 'Commands',
          total: commands.length,
          rows: [...recent.map((command) => toRow(command, null, 'recently used')), ...rest.map((command) => toRow(command, null, ''))]
        }
      }
      const scored = []
      for (const command of commands) {
        const match = scoreLabel(query, command.label)
        if (match) scored.push({ command, match })
      }
      scored.sort((a, b) => b.match.score - a.match.score)
      return {
        status: 'Commands',
        total: commands.length,
        rows: scored.slice(0, MAX_RESULTS).map(({ command, match }) => toRow(command, match, '')),
        empty: `No commands match “${query}”.`
      }
    }

    // ── files ──
    const entries = fileEntries || []
    const openPaths = openFiles.map((file) => file.path).filter(isRealFile)
    const openKeys = new Set(openPaths.map(pathKey))
    const activePathKey = activeFile && isRealFile(activeFile) ? pathKey(activeFile) : ''
    const recentRank = new Map(recentFiles.map((path, index) => [pathKey(path), index]))

    // Open tabs and recents may live outside the project folder; keep them searchable.
    const extras = []
    const extraKeys = new Set()
    for (const path of [...openPaths, ...recentFiles]) {
      const key = pathKey(path)
      if (knownFileKeys.has(key) || extraKeys.has(key)) continue
      extraKeys.add(key)
      extras.push(toEntry(path, projectRoot))
    }

    const toRow = (entry, match) => {
      const nameStart = entry.rel.length - entry.name.length
      const positions = match ? match.positions : []
      const tag = openKeys.has(entry.key) ? (entry.key === activePathKey ? 'active' : 'open') : recentRank.has(entry.key) ? 'recent' : ''
      return {
        key: entry.path,
        label: entry.name,
        labelPositions: positions.filter((p) => p >= nameStart).map((p) => p - nameStart),
        description: entry.dir,
        descriptionPositions: positions.filter((p) => p < entry.dir.length),
        tag,
        icon: <FileIcon name={entry.name} />,
        opensFile: true,
        run: () => {
          onOpenFile(entry.path, entry.name, parsed.line, parsed.column)
          // With a line number the jump itself focuses the editor.
          if (!(parsed.line > 0)) setTimeout(focusActiveEditor, 80)
        }
      }
    }

    const status = projectRoot ? projectRoot.split(/[/\\]/).filter(Boolean).pop() : 'Files'
    const total = entries.length + extras.length
    const noFolder = !projectRoot && total === 0
    const empty = noFolder
      ? 'No folder is open. Open one to search its files, or type > for commands.'
      : filesLoading && !fileEntries
        ? 'Indexing files…'
        : query
          ? `No files match “${query}”.`
          : 'This folder has no files yet.'

    if (!query) {
      // Recently used first (the tab you are on goes last, so Enter flips to the previous file).
      const recent = [...extras, ...entries]
        .filter((entry) => recentRank.has(entry.key) || openKeys.has(entry.key))
        .sort((a, b) => {
          const aActive = a.key === activePathKey ? 1 : 0
          const bActive = b.key === activePathKey ? 1 : 0
          if (aActive !== bActive) return aActive - bActive
          return (recentRank.get(a.key) ?? MAX_RECENT_FILES) - (recentRank.get(b.key) ?? MAX_RECENT_FILES)
        })
        .slice(0, 12)
      const shown = new Set(recent.map((entry) => entry.key))
      const rest = entries.filter((entry) => !shown.has(entry.key)).slice(0, MAX_RESULTS - recent.length)
      return { status, total, rows: [...recent, ...rest].map((entry) => toRow(entry, null)), empty, noFolder }
    }

    const scored = []
    for (const entry of [...entries, ...extras]) {
      const match = scorePath(query, entry.rel)
      if (!match) continue
      const rank = recentRank.get(entry.key)
      // Nudge files you actually use above look-alikes with the same match quality.
      const boost = (rank !== undefined ? 12 - Math.min(rank, 10) : 0) + (openKeys.has(entry.key) ? 6 : 0)
      scored.push({ entry, match, score: match.score + boost })
    }
    scored.sort((a, b) => b.score - a.score || a.entry.rel.length - b.entry.rel.length)
    return { status, total, matched: scored.length, rows: scored.slice(0, MAX_RESULTS).map(({ entry, match }) => toRow(entry, match)), empty, noFolder }
  }, [mode, query, parsed.line, parsed.column, picker, fileEntries, knownFileKeys, filesLoading, symbols, commands, openFiles, activeFile, projectRoot])

  const rows = view.rows

  // Selection resets when the result set changes; pickers start on their current value.
  const resetKey = `${mode}|${query}|${picker ? picker.title : ''}`
  useLayoutEffect(() => {
    if (picker && !query && picker.initialKey) {
      const index = picker.items.findIndex((item) => item.key === picker.initialKey)
      setSelected(index === -1 ? 0 : index)
    } else {
      setSelected(0)
    }
    if (listRef.current) listRef.current.scrollTop = 0
  }, [resetKey])

  const activeIndex = rows.length ? Math.min(selected, rows.length - 1) : -1
  const activeRow = activeIndex === -1 ? null : rows[activeIndex]

  // Live preview follows the highlighted row; leaving a preview mode puts the editor back.
  const activeKey = activeRow ? activeRow.key : ''
  useEffect(() => {
    if (activeRow && activeRow.preview) activeRow.preview()
    else if (mode !== 'picker') clearPreview(true)
  }, [mode, activeKey])

  useLayoutEffect(() => {
    const list = listRef.current
    const node = list && list.querySelector('[aria-selected="true"]')
    if (node) node.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, resetKey])

  // ── Accepting a row ──
  const accept = (row) => {
    if (!row) return
    if (row.setInput !== undefined) {
      setPicker(null)
      setInput(row.setInput)
      inputRef.current && inputRef.current.focus()
      return
    }
    if (row.openPicker) {
      if (row.commandId) pushToList(RECENT_COMMANDS_KEY, row.commandId, MAX_RECENT_COMMANDS)
      const next = row.openPicker()
      setPicker(next)
      setInput('')
      setSelected(Math.max(0, next.items.findIndex((item) => item.key === next.initialKey)))
      inputRef.current && inputRef.current.focus()
      return
    }
    if (row.commandId) pushToList(RECENT_COMMANDS_KEY, row.commandId, MAX_RECENT_COMMANDS)
    // When a file is about to replace what the editor shows, focus the editor after the switch, not before.
    close(true, !row.opensFile)
    // Let the palette unmount and focus settle before the command touches the UI.
    // (A timer, not an animation frame: frames stop while the window is hidden.)
    setTimeout(() => {
      Promise.resolve()
        .then(() => row.run && row.run())
        .catch((error) => {
          console.error('[quick-open] command failed:', error)
          toast(`“${row.label}” failed: ${error && error.message ? error.message : error}`, 'error')
        })
    }, 0)
  }

  const openFolder = () => {
    const command = commands.find((candidate) => candidate.id === 'menu:File/Open Folder')
    if (command) accept({ label: command.label, commandId: command.id, run: command.run })
    else setInput('>open folder')
  }

  const leavePicker = () => {
    if (picker && picker.onCancel) picker.onCancel()
    setPicker(null)
    setInput('>')
  }

  const move = (delta) => {
    if (!rows.length) return
    setSelected((activeIndex + delta + rows.length) % rows.length)
  }

  const handleKeyDown = (e) => {
    const primary = e.ctrlKey || e.metaKey
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'PageDown') { e.preventDefault(); if (rows.length) setSelected(Math.min(rows.length - 1, activeIndex + 8)) }
    else if (e.key === 'PageUp') { e.preventDefault(); if (rows.length) setSelected(Math.max(0, activeIndex - 8)) }
    else if (e.key === 'Enter') { e.preventDefault(); accept(activeRow) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false) }
    else if (e.key === 'Tab') { e.preventDefault() }
    else if (e.key === 'Backspace' && picker && input === '') { e.preventDefault(); leavePicker() }
    else if (primary && e.key.toLowerCase() === 'p') {
      // Ctrl+P again walks the list (Ctrl+P, P, Enter = two files back); Ctrl+Shift+P switches to commands.
      e.preventDefault()
      if (e.shiftKey) { if (picker) leavePicker(); else setInput('>') }
      else move(1)
    }
  }

  const placeholder = picker
    ? picker.placeholder
    : 'Search files by name   ·   > commands   ·   @ symbols   ·   : line'

  const countLabel = (() => {
    if (mode === 'files') {
      if (filesLoading && !fileEntries) return 'Indexing…'
      if (query) return `${view.matched || 0} of ${view.total} files`
      return view.total ? `${view.total} files${filesLoading ? ' · refreshing' : ''}` : ''
    }
    if ((mode === 'commands' || mode === 'symbols') && view.total !== undefined) {
      return query ? `${rows.length} of ${view.total}` : `${view.total} ${mode}`
    }
    return ''
  })()

  const ModeIcon = mode === 'commands' ? Command : mode === 'symbols' ? ListTree : mode === 'line' ? ArrowDownToLine : mode === 'picker' ? Palette : Search
  const acceptVerb = { commands: 'run', picker: 'apply', line: 'go', symbols: 'go', help: 'select' }[mode] || 'open'

  return (
    <div className="qo-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false) }}>
      <div className="qo-panel" role="dialog" aria-modal="true" aria-label="Quick Open">
        <div className="qo-input-row">
          <ModeIcon size={16} strokeWidth={1.75} className="qo-mode-icon" />
          <input
            ref={inputRef}
            className="qo-input"
            type="text"
            value={input}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="qo-results"
            aria-activedescendant={activeRow ? `qo-row-${activeIndex}` : undefined}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {view.status && <span className="qo-status" title={view.status}>{view.status}</span>}
        </div>

        <div className="qo-list" id="qo-results" role="listbox" ref={listRef}>
          {rows.length === 0 && (
            <div className="qo-empty">
              <span>{view.empty}</span>
              {view.noFolder && (
                <button type="button" className="qo-empty-action" onClick={openFolder}>
                  <FolderOpen size={14} strokeWidth={1.75} /> Open Folder…
                </button>
              )}
            </div>
          )}
          {rows.map((row, index) => (
            <div
              key={row.key}
              id={`qo-row-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`qo-row${index === activeIndex ? ' is-active' : ''}`}
              style={row.indent ? { paddingLeft: 12 + row.indent * 14 } : undefined}
              onMouseMove={() => { if (index !== activeIndex) setSelected(index) }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => accept(row)}
            >
              <span className={`qo-icon${row.badge ? ' qo-badge' : ''}${row.badgeKind ? ` kind-${row.badgeKind}` : ''}`}>
                {row.badge || row.icon}
              </span>
              <span className="qo-label">
                <Highlighted text={row.label} positions={row.labelPositions} />
              </span>
              {row.description && (
                <span className="qo-description">
                  <Highlighted text={row.description} positions={row.descriptionPositions} />
                </span>
              )}
              <span className="qo-meta">
                {row.tag && <span className="qo-tag">{row.tag}</span>}
                {row.detail && <span className="qo-detail">{row.detail}</span>}
                {row.hint && <Keys shortcut={row.hint} />}
                {row.shortcut && <Keys shortcut={row.shortcut} />}
              </span>
            </div>
          ))}
        </div>

        <div className="qo-footer">
          <span className="qo-count">{countLabel}</span>
          <span className="qo-hints">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span><kbd><CornerDownLeft size={10} strokeWidth={2} /></kbd> {acceptVerb}</span>
            <span><kbd>esc</kbd> close</span>
            <span><kbd>?</kbd> help</span>
          </span>
        </div>
      </div>
    </div>
  )
}

function oneLinePreview(text) {
  const flat = text.trim().replace(/\s+/g, ' ')
  return flat.length > 90 ? flat.slice(0, 89) + '…' : flat
}
