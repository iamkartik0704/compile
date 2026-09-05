import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ReactFlow, Controls, Background, applyNodeChanges, applyEdgeChanges, Handle, Position, MarkerType, useReactFlow, ReactFlowProvider, MiniMap } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { initTreeSitter } from '../utils/astParser'
import dagre from 'dagre'
import { FileCode, FileJson, FileType, File, Box, Database, Terminal, Folder, ChevronUp, ChevronDown, BoxSelect, Cuboid } from 'lucide-react'
import ForceGraph3D from 'react-force-graph-3d'

// Layout helpers
const getDagreLayout = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  
  const nodeWidth = 260
  const nodeHeight = 150
  
  dagreGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 120 })
  
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight })
  })
  
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })
  
  dagre.layout(dagreGraph)
  
  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    }
    node.targetPosition = direction === 'LR' ? Position.Left : Position.Top
    node.sourcePosition = direction === 'LR' ? Position.Right : Position.Bottom
  })
  
  return { nodes, edges }
}

const getFolderLayout = (nodes, edges, collState, onToggle) => {
  const nodeWidth = 260
  const nodeHeight = 150
  const paddingX = 30
  const paddingY = 30
  const headerHeight = 50
  const MAX_COLS = 4

  const folders = {}
  nodes.forEach(node => {
    if (node.type === 'custom') {
      const dir = node.id.substring(0, Math.max(node.id.lastIndexOf('\\'), node.id.lastIndexOf('/'))) || 'Root'
      if (!folders[dir]) folders[dir] = []
      folders[dir].push(node)
    }
  })

  const newNodes = []
  let currentY = 0
  const folderGap = 40

  Object.keys(folders).sort().forEach((dir) => {
    const isCollapsed = collState[dir] !== false // default collapsed (true)
    const children = folders[dir]
    
    const cols = Math.min(children.length, MAX_COLS)
    const rows = Math.ceil(children.length / MAX_COLS)
    const groupWidth = isCollapsed ? 350 : (cols * nodeWidth) + ((cols + 1) * paddingX)
    const groupHeight = isCollapsed ? headerHeight : headerHeight + (rows * (nodeHeight + paddingY)) + paddingY
    
    newNodes.push({
      id: `folder-${dir}`,
      type: 'folderGroup',
      position: { x: 0, y: currentY },
      data: { 
        label: dir.split(/[\\/]/).pop(), 
        collapsed: isCollapsed,
        onToggle: () => onToggle(dir),
        width: groupWidth,
        height: groupHeight,
        fileCount: children.length
      },
      style: { width: groupWidth, height: groupHeight }
    })

    children.forEach((node, idx) => {
      const col = idx % MAX_COLS
      const row = Math.floor(idx / MAX_COLS)
      node.parentId = `folder-${dir}`
      node.extent = 'parent'
      node.position = {
        x: paddingX + col * (nodeWidth + paddingX),
        y: headerHeight + paddingY + row * (nodeHeight + paddingY)
      }
      node.targetPosition = Position.Top
      node.sourcePosition = Position.Bottom
      node.data.folder = dir
      node.hidden = isCollapsed
      newNodes.push(node)
    })

    currentY += groupHeight + folderGap
  })

  // Build file-to-folder lookup
  const fileToFolder = {}
  nodes.forEach(node => {
    if (node.type === 'custom') {
      const dir = node.id.substring(0, Math.max(node.id.lastIndexOf('\\'), node.id.lastIndexOf('/'))) || 'Root'
      fileToFolder[node.id] = dir
    }
  })

  // Generate folder-to-folder edges from file-level edges
  const folderEdgeSet = new Set()
  const folderEdges = []
  edges.forEach(edge => {
    const srcFolder = fileToFolder[edge.source]
    const tgtFolder = fileToFolder[edge.target]
    if (!srcFolder || !tgtFolder) return
    if (srcFolder === tgtFolder) return // skip intra-folder edges (they show when expanded)
    
    const srcCollapsed = collState[srcFolder] !== false
    const tgtCollapsed = collState[tgtFolder] !== false
    
    // Show folder edge if at least one end is collapsed
    if (srcCollapsed || tgtCollapsed) {
      const fSrc = srcCollapsed ? `folder-${srcFolder}` : edge.source
      const fTgt = tgtCollapsed ? `folder-${tgtFolder}` : edge.target
      const fEdgeId = `fe-${fSrc}-${fTgt}`
      if (!folderEdgeSet.has(fEdgeId)) {
        folderEdgeSet.add(fEdgeId)
        folderEdges.push({
          id: fEdgeId,
          source: fSrc,
          target: fTgt,
          animated: true,
          style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.6 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' }
        })
      }
    }
  })

  return { nodes: newNodes, edges: [...edges, ...folderEdges] }
}

const getLanguageConfig = (ext, type) => {
  const map = {
    javascript: { color: '#F7DF1E', bg: 'rgba(247, 223, 30, 0.1)', icon: FileCode },
    typescript: { color: '#3178C6', bg: 'rgba(49, 120, 198, 0.1)', icon: FileType },
    python: { color: '#3776AB', bg: 'rgba(55, 118, 171, 0.1)', icon: Terminal },
    json: { color: '#000000', bg: 'rgba(255, 255, 255, 0.05)', icon: FileJson },
    css: { color: '#264de4', bg: 'rgba(38, 77, 228, 0.1)', icon: FileCode },
    default: { color: '#A0AEC0', bg: 'rgba(160, 174, 192, 0.1)', icon: File }
  }
  return map[type] || map[ext] || map.default
}

const CustomNode = ({ data }) => {
  const { ext, type, label, exports } = data
  const config = getLanguageConfig(ext, type)
  const Icon = config.icon

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${config.color}55`,
        borderRadius: '12px',
        color: 'var(--text-primary)',
        width: '260px',
        boxShadow: `0 8px 32px 0 rgba(0, 0, 0, 0.3), inset 0 0 0 1px ${config.color}22`,
        overflow: 'hidden',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        cursor: 'pointer'
      }}
      className="custom-node"
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = `0 12px 40px 0 ${config.color}33, inset 0 0 0 1px ${config.color}44`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = `0 8px 32px 0 rgba(0, 0, 0, 0.3), inset 0 0 0 1px ${config.color}22`
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: config.color, width: '12px', height: '12px', top: '-6px', border: '2px solid var(--bg-deep)' }} />

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px 16px',
        background: `linear-gradient(90deg, ${config.bg} 0%, transparent 100%)`,
        borderBottom: '1px solid var(--border-base)'
      }}>
        <div style={{ 
          width: '32px', height: '32px', borderRadius: '8px', 
          background: config.color, display: 'flex', alignItems: 'center', 
          justifyContent: 'center', color: '#fff' 
        }}>
          <Icon size={18} strokeWidth={2.5} color={['#F7DF1E', '#ffffff'].includes(config.color) ? '#000' : '#fff'} />
        </div>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ fontWeight: '600', fontSize: '14px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            {label}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>{type || ext || 'file'}</span>
            {data.folder && (
              <>
                <span style={{ opacity: 0.5 }}>•</span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100px' }} title={data.folder}>
                  {data.folder.split(/[\\/]/).pop()}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 16px', minHeight: '60px' }}>
        {exports && exports.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {exports.map((ex, i) => (
              <div key={i} style={{
                fontSize: '12px',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <Box size={12} color={config.color} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ex}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No exports detected.
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: config.color, width: '12px', height: '12px', bottom: '-6px', border: '2px solid var(--bg-deep)' }} />
    </div>
  )
}

const FolderGroupNode = ({ data, selected }) => {
  return (
    <div style={{
      width: data.width,
      height: data.height,
      background: 'var(--bg-elevated)',
      border: `1px solid ${selected ? 'var(--accent-color)' : 'var(--border-base)'}`,
      borderRadius: '8px',
      transition: 'all 0.2s ease',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'
    }}>
      <div style={{
        background: 'var(--bg-activity)',
        padding: '8px 12px',
        borderBottom: data.collapsed ? 'none' : '1px solid var(--border-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: data.collapsed ? '8px' : '8px 8px 0 0'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-bright)', fontSize: '13px', fontWeight: '600' }}>
          <Folder size={16} color="var(--accent-color)" />
          {data.label}
          <span style={{ 
            fontSize: '11px', 
            color: 'var(--text-muted)', 
            background: 'var(--bg-deep)', 
            padding: '1px 8px', 
            borderRadius: '10px',
            fontWeight: '500'
          }}>
            {data.fileCount}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onToggle();
          }}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px', borderRadius: '4px' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          {data.collapsed ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}
        </button>
      </div>
      <Handle type="target" position={Position.Top} style={{ background: '#8b5cf6', width: '10px', height: '10px', top: '-5px', border: '2px solid var(--bg-deep)', opacity: data.collapsed ? 1 : 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#8b5cf6', width: '10px', height: '10px', bottom: '-5px', border: '2px solid var(--bg-deep)', opacity: data.collapsed ? 1 : 0 }} />
    </div>
  )
}

const nodeTypes = { custom: CustomNode, folderGroup: FolderGroupNode }

function VisualizerFlow({ projectRoot, onClose, onFileSelect }) {
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [loading, setLoading] = useState(true)
  const [layoutMode, setLayoutMode] = useState('folder')
  const { fitView } = useReactFlow()
  const [searchQuery, setSearchQuery] = useState('')

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])

  const [rawNodes, setRawNodes] = useState([])
  const [rawEdges, setRawEdges] = useState([])
  const [collapsedFolders, setCollapsedFolders] = useState({})

  const toggleFolder = useCallback((folderId) => {
    setCollapsedFolders(prev => {
      const wasExpanded = prev[folderId] === false
      return { ...prev, [folderId]: wasExpanded ? true : false }
    })
  }, [])

  const expandAllFolders = useCallback(() => {
    const expanded = {}
    rawNodes.forEach(n => {
      if (n.type === 'custom') {
        const dir = n.id.substring(0, Math.max(n.id.lastIndexOf('\\'), n.id.lastIndexOf('/'))) || 'Root'
        expanded[dir] = false
      }
    })
    setCollapsedFolders(expanded)
  }, [rawNodes])

  const collapseAllFolders = useCallback(() => {
    setCollapsedFolders({})
  }, [])

  const runLayout = useCallback((nodes, edges, mode, collState) => {
    if (mode === 'dagre') {
      return getDagreLayout(nodes, edges)
    } else {
      return getFolderLayout(nodes, edges, collState, toggleFolder)
    }
  }, [toggleFolder])

  const [loadProgress, setLoadProgress] = useState('')
  const [fileCount, setFileCount] = useState(0)
  const [totalFiles, setTotalFiles] = useState(0)

  // Parse files ONCE
  useEffect(() => {
    let active = true
    async function buildGraph() {
      if (!projectRoot) return
      setLoading(true)
      setLoadProgress('Scanning project tree...')
      
      let allFiles = await window.api.getProjectTree(projectRoot)
      if (!allFiles || !active) return

      // Filter out binary / non-useful files early
      const SKIP_EXTS = new Set([
        'png','jpg','jpeg','gif','svg','ico','webp','bmp','tiff',
        'woff','woff2','ttf','eot','otf',
        'mp3','mp4','wav','ogg','webm','avi','mov',
        'zip','tar','gz','rar','7z',
        'pdf','doc','docx','xls','xlsx','ppt','pptx',
        'exe','dll','so','dylib','o','obj','class',
        'lock','map','min.js','min.css',
        'DS_Store','log'
      ])
      
      allFiles = allFiles.filter(f => {
        const ext = f.split('.').pop().toLowerCase()
        return !SKIP_EXTS.has(ext)
      })

      // Cap at 500 files for performance  
      const MAX_FILES = 500
      const wasCapped = allFiles.length > MAX_FILES
      if (wasCapped) {
        allFiles = allFiles.slice(0, MAX_FILES)
      }

      setTotalFiles(allFiles.length)

      // Build a filename lookup map for O(1) import resolution
      const fileBasenameMap = new Map() // basename (no ext) -> [fullPaths]
      allFiles.forEach(fp => {
        const base = fp.split(/[\\/]/).pop().split('.')[0]
        if (!fileBasenameMap.has(base)) fileBasenameMap.set(base, [])
        fileBasenameMap.get(base).push(fp)
      })

      // Code extensions we'll actually parse
      const CODE_EXTS = new Set(['js','jsx','ts','tsx','py','c','cpp','h','hpp','java','go','rs'])
      const EXT_TO_LANG = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', cpp: 'cpp', hpp: 'cpp', c: 'c', h: 'c', java: 'java', go: 'go', rs: 'rust' }

      // Pre-initialize tree-sitter parsers (once per language)
      const parsers = {}
      setLoadProgress('Initializing parsers...')
      const langSet = new Set()
      allFiles.forEach(f => {
        const ext = f.split('.').pop().toLowerCase()
        if (EXT_TO_LANG[ext]) langSet.add(EXT_TO_LANG[ext])
      })
      for (const lang of langSet) {
        try {
          parsers[lang] = await initTreeSitter(lang)
        } catch (e) { /* parser not available */ }
      }

      const newNodes = []
      const newEdges = []
      const edgeIdSet = new Set()
      const CHUNK_SIZE = 30
      let processed = 0

      for (let i = 0; i < allFiles.length; i += CHUNK_SIZE) {
        if (!active) return
        const chunk = allFiles.slice(i, i + CHUNK_SIZE)

        await Promise.all(chunk.map(async (filePath) => {
          if (!active) return

          const ext = filePath.split('.').pop().toLowerCase()
          const lang = EXT_TO_LANG[ext] || null
          const fileName = filePath.split(/[\\/]/).pop()
          const isCode = CODE_EXTS.has(ext)

          const node = {
            id: filePath,
            type: 'custom',
            position: { x: 0, y: 0 },
            data: { label: fileName, type: lang || ext, ext, exports: [], fullPath: filePath }
          }

          if (isCode) {
            const exports = []
            const importBases = [] // just the basenames we need to resolve

            try {
              const codeRes = await window.api.getFileContents(filePath)
              const code = typeof codeRes === 'string' ? codeRes : (codeRes?.content || '')

              if (code) {
                // Tree-sitter pass
                const parser = parsers[lang]
                if (parser) {
                  try {
                    const tree = parser.parse(code)
                    function walk(n) {
                      const t = n.type
                      if (t === 'class_declaration' || t === 'function_declaration' || t === 'variable_declarator') {
                        for (let j = 0; j < n.childCount; j++) {
                          if (n.child(j).type === 'identifier') {
                            exports.push(n.child(j).text)
                            break
                          }
                        }
                      }
                      for (let j = 0; j < n.childCount; j++) {
                        walk(n.child(j))
                      }
                    }
                    walk(tree.rootNode)
                  } catch (e) { /* parse error */ }
                }

                // Regex imports — extract basename of import path
                const importMatches = [
                  ...code.matchAll(/from\s+['"]([^'"]+)['"]/g),
                  ...code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)
                ]
                importMatches.forEach(m => {
                  const impPath = m[1]
                  // Extract basename: './components/Sidebar' -> 'Sidebar'
                  const base = impPath.split(/[\\/]/).pop().split('.')[0]
                  if (base) importBases.push(base)
                })

                // Regex exports fallback
                const exportMatches = [...code.matchAll(/(?:export\s+)?(?:const|let|var|function|class)\s+([a-zA-Z0-9_]+)/g)]
                exportMatches.forEach(m => exports.push(m[1]))
              }
            } catch (e) { /* file read error */ }

            node.data.exports = [...new Set(exports)].slice(0, 3)

            // O(1) import resolution via lookup map
            for (const base of importBases) {
              const targets = fileBasenameMap.get(base)
              if (!targets) continue
              for (const targetFile of targets) {
                if (targetFile === filePath) continue
                const edgeId = `e-${targetFile}-${filePath}`
                if (!edgeIdSet.has(edgeId)) {
                  edgeIdSet.add(edgeId)
                  newEdges.push({
                    id: edgeId,
                    source: targetFile,
                    target: filePath,
                    animated: true,
                    style: { stroke: '#4f46e5', strokeWidth: 2, opacity: 0.8 },
                    markerEnd: { type: MarkerType.ArrowClosed, color: '#4f46e5' }
                  })
                }
              }
            }
          }

          newNodes.push(node)
        }))

        processed += chunk.length
        setFileCount(processed)
        setLoadProgress(`Parsing files... ${Math.min(processed, allFiles.length)}/${allFiles.length}`)
        
        // Yield to the UI thread
        await new Promise(r => setTimeout(r, 0))
      }

      if (wasCapped) {
        setLoadProgress(`Showing first ${MAX_FILES} files. Use filters to narrow down.`)
      }

      setRawNodes(newNodes)
      setRawEdges(newEdges)
      setLoading(false)
    }

    buildGraph()
    return () => { active = false }
  }, [projectRoot])

  const [hideOrphans, setHideOrphans] = useState(false)
  const [hideNonCode, setHideNonCode] = useState(false)
  const [viewMode, setViewMode] = useState('2D')
  const fgRef = useRef(null)

  // Run Layout on layoutMode, collapsedFolders, or filter change
  useEffect(() => {
    if (rawNodes.length === 0) return
    
    let filteredNodes = rawNodes.map(n => ({ ...n, data: { ...n.data } }))
    let filteredEdges = rawEdges.map(e => ({ ...e }))
    
    if (hideNonCode) {
      const codeExts = ['js','jsx','ts','tsx','py','c','cpp','h','hpp','java','go','rs']
      filteredNodes = filteredNodes.filter(n => n.type !== 'custom' || codeExts.includes(n.data.ext))
    }
    
    if (hideOrphans) {
      const connectedIds = new Set()
      filteredEdges.forEach(e => {
        connectedIds.add(e.source)
        connectedIds.add(e.target)
      })
      filteredNodes = filteredNodes.filter(n => n.type !== 'custom' || connectedIds.has(n.id))
    }
    
    const nodeIds = new Set(filteredNodes.map(n => n.id))
    filteredEdges = filteredEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    
    const { nodes: layoutedNodes, edges: layoutedEdges } = runLayout(filteredNodes, filteredEdges, layoutMode, collapsedFolders)
    
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
    setTimeout(() => fitView({ padding: 0.2, duration: 800 }), 50)
  }, [rawNodes, rawEdges, layoutMode, collapsedFolders, runLayout, fitView, hideOrphans, hideNonCode])

  // Filter nodes visually by search query
  const displayNodes = useMemo(() => {
    if (!searchQuery) return nodes
    const lowerQ = searchQuery.toLowerCase()
    return nodes.map(n => ({
      ...n,
      style: {
        ...n.style,
        opacity: n.data.label && n.data.label.toLowerCase().includes(lowerQ) ? 1 : 0.2,
        transform: n.data.label && n.data.label.toLowerCase().includes(lowerQ) ? 'scale(1.05)' : 'scale(1)',
        transition: 'all 0.3s ease'
      }
    }))
  }, [nodes, searchQuery])

  const onEdgeClick = useCallback((event, edge) => {
    setEdges((eds) => eds.map((e) => {
      if (e.id === edge.id) {
        return { 
          ...e, 
          style: { ...e.style, stroke: '#06b6d4', strokeWidth: 4, filter: 'drop-shadow(0 0 8px rgba(6, 182, 212, 0.8))' }, 
          markerEnd: { type: MarkerType.ArrowClosed, color: '#06b6d4' },
          zIndex: 1000
        }
      }
      return { 
        ...e, 
        style: { stroke: '#4f46e5', strokeWidth: 2, opacity: 0.3 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#4f46e5' },
        zIndex: 1
      }
    }))
  }, [setEdges])

  const onPaneClick = useCallback(() => {
    setEdges((eds) => eds.map((e) => ({
      ...e,
      style: { stroke: '#4f46e5', strokeWidth: 2, opacity: 0.8, filter: 'none' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#4f46e5' },
      zIndex: 1
    })))
  }, [setEdges])

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-deep)', zIndex: 100, display: 'flex', flexDirection: 'column', fontFamily: 'Inter, sans-serif' }}>
      <div style={{
        padding: '16px 24px',
        background: 'var(--bg-activity)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border-base)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Database color="var(--accent-color)" size={22} />
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600', background: 'linear-gradient(90deg, var(--text-bright), var(--text-muted))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Codebase Visualizer
          </h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Search Bar */}
          <input
            type="text"
            placeholder="Find file..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-primary)',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '13px',
              outline: 'none',
              width: '180px'
            }}
          />
          <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: '6px', padding: '4px', gap: '4px', border: '1px solid var(--border-base)' }}>
            <button
              onClick={() => setHideOrphans(v => !v)}
              style={{
                background: hideOrphans ? 'var(--accent-color)' : 'transparent',
                color: hideOrphans ? 'var(--accent-text)' : 'var(--text-muted)',
                border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '500', transition: 'all 0.2s'
              }}
            >
              Hide Orphans
            </button>
            <button
              onClick={() => setHideNonCode(v => !v)}
              style={{
                background: hideNonCode ? 'var(--accent-color)' : 'transparent',
                color: hideNonCode ? 'var(--accent-text)' : 'var(--text-muted)',
                border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '500', transition: 'all 0.2s'
              }}
            >
              Code Only
            </button>
          </div>
          
          {/* View Mode Toggle */}
          <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: '6px', padding: '4px', gap: '4px', border: '1px solid var(--border-base)' }}>
            <button
              onClick={() => setViewMode('2D')}
              style={{
                background: viewMode === '2D' ? 'var(--bg-elevated)' : 'transparent',
                color: viewMode === '2D' ? 'var(--text-bright)' : 'var(--text-muted)',
                border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '500', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px'
              }}
            >
              <BoxSelect size={14} /> 2D
            </button>
            <button
              onClick={() => setViewMode('3D')}
              style={{
                background: viewMode === '3D' ? 'var(--bg-elevated)' : 'transparent',
                color: viewMode === '3D' ? 'var(--text-bright)' : 'var(--text-muted)',
                border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '500', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px'
              }}
            >
              <Cuboid size={14} /> 3D
            </button>
          </div>

          <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: '6px', padding: '4px', gap: '4px', border: '1px solid var(--border-base)', opacity: viewMode === '3D' ? 0.5 : 1, pointerEvents: viewMode === '3D' ? 'none' : 'auto' }}>
            <button
              onClick={() => setLayoutMode('folder')}
              style={{
                background: layoutMode === 'folder' ? 'var(--bg-elevated)' : 'transparent',
                color: layoutMode === 'folder' ? 'var(--text-bright)' : 'var(--text-muted)',
                border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '500', transition: 'all 0.2s'
              }}
            >
              Folder View
            </button>
            <button
              onClick={() => setLayoutMode('dagre')}
              style={{
                background: layoutMode === 'dagre' ? 'var(--bg-elevated)' : 'transparent',
                color: layoutMode === 'dagre' ? 'var(--text-bright)' : 'var(--text-muted)',
                border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '500', transition: 'all 0.2s'
              }}
            >
              Dependency Flow
            </button>
          </div>
          {layoutMode === 'folder' && viewMode === '2D' && (
            <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: '6px', padding: '4px', gap: '4px', border: '1px solid var(--border-base)' }}>
              <button
                onClick={expandAllFolders}
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '500', transition: 'all 0.2s'
                }}
              >
                Expand All
              </button>
              <button
                onClick={collapseAllFolders}
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '500', transition: 'all 0.2s'
                }}
              >
                Collapse All
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-primary)',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
              transition: 'background 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
          >
            Close Diagram
          </button>
        </div>
      </div>
      
      <div style={{ flex: 1, position: 'relative' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', border: '3px solid var(--border-base)', borderTopColor: 'var(--accent-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '15px', letterSpacing: '0.5px' }}>{loadProgress || 'Mapping Project Dependencies...'}</span>
            {totalFiles > 0 && (
              <div style={{ width: '240px', height: '4px', background: 'var(--border-base)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'var(--accent-color)', borderRadius: '2px', transition: 'width 0.3s', width: `${Math.min((fileCount / totalFiles) * 100, 100)}%` }} />
              </div>
            )}
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
        ) : viewMode === '3D' ? (
          <ForceGraph3D
            ref={fgRef}
            graphData={{ nodes: displayNodes, links: edges }}
            nodeLabel={node => node.data.label}
            nodeColor={node => getLanguageConfig(node.data.ext, node.data.type).color}
            linkColor={() => 'rgba(79, 70, 229, 0.4)'}
            linkOpacity={0.6}
            nodeRelSize={6}
            onNodeClick={(node) => {
              if (node.type === 'custom' && onFileSelect) {
                onFileSelect(node.data.fullPath, node.data.label)
              }
              if (fgRef.current) {
                const distance = 100;
                const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z);
                fgRef.current.cameraPosition(
                  { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }, 
                  node, 
                  1500 
                );
              }
            }}
            backgroundColor="#00000000" // transparent so it blends with var(--bg-deep)
          />
        ) : (
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={(e, node) => {
              if (node.type === 'custom') {
                onFileSelect && onFileSelect(node.data.fullPath, node.data.label)
              }
            }}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
            minZoom={0.05}
            maxZoom={2}
            panOnScroll={true}
            zoomOnScroll={false}
            zoomActivationKeyCode="Control"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--text-muted)" variant="dots" gap={20} size={1} opacity={0.15} />
            <Controls style={{ display: 'flex', flexDirection: 'row', gap: '4px' }} position="bottom-center" />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) => getLanguageConfig(node.data.ext, node.data.type).color}
              maskColor="rgba(0, 0, 0, 0.7)"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-base)', borderRadius: '8px', overflow: 'hidden' }}
            />
          </ReactFlow>
        )}
        <style>{`
          .react-flow__controls {
            background: var(--bg-activity) !important;
            border: 1px solid var(--border-base) !important;
            border-radius: 8px !important;
            overflow: hidden;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25) !important;
          }
          .react-flow__controls-button {
            background: var(--bg-activity) !important;
            border: none !important;
            border-right: 1px solid var(--border-base) !important;
            color: var(--text-primary) !important;
            width: 32px !important;
            height: 32px !important;
            transition: background 0.15s ease, color 0.15s ease;
          }
          .react-flow__controls-button:last-child {
            border-right: none !important;
          }
          .react-flow__controls-button:hover {
            background: var(--bg-elevated) !important;
            color: var(--accent-color) !important;
          }
          .react-flow__controls-button svg {
            fill: currentColor !important;
            max-width: 16px;
            max-height: 16px;
          }
        `}</style>
      </div>
    </div>
  )
}

export function CodebaseVisualizer(props) {
  return (
    <ReactFlowProvider>
      <VisualizerFlow {...props} />
    </ReactFlowProvider>
  )
}