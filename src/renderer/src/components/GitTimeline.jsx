import React, { useState, useEffect, useCallback } from 'react'
import { ReactFlow, Controls, Background, applyNodeChanges, applyEdgeChanges, Handle, Position, useReactFlow, ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { GitBranch, User, Clock, MessageSquare, Loader2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, X } from 'lucide-react'

const getAuthorColor = (name) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

const CommitNode = ({ data }) => {
  const authorColor = getAuthorColor(data.author);
  
  return (
    <div style={{ position: 'relative', width: 24, height: 24 }}>
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden', top: '50%' }} />
      
      {/* The Dot */}
      <div style={{ 
        width: 14, 
        height: 14, 
        borderRadius: '50%', 
        background: data.isMerge ? '#9333ea' : authorColor,
        border: '3px solid var(--bg-deep)',
        boxShadow: `0 0 0 2px ${data.isMerge ? '#9333ea' : authorColor}`,
        position: 'absolute',
        top: 5,
        left: 5,
        zIndex: 10
      }} />

      {/* The Text Payload (rendered to the right of the node) */}
      <div style={{
        position: 'absolute',
        left: 36,
        top: -2,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: 800,
        pointerEvents: 'none'
      }}>
        <div style={{ 
          fontFamily: 'monospace', 
          fontWeight: 'bold', 
          color: 'var(--accent-color)', 
          fontSize: '13px',
          width: '64px',
          flexShrink: 0
        }}>
          {data.hash}
        </div>
        
        <div style={{ 
          fontSize: '13px', 
          color: 'var(--text-primary)', 
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1
        }}>
          {data.message}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0, paddingRight: '20px' }}>
          <div style={{ width: 16, height: 16, borderRadius: '50%', background: authorColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontSize: '9px', fontWeight: 'bold' }}>
            {data.author.charAt(0).toUpperCase()}
          </div>
          <span style={{ fontWeight: 500, color: '#e2e2e2' }}>{data.author}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>{data.time}</span>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden', bottom: '50%' }} />
    </div>
  )
}

const nodeTypes = { commit: CommitNode }

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({ rankdir: direction, nodesep: 24, ranksep: 32, align: 'UL' })

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 24, height: 24 })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const layoutedNodes = nodes.map((node, index) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 12,
        y: index * 48, // strictly sequential Y prevents any text overlap
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}

const PanControls = () => {
  const { setViewport, getViewport } = useReactFlow();
  
  const pan = (dx, dy) => {
    const { x, y, zoom } = getViewport();
    setViewport({ x: x + dx, y: y + dy, zoom }, { duration: 300 });
  };

  const btnStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-base)',
    color: 'var(--text-primary)',
    padding: '6px',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.2)',
    transition: 'background 0.2s'
  };

  return (
    <div style={{ position: 'absolute', bottom: '24px', left: '72px', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
      <button 
        style={btnStyle} 
        onClick={() => pan(0, 100)} 
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} 
        onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
        title="Pan Up"
      >
        <ArrowUp size={16} />
      </button>
      <div style={{ display: 'flex', gap: '4px' }}>
        <button 
          style={btnStyle} 
          onClick={() => pan(100, 0)}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} 
          onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
          title="Pan Left"
        >
          <ArrowLeft size={16} />
        </button>
        <button 
          style={btnStyle} 
          onClick={() => pan(0, -100)}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} 
          onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
          title="Pan Down"
        >
          <ArrowDown size={16} />
        </button>
        <button 
          style={btnStyle} 
          onClick={() => pan(-100, 0)}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} 
          onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
          title="Pan Right"
        >
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

export function GitTimeline({ projectRoot, onClose }) {
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [rawLines, setRawLines] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])

  const loadGitData = useCallback(async (currentPage, existingLines, isLoadMore = false) => {
    if (!projectRoot) {
      setError("No workspace loaded")
      setLoading(false)
      return
    }

    try {
      if (isLoadMore) setIsLoadingMore(true)
      else setLoading(true)

      const limit = 50
      const skip = currentPage * limit
      const result = await window.api.runCommand(`git log --all --skip=${skip} -n ${limit} --format=format:"%h|%p|%an|%ar|%s"`, projectRoot)
      
      if (result.error) {
        throw new Error(result.error)
      }

      const newLines = result.stdout ? result.stdout.split('\n').filter(l => l.trim()) : []
      if (newLines.length < limit) {
        setHasMore(false)
      }

      if (currentPage === 0 && newLines.length === 0) {
        setError("No git history found in this repository.")
        setLoading(false)
        return
      }

      const combinedLines = [...existingLines, ...newLines]
      setRawLines(combinedLines)
      
      const initialNodes = []
      const initialEdges = []
      const nodeMap = new Set()

      combinedLines.forEach((line) => {
        const parts = line.split('|')
        if (parts.length < 5) return
        
        const hash = parts[0]
        const parentsStr = parts[1]
        const author = parts[2]
        const time = parts[3]
        const message = parts.slice(4).join('|')
        
        const parents = parentsStr ? parentsStr.split(' ') : []
        const isMerge = parents.length > 1

        if (!nodeMap.has(hash)) {
          initialNodes.push({
            id: hash,
            type: 'commit',
            data: { hash, author, time, message, isMerge }
          })
          nodeMap.add(hash)
        }

        parents.forEach(parentHash => {
          if (parentHash) {
            initialEdges.push({
              id: `e-${parentHash}-${hash}`,
              source: parentHash,
              target: hash,
              animated: false,
              type: 'bezier',
              style: { stroke: 'var(--border-base)', strokeWidth: 2 }
            })
          }
        })
      })
      
      // Edge case: if a parent doesn't exist in our truncated list, dagre will crash.
      // We need to filter edges to only include those where BOTH source and target exist in initialNodes.
      const validEdges = initialEdges.filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
      initialNodes.reverse() // Display old to new (top to bottom)

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(initialNodes, validEdges)
      setNodes(layoutedNodes)
      setEdges(layoutedEdges)
      setError(null)
    } catch (err) {
      console.error("Git timeline error:", err)
      setError(err.message)
    } finally {
      setLoading(false)
      setIsLoadingMore(false)
    }
  }, [projectRoot])

  useEffect(() => {
    setRawLines([])
    setPage(0)
    setHasMore(true)
    loadGitData(0, [], false)
  }, [projectRoot, loadGitData])

  const handleLoadMore = () => {
    if (isLoadingMore || !hasMore) return
    const nextPage = page + 1
    setPage(nextPage)
    loadGitData(nextPage, rawLines, true)
  }

  if (loading && !isLoadingMore) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        <Loader2 className="animate-spin" size={32} style={{ marginRight: '12px' }} />
        Parsing Git History...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', background: 'var(--bg-deep)' }}>
        <GitBranch size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <div style={{ fontSize: '18px', fontWeight: '500', marginBottom: '8px', color: 'var(--text-primary)' }}>Git Time Machine Unavailable</div>
        <div style={{ fontSize: '14px', maxWidth: '400px', textAlign: 'center', marginBottom: '24px' }}>{error}</div>
        <button 
          onClick={onClose}
          style={{ 
            background: 'var(--bg-elevated)', 
            border: '1px solid var(--border-base)', 
            color: 'var(--text-primary)', 
            padding: '8px 16px', 
            borderRadius: '6px', 
            cursor: 'pointer', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px', 
            fontSize: '13px', 
            fontWeight: '500',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
        >
          <X size={16} /> Close
        </button>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--bg-deep)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '20px 30px', 
        background: 'var(--bg-activity)', 
        borderBottom: '1px solid var(--border-base)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <GitBranch size={24} color="var(--accent-color)" />
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--text-primary)' }}>Git Time Machine</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>Interactive DAG visualization of your last {rawLines.length || 0} commits across all branches.</p>
        </div>
        {hasMore && (
          <button 
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            style={{
              background: 'var(--accent-color)',
              color: '#000',
              border: 'none',
              padding: '6px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: isLoadingMore ? 'not-allowed' : 'pointer',
              opacity: isLoadingMore ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {isLoadingMore && <Loader2 className="animate-spin" size={14} />}
            {isLoadingMore ? 'Loading...' : 'Load Older Commits (50)'}
          </button>
        )}
        <button 
          onClick={onClose}
          style={{ 
            background: 'var(--bg-elevated)', 
            border: '1px solid var(--border-base)', 
            color: 'var(--text-primary)', 
            padding: '6px 12px', 
            borderRadius: '6px', 
            cursor: 'pointer', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px', 
            fontSize: '13px', 
            fontWeight: '500' 
          }}
        >
          <X size={16} /> Close Timeline
        </button>
      </div>
      
      <div style={{ flex: 1, position: 'relative' }}>
        <style>{`
          .react-flow__controls {
            background: var(--bg-elevated) !important;
            border: 1px solid var(--border-base) !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2) !important;
          }
          .react-flow__controls-button {
            background: transparent !important;
            border-bottom: 1px solid var(--border-base) !important;
            fill: var(--text-primary) !important;
          }
          .react-flow__controls-button:hover {
            background: rgba(255,255,255,0.1) !important;
          }
          .react-flow__controls-button:last-child {
            border-bottom: none !important;
          }
        `}</style>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            panOnScroll={true}
            zoomOnScroll={false}
            attributionPosition="bottom-right"
          >
            <Background color="var(--border-base)" gap={16} />
            <Controls />
            <PanControls />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  )
}
