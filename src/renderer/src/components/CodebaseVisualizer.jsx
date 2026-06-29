import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { ReactFlow, Controls, Background, applyNodeChanges, applyEdgeChanges, Handle, Position, MarkerType, useReactFlow, ReactFlowProvider, MiniMap } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { initTreeSitter } from '../utils/astParser'
import dagre from 'dagre'
import { FileCode, FileJson, FileType, File, Box, Database, Terminal, Folder, ChevronUp, ChevronDown } from 'lucide-react'

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
  const paddingX = 40
  const paddingY = 40
  const headerHeight = 50

  const folders = {}
  nodes.forEach(node => {
    // Only group file nodes (ignore existing group nodes if any)
    if (node.type === 'custom') {
      const dir = node.id.substring(0, Math.max(node.id.lastIndexOf('\\'), node.id.lastIndexOf('/'))) || 'Root'
      if (!folders[dir]) folders[dir] = []
      folders[dir].push(node)
    }
  })

  const newNodes = []
  
  // Create Folder Groups and assign children
  let currentY = 0
  const folderGap = 60

  Object.keys(folders).sort().forEach((dir) => {
    const isCollapsed = !!collState[dir]
    const children = folders[dir]
    
    // Group dimensions
    const cols = children.length
    const groupWidth = isCollapsed ? 300 : (cols * nodeWidth) + ((cols + 1) * paddingX)
    const groupHeight = isCollapsed ? headerHeight : headerHeight + nodeHeight + paddingY * 2
    
    // Create parent group node
    newNodes.push({
      id: `folder-${dir}`,
      type: 'folderGroup',
      position: { x: 0, y: currentY },
      data: { 
        label: dir.split(/[\\/]/).pop(), 
        collapsed: isCollapsed,
        onToggle: () => onToggle(dir),
        width: groupWidth,
        height: groupHeight
      },
      style: { width: groupWidth, height: groupHeight }
    })

    // Assign children relative positions
    children.forEach((node, colIndex) => {
      node.parentId = `folder-${dir}`
      node.extent = 'parent'
      node.position = {
        x: paddingX + colIndex * (nodeWidth + paddingX),
        y: headerHeight + paddingY
      }
      node.targetPosition = Position.Top
      node.sourcePosition = Position.Bottom
      node.data.folder = dir
      node.hidden = isCollapsed
      newNodes.push(node)
    })

    currentY += groupHeight + folderGap
  })
  
  // Filter edges to hide them if source or target is collapsed
  // Actually ReactFlow natively handles hiding edges if their source or target node has hidden=true!
  return { nodes: newNodes, edges }
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
        borderBottom: '1px solid var(--border-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-bright)', fontSize: '13px', fontWeight: '600' }}>
          <Folder size={16} color="var(--accent-color)" />
          {data.label}
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
    setCollapsedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }))
  }, [])

  const runLayout = useCallback((nodes, edges, mode, collState) => {
    if (mode === 'dagre') {
      return getDagreLayout(nodes, edges)
    } else {
      return getFolderLayout(nodes, edges, collState, toggleFolder)
    }
  }, [toggleFolder])

  // Parse files ONCE
  useEffect(() => {
    let active = true
    async function buildGraph() {
      if (!projectRoot) return
      setLoading(true)
      const allFiles = await window.api.getProjectTree(projectRoot)
      if (!allFiles) return
      
      const newNodes = []
      const newEdges = []
      const CHUNK_SIZE = 50
      
      for (let i = 0; i < allFiles.length; i += CHUNK_SIZE) {
        if (!active) return
        const chunk = allFiles.slice(i, i + CHUNK_SIZE)
        
        await Promise.all(chunk.map(async (filePath) => {
          if (!active) return
          
          const ext = filePath.split('.').pop()
          let lang = null
          if (ext === 'js' || ext === 'jsx') lang = 'javascript'
          if (ext === 'ts' || ext === 'tsx') lang = 'typescript'
          if (ext === 'py') lang = 'python'
          if (ext === 'cpp' || ext === 'hpp') lang = 'cpp'
          if (ext === 'c' || ext === 'h') lang = 'c'
          if (ext === 'java') lang = 'java'
          if (ext === 'go') lang = 'go'
          if (ext === 'rs') lang = 'rust'
          
          const fileName = filePath.split(/[\\/]/).pop()
          
          const node = {
            id: filePath,
            type: 'custom',
            position: { x: 0, y: 0 },
            data: { label: fileName, type: lang || ext, ext, exports: [], fullPath: filePath }
          }
          
          const exports = []
          const imports = []

          try {
            const codeRes = await window.api.getFileContents(filePath)
            const code = codeRes.content || codeRes || ''
            
            if (code && lang) {
              let treeParsed = false
              try {
                const p = await initTreeSitter(lang)
                if (p) {
                  const tree = p.parse(code)
                  function walk(n) {
                    const t = n.type
                    if (t === 'import_statement' || t === 'import_from_statement' || t === 'preproc_include') {
                      imports.push(n.text)
                    }
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
                  treeParsed = true
                }
              } catch (e) {
                console.warn('Tree sitter parsing failed, falling back to regex', e)
              }

              const importMatches = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g), ...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
              importMatches.forEach(m => imports.push(m[1]))

              const exportMatches = [...code.matchAll(/(?:export\s+)?(?:const|let|var|function|class)\s+([a-zA-Z0-9_]+)/g)]
              exportMatches.forEach(m => exports.push(m[1]))
            }
          } catch (e) { }

          node.data.exports = [...new Set(exports)].slice(0, 3)
          
          for (const imp of imports) {
            for (const otherFile of allFiles) {
              if (otherFile === filePath) continue
              const otherBase = otherFile.split(/[\\/]/).pop().split('.')[0]
              if (imp.includes(otherBase)) {
                newEdges.push({
                  id: `e-${otherFile}-${filePath}`,
                  source: otherFile, 
                  target: filePath,  
                  animated: true,
                  style: { stroke: '#4f46e5', strokeWidth: 2, opacity: 0.8 },
                  markerEnd: { type: MarkerType.ArrowClosed, color: '#4f46e5' }
                })
              }
            }
          }
          
          newNodes.push(node)
        }))
      }
      
      const uniqueEdges = []
      const edgeIds = new Set()
      for (const e of newEdges) {
        if (!edgeIds.has(e.id)) {
          edgeIds.add(e.id)
          uniqueEdges.push(e)
        }
      }
      
      setRawNodes(newNodes)
      setRawEdges(uniqueEdges)
      setLoading(false)
    }
    
    buildGraph()
    return () => { active = false }
  }, [projectRoot])

  const [hideOrphans, setHideOrphans] = useState(false)
  const [hideNonCode, setHideNonCode] = useState(false)

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
          <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: '6px', padding: '4px', gap: '4px', border: '1px solid var(--border-base)' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
            <div style={{ width: '40px', height: '40px', border: '3px solid var(--border-base)', borderTopColor: 'var(--accent-color)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '16px' }} />
            <span style={{ fontSize: '15px', letterSpacing: '0.5px' }}>Mapping Project Dependencies...</span>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
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