import React, { useState, useEffect, useRef } from 'react'
import { Folder, FolderOpen, FileCode, ChevronRight, ChevronDown, FolderSearch, FilePlus, FolderPlus, RefreshCw, Minimize2, Database } from 'lucide-react'
import { useFileCounts, useFolderCounts } from '../store/diagnosticsStore'

// Renders a compact "3" or "!" pill next to a tree node. Kept as a
// tiny leaf component so it only rerenders when its own file's
// counts change — the file tree can have thousands of nodes so
// broad rerenders would tank scroll performance.
const DiagnosticBadge = ({ path, isDirectory }) => {
  // Hooks must be unconditional — call both and pick the value we need.
  const fileCounts = useFileCounts(isDirectory ? '' : path)
  const folderCounts = useFolderCounts(isDirectory ? path : '')
  const counts = isDirectory ? folderCounts : fileCounts
  if (!counts.error && !counts.warning) return null
  const errText = counts.error > 99 ? '99+' : counts.error
  const warnText = counts.warning > 99 ? '99+' : counts.warning
  const title = `${counts.error} error${counts.error === 1 ? '' : 's'}, ${counts.warning} warning${counts.warning === 1 ? '' : 's'}`
  return (
    <span className="tree-diagnostic-badges" title={title}>
      {counts.error > 0 && <span className="tree-badge error">{errText}</span>}
      {counts.error === 0 && counts.warning > 0 && <span className="tree-badge warning">{warnText}</span>}
    </span>
  )
}

// Helper to get parent path
const getParentPath = (path) => {
  const parts = path.split(/[/\\]/)
  parts.pop()
  return parts.join('/')
}

// Inline Input for New Items
const NewItemInput = ({ type, onSubmit, onCancel, level }) => {
  const [val, setVal] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleGlobalPointerDown = (e) => {
      // If the click is outside this input, cancel the creation
      if (inputRef.current && !inputRef.current.contains(e.target)) {
        onCancel()
      }
    }

    window.addEventListener('pointerdown', handleGlobalPointerDown, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown, { capture: true })
    }
  }, [onCancel])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (val.trim()) onSubmit(val.trim())
      else onCancel()
    }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="tree-node new-item-input-container" style={{ paddingLeft: `${level * 16 + 8}px` }}>
      <div className="tree-icon">
        <span className="chevron-placeholder"></span>
        {type === 'folder' ? <Folder size={16} className="icon-folder" /> : <FileCode size={16} className="icon-file" />}
      </div>
      <input
        ref={inputRef}
        className="new-item-input"
        spellCheck={false}
        style={{
          backgroundColor: 'var(--bg-lighter, rgba(255, 255, 255, 0.1))',
          borderColor: 'var(--accent-color, #007acc)',
          color: 'var(--text-primary, #ffffff)',
          outline: 'none',
          padding: '2px 6px',
          marginLeft: '4px',
          width: 'calc(100% - 20px)'
        }}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}

// Inline Input for Renaming Items
const RenameItemInput = ({ initialName, onSubmit, onCancel, level, item, siblings }) => {
  const [val, setVal] = useState(initialName)
  const inputRef = useRef(null)
  const isConfirming = useRef(false)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      const lastDotIndex = initialName.lastIndexOf('.')
      if (!item.isDirectory && lastDotIndex > 0) {
        inputRef.current.setSelectionRange(0, lastDotIndex)
      } else {
        inputRef.current.select()
      }
    }
  }, [initialName, item.isDirectory])

  useEffect(() => {
    const handleGlobalPointerDown = (e) => {
      // If the click is outside this input, cancel the rename
      if (inputRef.current && !inputRef.current.contains(e.target)) {
        if (isConfirming.current) return
        onCancel()
      }
    }

    // Use capture phase to catch the event before Monaco or anything else can prevent default
    window.addEventListener('pointerdown', handleGlobalPointerDown, { capture: true })

    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown, { capture: true })
    }
  }, [onCancel])

  const handleBlur = (e) => {
    if (isConfirming.current) return
    onCancel()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const newName = val.trim()
      if (!newName || newName === initialName) return onCancel()
      if (/[<>:"/\\|?*]/.test(newName)) {
        alert('Name contains invalid characters.')
        return
      }
      if (siblings && siblings.find(s => s.name === newName && s.path !== item.path)) {
        alert('An item with this name already exists.')
        return
      }
      if (!item.isDirectory) {
        const oldExt = initialName.includes('.') ? initialName.split('.').pop() : ''
        const newExt = newName.includes('.') ? newName.split('.').pop() : ''
        if (oldExt !== newExt) {
          isConfirming.current = true
          const confirmed = window.confirm('If you change a file name extension, the file might become unusable.\nAre you sure you want to change it?')
          isConfirming.current = false
          if (!confirmed) {
            setTimeout(() => inputRef.current?.focus(), 0)
            return
          }
        }
      }
      onSubmit(item, newName)
    }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div
      className={`tree-node ${item.isDirectory ? 'folder' : 'file'}`}
      style={{ paddingLeft: `${level * 16 + 8}px`, backgroundColor: 'var(--bg-active, rgba(255, 255, 255, 0.05))' }}
    >
      <div className="tree-icon">
        {item.isDirectory ? (
          <ChevronRight size={14} className="chevron" style={{ visibility: 'hidden' }} />
        ) : <span className="chevron-placeholder"></span>}
        {item.isDirectory ? <Folder size={16} className="icon-folder" /> : <FileCode size={16} className="icon-file" />}
      </div>
      <input
        ref={inputRef}
        className="rename-item-input"
        spellCheck={false}
        style={{
          flex: 1,
          backgroundColor: 'var(--bg-dark, #1e1e1e)',
          border: '2px solid var(--accent-color, #007acc)',
          color: 'var(--text-primary, #ffffff)',
          outline: 'none',
          padding: '2px 4px',
          marginLeft: '4px',
          marginRight: '4px',
          fontSize: 'inherit',
          fontFamily: 'inherit',
          borderRadius: '3px'
        }}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}

// Row-level view for a tree node. Split into its own component so
// the diagnostic-count subscription is scoped narrowly — a single
// file changing its error count only rerenders that row, not the
// whole subtree.
const TreeNodeRow = ({ item, level, isSelected, isOpen, onClick, onContextMenu, isRenaming, onRenameSubmit, onRenameCancel, siblings }) => {
  // Direct subscriptions so this row updates the instant its
  // diagnostic status changes.
  const fileCounts = useFileCounts(item.isDirectory ? '' : item.path)
  const folderCounts = useFolderCounts(item.isDirectory ? item.path : '')
  const counts = item.isDirectory ? folderCounts : fileCounts
  const hasError = counts.error > 0
  const hasWarn = counts.warning > 0
  const stateClass = hasError ? 'has-error' : hasWarn ? 'has-warning' : ''

  if (isRenaming) {
    return <RenameItemInput initialName={item.name} onSubmit={onRenameSubmit} onCancel={onRenameCancel} level={level} item={item} siblings={siblings} />
  }

  return (
    <div
      className={`tree-node ${item.isDirectory ? 'folder' : 'file'} ${isSelected ? 'selected' : ''} ${stateClass}`}
      style={{ paddingLeft: `${level * 16 + 8}px` }}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, item) }}
    >
      <div className="tree-icon">
        {item.isDirectory ? (
          isOpen ? <ChevronDown size={14} className="chevron" /> : <ChevronRight size={14} className="chevron" />
        ) : <span className="chevron-placeholder"></span>}

        {item.isDirectory ? (
          isOpen ? <FolderOpen size={16} className="icon-folder" /> : <Folder size={16} className="icon-folder" />
        ) : (
          <FileCode size={16} className="icon-file" />
        )}
      </div>
      <span className="tree-label">{item.name}</span>
      <DiagnosticBadge path={item.path} isDirectory={item.isDirectory} />
    </div>
  )
}

// Recursive Tree Node Component
const FileTreeNode = ({
  item, level = 0, siblings,
  selectedPath, setSelectedPath, selectedIsFolder, setSelectedIsFolder,
  creatingItem, onSubmitCreate, onCancelCreate,
  collapseSignal, refreshSignal,
  onOpenFile, onContextMenu, renamingItem, onRenameSubmit, onRenameCancel
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [children, setChildren] = useState(null)
  const [isLoading, setIsLoading] = useState(false)

  const isSelected = selectedPath === item.path

  // Handle collapse signal
  useEffect(() => {
    if (collapseSignal > 0) setIsOpen(false)
  }, [collapseSignal])

  // Handle refresh signal
  useEffect(() => {
    if (refreshSignal > 0 && isOpen && item.isDirectory) {
      loadChildren()
    }
  }, [refreshSignal])

  // Auto-open if we are creating an item inside this folder
  useEffect(() => {
    if (creatingItem && creatingItem.targetDir === item.path && !isOpen && item.isDirectory) {
      setIsOpen(true)
      loadChildren()
    }
  }, [creatingItem])

  const loadChildren = async () => {
    setIsLoading(true)
    const data = await window.api.readDirectory(item.path)
    setChildren(data || [])
    setIsLoading(false)
  }

  const handleClick = (e) => {
    e.stopPropagation()
    setSelectedPath(item.path)
    setSelectedIsFolder(item.isDirectory)

    if (item.isDirectory) {
      if (!isOpen && !children) {
        loadChildren()
      }
      setIsOpen(!isOpen)
    } else {
      if (onOpenFile) onOpenFile(item.path, item.name)
    }
  }

  return (
    <div className="tree-node-container">
      <TreeNodeRow
        item={item}
        level={level}
        isSelected={isSelected}
        isOpen={isOpen}
        onClick={handleClick}
        onContextMenu={onContextMenu}
        isRenaming={renamingItem === item.path}
        onRenameSubmit={onRenameSubmit}
        onRenameCancel={onRenameCancel}
        siblings={siblings}
      />

      {item.isDirectory && isOpen && (
        <div className="tree-children">
          {creatingItem && creatingItem.targetDir === item.path && (
            <NewItemInput
              type={creatingItem.type}
              level={level + 1}
              onSubmit={onSubmitCreate}
              onCancel={onCancelCreate}
            />
          )}
          {isLoading && <div className="tree-loading" style={{ paddingLeft: `${(level + 1) * 16 + 28}px` }}>Loading...</div>}
          {children && children.map((child, idx) => (
            <FileTreeNode
              key={`${child.path}-${idx}`}
              item={child}
              level={level + 1}
              siblings={children}
              selectedPath={selectedPath}
              setSelectedPath={setSelectedPath}
              selectedIsFolder={selectedIsFolder}
              setSelectedIsFolder={setSelectedIsFolder}
              creatingItem={creatingItem}
              onSubmitCreate={onSubmitCreate}
              onCancelCreate={onCancelCreate}
              collapseSignal={collapseSignal}
              refreshSignal={refreshSignal}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
              renamingItem={renamingItem}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export const Sidebar = ({
  projectRoot,
  setProjectRoot,
  onOpenFile,
  width,
  setShowVisualizer
}) => {
  const [rootChildren, setRootChildren] = useState([])

  // Selection State
  const [selectedPath, setSelectedPath] = useState(null)
  const [selectedIsFolder, setSelectedIsFolder] = useState(false)

  // Action State
  const [isRootOpen, setIsRootOpen] = useState(true)
  const [collapseSignal, setCollapseSignal] = useState(0)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [creatingItem, setCreatingItem] = useState(null) // { type: 'file'|'folder', targetDir: string }
  const [contextMenu, setContextMenu] = useState(null)
  const [clipboard, setClipboard] = useState(null)
  const [renamingItem, setRenamingItem] = useState(null) // path of item being renamed

  const [dialog, setDialog] = useState(null)

  useEffect(() => {
    const closeMenu = () => setContextMenu(null)
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [])

  const handleSelectFolder = async () => {
    const folderPath = await window.api.selectFolder()
    if (folderPath) {
      setProjectRoot(folderPath)
      setSelectedPath(folderPath)
      setSelectedIsFolder(true)
      setIsRootOpen(true)
      const data = await window.api.readDirectory(folderPath)
      setRootChildren(data || [])
    }
  }

  const handleRefresh = async () => {
    if (projectRoot) {
      setRefreshSignal(s => s + 1)
      const data = await window.api.readDirectory(projectRoot)
      setRootChildren(data || [])
    }
  }

  const handleContextMenu = (e, item) => {
    let x = e.clientX
    let y = e.clientY

    // Estimate menu size based on its contents
    const menuWidth = 240;
    const menuHeight = 380;

    // Clamp to window bounds
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight;
    }

    // Ensure we don't go off the top/left edge if the window is tiny
    x = Math.max(8, x);
    y = Math.max(8, y);

    setContextMenu({ x, y, targetItem: item })

    if (clipboard) {
      window.api.readClipboardText().then(res => {
        if (res.success && res.text !== `[COMPILE-IDE-FILE]:${clipboard.path}`) {
          setClipboard(null)
        }
      })
    }
  }

  const handleRevealInExplorer = (item) => {
    window.api.revealInExplorer(item.path)
    setContextMenu(null)
  }

  const handleCut = (item) => {
    setClipboard({ action: 'cut', path: item.path })
    window.api.writeClipboardText(`[COMPILE-IDE-FILE]:${item.path}`)
    setContextMenu(null)
  }

  const handleCopy = (item) => {
    setClipboard({ action: 'copy', path: item.path })
    window.api.writeClipboardText(`[COMPILE-IDE-FILE]:${item.path}`)
    setContextMenu(null)
  }

  const handlePaste = async (item) => {
    setContextMenu(null)
    const destFolder = item.isDirectory ? item.path : getParentPath(item.path)

    // Try OS clipboard first (images or files copied from Windows)
    const osRes = await window.api.pasteFromOsClipboard(destFolder)
    if (osRes.success) {
      handleRefresh()
      return
    }

    // Fallback to internal clipboard
    if (!clipboard) {
      setDialog({ type: 'alert', title: 'Paste Failed', message: osRes.error || 'No image or file found in clipboard' })
      return
    }

    const fileName = clipboard.path.split(/[/\\]/).pop()
    let destPath = `${destFolder}/${fileName}`

    const normalizedClipboardPath = clipboard.path.replace(/\\/g, '/')
    const normalizedDestPath = destPath.replace(/\\/g, '/')

    if (clipboard.action === 'cut') {
      if (normalizedClipboardPath === normalizedDestPath) {
        setClipboard(null)
        return
      }
      const res = await window.api.renameItem(clipboard.path, destPath, projectRoot)
      if (res.success) {
        setClipboard(null)
        handleRefresh()
        window.dispatchEvent(new CustomEvent('file-renamed', { detail: { oldPath: clipboard.path, newPath: destPath, newName: fileName } }))
      } else {
        setDialog({ type: 'alert', title: 'Cut Failed', message: res.error })
      }
    } else {
      if (normalizedClipboardPath === normalizedDestPath) {
         const parts = fileName.split('.');
         const ext = parts.length > 1 ? `.${parts.pop()}` : '';
         const base = parts.join('.');
         destPath = `${destFolder}/${base} copy${ext}`;
      }
      const attemptCopy = async (mode = '') => {
        const res = await window.api.copyItem(clipboard.path, destPath, projectRoot, mode)
        if (res.success) {
          handleRefresh()
        } else if (res.error === 'exists') {
          setDialog({
            type: 'confirm',
            title: 'File Exists',
            message: `File ${destPath.split(/[/\\]/).pop()} already exists. Replace?`,
            onConfirm: () => {
              attemptCopy('overwrite')
              setDialog(null)
            },
            onCancel: () => setDialog(null)
          })
        } else {
          setDialog({ type: 'alert', title: 'Copy Failed', message: res.error })
        }
      }
      attemptCopy()
    }
  }

  const handleCopyPath = async (item) => {
    try {
      if (window.api.writeClipboardText) {
        await window.api.writeClipboardText(item.path)
      } else {
        await navigator.clipboard.writeText(item.path)
      }
      setDialog({ type: 'alert', title: 'Path Copied', message: `Copied path to clipboard:\n${item.path}`, onConfirm: () => setDialog(null) })
    } catch (err) {
      console.error(err)
      setDialog({ type: 'alert', title: 'Copy Failed', message: err.message, onConfirm: () => setDialog(null) })
    }
    setContextMenu(null)
  }

  const handleCopyRelativePath = async (item) => {
    const rel = item.path.replace(projectRoot, '').replace(/^[/\\]/, '')
    try {
      if (window.api.writeClipboardText) {
        await window.api.writeClipboardText(rel)
      } else {
        await navigator.clipboard.writeText(rel)
      }
      setDialog({ type: 'alert', title: 'Relative Path Copied', message: `Copied relative path to clipboard:\n${rel}`, onConfirm: () => setDialog(null) })
    } catch (err) {
      console.error(err)
      setDialog({ type: 'alert', title: 'Copy Failed', message: err.message, onConfirm: () => setDialog(null) })
    }
    setContextMenu(null)
  }

  const handleRenameStart = (item) => {
    setRenamingItem(item.path)
    setContextMenu(null)
  }

  const handleRenameSubmit = async (item, newName) => {
    const oldPath = item.path
    const newPath = `${getParentPath(oldPath)}/${newName}`
    const res = await window.api.renameItem(oldPath, newPath, projectRoot)
    if (res.success) {
      setRenamingItem(null)
      handleRefresh()
      window.dispatchEvent(new CustomEvent('file-renamed', { detail: { oldPath, newPath, newName } }))
    } else {
      console.error(res.error)
      setDialog({ type: 'alert', title: 'Rename Failed', message: res.error, onConfirm: () => setDialog(null) })
    }
  }

  const handleRenameCancel = () => setRenamingItem(null)

  const handleDelete = async (item) => {
    setContextMenu(null)
    setDialog({
      type: 'confirm',
      title: 'Confirm Delete',
      message: `Are you sure you want to delete '${item.name}'?`,
      onConfirm: async () => {
        setDialog(null)
        const res = await window.api.deleteItem(item.path, projectRoot)
        if (res.success) {
          handleRefresh()
          window.dispatchEvent(new CustomEvent('file-deleted', { detail: { path: item.path } }))
        } else {
          setDialog({ type: 'alert', title: 'Delete Failed', message: res.error, onConfirm: () => setDialog(null) })
        }
      },
      onCancel: () => setDialog(null)
    })
  }

  const handleDeletePermanent = async (item) => {
    setContextMenu(null)
    setDialog({
      type: 'confirm',
      title: 'Permanent Delete',
      message: `Are you sure you want to permanently delete '${item.name}'? This cannot be undone.`,
      onConfirm: async () => {
        setDialog(null)
        const res = await window.api.deleteItemPermanent(item.path, projectRoot)
        if (res.success) {
          handleRefresh()
          window.dispatchEvent(new CustomEvent('file-deleted', { detail: { path: item.path } }))
        } else {
          console.error(res.error)
          setDialog({ type: 'alert', title: 'Delete Failed', message: res.error, onConfirm: () => setDialog(null) })
        }
      },
      onCancel: () => setDialog(null)
    })
  }

  useEffect(() => {
    const onRefreshSidebar = () => handleRefresh()

    const handleGlobalKeyDown = (e) => {
      // Ignore if a dialog is open to prevent deleting things while interacting with dialogs
      if (document.getElementById('themed-dialog')) return;

      if (e.key === 'Delete' && selectedPath) {
        const activeElem = document.activeElement
        if (activeElem && (activeElem.tagName === 'INPUT' || activeElem.tagName === 'TEXTAREA' || activeElem.classList.contains('inputarea'))) {
          return 
        }
        const itemName = selectedPath.split(/[/\\]/).pop()
        handleDelete({ path: selectedPath, name: itemName, isDirectory: selectedIsFolder })
      }
    }

    if (projectRoot) {
      // Start the backend chokidar watcher
      window.api.watchProject(projectRoot)

      // Listen for file system changes (add/unlink) from the backend
      window.api.onFsChanged((data) => {
        console.log('FS Event:', data)
        handleRefresh()
      })

      // Fetch initial directory structure for the new project root
      handleRefresh()
    }

    const onCreateNewFile = () => handleCreateNew('file')
    const onCreateNewFolder = () => handleCreateNew('folder')
    window.addEventListener('refresh-sidebar', onRefreshSidebar)
    window.addEventListener('create-new-file', onCreateNewFile)
    window.addEventListener('create-new-folder', onCreateNewFolder)
    window.addEventListener('keydown', handleGlobalKeyDown)

    return () => {
      window.removeEventListener('refresh-sidebar', onRefreshSidebar)
      window.removeEventListener('create-new-file', onCreateNewFile)
      window.removeEventListener('create-new-folder', onCreateNewFolder)
      window.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [projectRoot, selectedPath, selectedIsFolder])

  useEffect(() => {
    if (!dialog) return
    const handleDialogKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        dialog.onConfirm && dialog.onConfirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        dialog.onCancel ? dialog.onCancel() : (dialog.onConfirm && dialog.onConfirm())
      }
    }
    window.addEventListener('keydown', handleDialogKey)
    return () => window.removeEventListener('keydown', handleDialogKey)
  }, [dialog])

  const handleCollapseAll = () => {
    setCollapseSignal(s => s + 1)
    setIsRootOpen(false)
  }

  const handleCreateNew = (type) => {
    if (!projectRoot) return
    let targetDir = projectRoot
    if (selectedPath) {
      targetDir = selectedIsFolder ? selectedPath : getParentPath(selectedPath)
    }

    // Auto-open root if creating at root
    if (targetDir === projectRoot) {
      setIsRootOpen(true)
    }

    setCreatingItem({ type, targetDir })
  }

  const handleRootClick = async (e) => {
    e.stopPropagation()
    setSelectedPath(projectRoot)
    setSelectedIsFolder(true)

    if (!isRootOpen && rootChildren.length === 0) {
      const data = await window.api.readDirectory(projectRoot)
      setRootChildren(data || [])
    }

    setIsRootOpen(!isRootOpen)
  }

  const submitCreate = async (name) => {
    if (!creatingItem) return
    const newPath = `${creatingItem.targetDir}/${name}`
    let res
    if (creatingItem.type === 'file') {
      res = await window.api.createFile(newPath)
    } else {
      res = await window.api.createFolder(newPath)
    }

    if (res?.success) {
      setCreatingItem(null)
      handleRefresh()
    } else {
      console.error("Failed to create item:", res?.error)
      setCreatingItem(null)
    }
  }

  const cancelCreate = () => setCreatingItem(null)

  const rootName = projectRoot ? projectRoot.split(/[/\\]/).pop() : ''
  const isRootSelected = selectedPath === projectRoot

  return (
    <aside className="sidebar" style={{ width: width ? `${width}px` : undefined }} onClick={() => setSelectedPath(null)}>
      <div className="sidebar-header">
        <h2>EXPLORER</h2>
      </div>



      <div className="sidebar-content">
        {projectRoot ? (
          <div className="file-tree" onClick={e => e.stopPropagation()} onContextMenu={(e) => { e.preventDefault(); handleContextMenu(e, { path: projectRoot, isDirectory: true, name: rootName }) }}>
            <div
              className={`project-root-label ${isRootSelected ? 'selected' : ''}`}
              onClick={handleRootClick}
            >
              <div className="root-label-left">
                {isRootOpen ? <ChevronDown size={16} className="chevron" /> : <ChevronRight size={16} className="chevron" />}
                {isRootOpen ? <FolderOpen size={18} className="icon-folder" /> : <Folder size={18} className="icon-folder" />}
                <span className="root-name">{rootName}</span>
              </div>

              <div className="sidebar-header-actions">
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setShowVisualizer && setShowVisualizer(true) }} title="Visualize Codebase">
                  <Database size={16} />
                </button>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleCreateNew('file') }} title="New File">
                  <FilePlus size={16} />
                </button>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleCreateNew('folder') }} title="New Folder">
                  <FolderPlus size={16} />
                </button>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleRefresh() }} title="Refresh Explorer">
                  <RefreshCw size={16} />
                </button>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleCollapseAll() }} title="Collapse Folders in Explorer">
                  <Minimize2 size={16} />
                </button>
              </div>
            </div>

            {isRootOpen && creatingItem && creatingItem.targetDir === projectRoot && (
              <NewItemInput
                type={creatingItem.type}
                level={0}
                onSubmit={submitCreate}
                onCancel={cancelCreate}
              />
            )}

            {isRootOpen && rootChildren.map((child, idx) => (
              <FileTreeNode
                key={`${child.path}-${idx}`}
                item={child}
                level={0}
                siblings={rootChildren}
                selectedPath={selectedPath}
                setSelectedPath={setSelectedPath}
                selectedIsFolder={selectedIsFolder}
                setSelectedIsFolder={setSelectedIsFolder}
                creatingItem={creatingItem}
                onSubmitCreate={submitCreate}
                onCancelCreate={cancelCreate}
                collapseSignal={collapseSignal}
                refreshSignal={refreshSignal}
                onOpenFile={onOpenFile}
                onContextMenu={handleContextMenu}
                renamingItem={renamingItem}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={handleRenameCancel}
              />
            ))}
          </div>
        ) : (
          <div className="sidebar-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px 20px', textAlign: 'center', color: 'inherit' }}>
            <FolderSearch size={48} style={{ marginBottom: '16px', opacity: 0.8, color: 'var(--accent-color, #8b5cf6)' }} />
            <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: 'inherit', opacity: 0.9 }}>No Folder Opened</p>
            <p style={{ margin: '0 0 24px 0', fontSize: '12px', lineHeight: 1.5, color: 'inherit', opacity: 0.6 }}>You have not yet opened a workspace. Open a folder to view your files and start coding.</p>
            <button
              onClick={handleSelectFolder}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 14px',
                background: 'transparent',
                color: 'var(--accent-color, #8b5cf6)',
                border: '1px solid var(--accent-color, #8b5cf6)',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'var(--accent-color, #8b5cf6)';
                e.currentTarget.style.color = 'var(--bg-deep, #1e1e1e)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--accent-color, #8b5cf6)';
              }}
            >
              <FolderSearch size={16} />
              Open Folder
            </button>
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          className="editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y, position: 'fixed', zIndex: 1000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="editor-context-menu-item" onClick={() => handleRevealInExplorer(contextMenu.targetItem)}>Reveal in File Explorer</div>
          <div className="editor-context-menu-separator"></div>
          <div className="editor-context-menu-item" onClick={() => handleCut(contextMenu.targetItem)}>Cut</div>
          <div className="editor-context-menu-item" onClick={() => handleCopy(contextMenu.targetItem)}>Copy</div>
          <div className="editor-context-menu-item" onClick={() => handlePaste(contextMenu.targetItem)}>Paste</div>
          <div className="editor-context-menu-separator"></div>
          <div className="editor-context-menu-item" onClick={() => handleCopyPath(contextMenu.targetItem)}>Copy Path</div>
          <div className="editor-context-menu-item" onClick={() => handleCopyRelativePath(contextMenu.targetItem)}>Copy Relative Path</div>
          <div className="editor-context-menu-separator"></div>
          <div className="editor-context-menu-item" onClick={() => handleRenameStart(contextMenu.targetItem)}>Rename</div>
          <div className="editor-context-menu-item delete" onClick={() => handleDelete(contextMenu.targetItem)}>Delete</div>
          <div className="editor-context-menu-item delete-permanent" onClick={() => handleDeletePermanent(contextMenu.targetItem)} style={{ color: '#f48771' }}>Delete Permanently</div>
        </div>
      )}

      {/* Themed Dialog for Alerts & Confirms */}
      {dialog && (
        <div id="themed-dialog" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-surface, #1e1e1e)', padding: '24px', borderRadius: '8px',
            width: '400px', maxWidth: '90%', border: '1px solid var(--border-subtle, #333)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
          }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: 'var(--text-primary)' }}>{dialog.title}</h3>
            <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{dialog.message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              {dialog.type === 'confirm' && (
                <button
                  onClick={dialog.onCancel}
                  style={{ padding: '6px 16px', background: 'transparent', border: '1px solid var(--border-subtle, #333)', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              )}
              <button
                onClick={dialog.onConfirm || (() => setDialog(null))}
                style={{ padding: '6px 16px', backgroundColor: 'var(--accent-color, #e0a96d)', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
