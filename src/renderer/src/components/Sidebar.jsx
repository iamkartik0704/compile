import React, { useState, useEffect, useRef } from 'react'
import { Folder, FolderOpen, FileCode, ChevronRight, ChevronDown, FolderSearch, FilePlus, FolderPlus, RefreshCw, Minimize2 } from 'lucide-react'

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
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}

// Recursive Tree Node Component
const FileTreeNode = ({ 
  item, level = 0, 
  selectedPath, setSelectedPath, selectedIsFolder, setSelectedIsFolder,
  creatingItem, onSubmitCreate, onCancelCreate,
  collapseSignal, refreshSignal,
  onOpenFile
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
      <div 
        className={`tree-node ${item.isDirectory ? 'folder' : 'file'} ${isSelected ? 'selected' : ''}`} 
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
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
      </div>

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
  width
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

  useEffect(() => {
    const onRefreshSidebar = () => handleRefresh()
    window.addEventListener('refresh-sidebar', onRefreshSidebar)
    
    if (projectRoot) {
      // Start the backend chokidar watcher
      window.api.watchProject(projectRoot)
      
      // Listen for file system changes (add/unlink) from the backend
      window.api.onFsChanged((data) => {
        console.log('FS Event:', data)
        handleRefresh()
      })
    }
    
    return () => window.removeEventListener('refresh-sidebar', onRefreshSidebar)
  }, [projectRoot])

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
      
      {!projectRoot && (
        <div className="sidebar-actions">
          <button className="btn-open-folder" onClick={handleSelectFolder}>
            <FolderSearch size={16} />
            <span>Open Folder</span>
          </button>
        </div>
      )}

      <div className="sidebar-content">
        {projectRoot ? (
          <div className="file-tree" onClick={e => e.stopPropagation()}>
            <div 
              className={`project-root-label ${isRootSelected ? 'selected' : ''}`}
              onClick={handleRootClick}
            >
              <div className="root-label-left">
                {isRootOpen ? <ChevronDown size={14} className="chevron" /> : <ChevronRight size={14} className="chevron" />}
                {isRootOpen ? <FolderOpen size={16} className="icon-folder" /> : <Folder size={16} className="icon-folder" />}
                <span className="root-name">{rootName}</span>
              </div>
              
              <div className="sidebar-header-actions">
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
              />
            ))}
          </div>
        ) : (
          <div className="empty-workspace">
            <p>You have not yet opened a folder.</p>
          </div>
        )}
      </div>
    </aside>
  )
}
