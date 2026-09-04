import React from 'react'
import { motion } from 'framer-motion'
import { extractPointers } from './dsaUtils'

// ============================================================
// VISUALIZATION CANVAS — Renders array | tree | graph |
// linkedList | watch based on structure detection.
// The current frame's dataStructureState + variables drive
// the visuals; nothing is inferred by AI here.
// ============================================================
export function VisualizationCanvas({ structure, frame, allFrames }) {
  if (!frame) {
    return (
      <div style={emptyStyle}>
        <span>Run the code to generate a trace.</span>
      </div>
    )
  }

  const state = frame.dataStructureState
  const vars = frame.variables || {}
  const callStack = Array.isArray(frame.callStack) ? frame.callStack : []

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {callStack.length > 0 && <CallStackStrip callStack={callStack} />}

      {structure === 'array' && Array.isArray(state) && <ArrayView data={state} vars={vars} />}
      {structure === 'tree' && state && <TreeView root={state} />}
      {structure === 'graph' && state && <GraphView graph={state} vars={vars} />}
      {structure === 'linkedList' && state && <LinkedListView head={state} />}
      {(structure === 'watch' || !state) && <WatchTable vars={vars} />}

      <VariablesPanel vars={vars} />
    </div>
  )
}

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-muted)', fontSize: '12px', padding: '16px'
}

// ── Array view — bar chart with pointer labels ──
function ArrayView({ data, vars }) {
  const pointers = extractPointers({ variables: vars }, data.length)
  const numeric = data.every(v => typeof v === 'number')
  const max = numeric ? Math.max(1, ...data.map(v => Math.abs(v))) : 1

  return (
    <div>
      <SectionTitle>Array</SectionTitle>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', minHeight: '180px', padding: '16px 0', flexWrap: 'wrap' }}>
        {data.map((v, i) => {
          const ptrsHere = pointers.filter(p => p.index === i)
          const isPointed = ptrsHere.length > 0
          const height = numeric ? Math.max(24, Math.round((Math.abs(v) / max) * 160)) : 60
          
          // Distinct colors for specific pointers
          let highlightColor = 'var(--accent-color)'
          let highlightText = 'var(--accent-text)'
          if (ptrsHere.some(p => p.name === 'pivot' || p.name === 'mid')) { highlightColor = '#8b5cf6'; highlightText = '#fff' }
          else if (ptrsHere.some(p => p.name === 'i' || p.name === 'left' || p.name === 'start')) { highlightColor = '#3b82f6'; highlightText = '#fff' }
          else if (ptrsHere.some(p => p.name === 'j' || p.name === 'right' || p.name === 'end')) { highlightColor = '#10b981'; highlightText = '#fff' }

          return (
            <motion.div layout key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: '44px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minHeight: '32px', justifyContent: 'flex-end' }}>
                {ptrsHere.map(p => (
                  <motion.div layoutId={`ptr-${p.name}`} key={p.name} style={{
                    fontSize: '10px', fontWeight: 700, color: highlightColor,
                    background: 'var(--bg-elevated)', padding: '2px 6px',
                    borderRadius: '4px', border: `1px solid ${highlightColor}`
                  }}>{p.name}↓</motion.div>
                ))}
              </div>
              <motion.div layout style={{
                width: '38px',
                height: `${height}px`,
                background: isPointed ? highlightColor : 'var(--bg-elevated)',
                border: `1px solid ${isPointed ? highlightColor : 'var(--border-base)'}`,
                borderRadius: '4px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isPointed ? highlightText : 'var(--text-primary)',
                fontSize: '12px', fontWeight: 600,
                boxShadow: isPointed ? `0 0 12px ${highlightColor}66` : 'none',
              }}>{String(v)}</motion.div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{i}</div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// ── Tree view — recursive node-link diagram ──
function TreeView({ root }) {
  const layout = layoutTree(root)
  if (!layout) return <div style={emptyStyle}>Empty tree.</div>

  const { positions, edges, width, height } = layout

  return (
    <div>
      <SectionTitle>Tree</SectionTitle>
      <div style={{ position: 'relative', width: width, height: height, background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-base)' }}>
        <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
          {edges.map((e, i) => (
            <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="var(--text-muted)" strokeWidth="1.5" />
          ))}
        </svg>
        {positions.map((p, i) => (
          <motion.div layout key={i} style={{
            position: 'absolute',
            left: p.x - 22,
            top: p.y - 22,
            width: '44px', height: '44px',
            borderRadius: '22px',
            background: 'var(--accent-color)',
            border: '2px solid var(--accent-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '13px', fontWeight: 'bold', color: 'var(--accent-text)',
            boxShadow: '0 4px 6px rgba(0,0,0,0.2)'
          }}>
            {String(p.value)}
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function layoutTree(root) {
  if (!root) return null
  const positions = []
  const edges = []
  const gapY = 70
  const nodeR = 22

  // Compute subtree widths bottom-up so siblings never overlap
  const measure = (node) => {
    if (!node) return 0
    const kids = node.children
      ? node.children.filter(Boolean)
      : [node.left, node.right].filter(Boolean)
    if (!kids.length) return 60
    let w = 0
    for (const k of kids) w += measure(k)
    return Math.max(60, w)
  }

  const width = Math.max(400, measure(root))
  const positionsMap = new Map()

  const place = (node, cx, y) => {
    if (!node) return
    positionsMap.set(node, { x: cx, y, value: node.val ?? node.value ?? '·' })
    const kids = node.children
      ? node.children.filter(Boolean)
      : [node.left, node.right].filter(Boolean)
    if (!kids.length) return
    const totalW = kids.reduce((s, k) => s + measure(k), 0)
    let startX = cx - totalW / 2
    for (const k of kids) {
      const kw = measure(k)
      const kx = startX + kw / 2
      edges.push({ x1: cx, y1: y + nodeR, x2: kx, y2: y + gapY - nodeR })
      place(k, kx, y + gapY)
      startX += kw
    }
  }

  place(root, width / 2, 40)
  positions.push(...positionsMap.values())

  const height = positions.length ? Math.max(...positions.map(p => p.y)) + 60 : 100
  return { positions, edges, width, height }
}

// ── Graph view — nodes in a circle + edges from adjacency ──
function GraphView({ graph, vars }) {
  const nodes = []
  const edges = []
  if (Array.isArray(graph) && Array.isArray(graph[0])) {
    for (let i = 0; i < graph.length; i++) nodes.push(String(i))
    for (let i = 0; i < graph.length; i++) {
      for (let j = 0; j < graph[i].length; j++) {
        if (graph[i][j]) edges.push({ a: String(i), b: String(j) })
      }
    }
  } else if (typeof graph === 'object' && graph !== null) {
    for (const [k, v] of Object.entries(graph)) {
      nodes.push(k)
      for (const other of (v || [])) edges.push({ a: k, b: String(other) })
    }
    for (const e of edges) {
      if (!nodes.includes(e.b)) nodes.push(e.b)
    }
  }

  const size = 320
  const cx = size / 2, cy = size / 2, R = size / 2 - 30
  const positions = new Map()
  nodes.forEach((n, i) => {
    const t = (i / nodes.length) * Math.PI * 2 - Math.PI / 2
    positions.set(n, { x: cx + R * Math.cos(t), y: cy + R * Math.sin(t) })
  })

  const activeSet = new Set()
  for (const v of Object.values(vars)) {
    if (typeof v === 'string' && positions.has(v)) activeSet.add(v)
    if (typeof v === 'number' && positions.has(String(v))) activeSet.add(String(v))
  }

  return (
    <div>
      <SectionTitle>Graph</SectionTitle>
      <div style={{ position: 'relative', width: size, height: size, background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-base)' }}>
        <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0 }}>
          {edges.map((e, i) => {
            const A = positions.get(e.a), B = positions.get(e.b)
            if (!A || !B) return null
            return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="var(--text-muted)" strokeWidth="1.5" />
          })}
        </svg>
        {nodes.map((n) => {
          const p = positions.get(n)
          const isActive = activeSet.has(n)
          return (
            <motion.div key={n} layout style={{
              position: 'absolute',
              left: p.x - 20, top: p.y - 20,
              width: '40px', height: '40px', borderRadius: '20px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isActive ? 'var(--accent-color)' : 'var(--bg-surface)',
              border: `2px solid ${isActive ? 'var(--accent-color)' : 'var(--border-base)'}`,
              color: isActive ? 'var(--accent-text)' : 'var(--text-primary)',
              fontSize: '12px', fontWeight: 'bold'
            }}>
              {n}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// ── Linked list — horizontal chain of boxes ──
function LinkedListView({ head }) {
  const nodes = []
  let cur = head
  let guard = 0
  while (cur && guard < 200) {
    nodes.push({ val: cur.val ?? cur.value ?? '·' })
    cur = cur.next
    guard++
  }
  return (
    <div>
      <SectionTitle>Linked List</SectionTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {nodes.map((n, i) => (
          <React.Fragment key={i}>
            <motion.div layout style={{
              minWidth: '40px', height: '40px', padding: '0 12px',
              borderRadius: '8px', background: 'var(--bg-elevated)',
              border: '2px solid var(--accent-color)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: 'bold', color: 'var(--text-primary)',
              boxShadow: '0 4px 6px rgba(0,0,0,0.2)'
            }}>
              {String(n.val)}
            </motion.div>
            {i < nodes.length - 1 && <div style={{ color: 'var(--accent-color)', fontSize: '18px' }}>→</div>}
          </React.Fragment>
        ))}
        {nodes.length > 0 && <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>→ null</div>}
      </div>
    </div>
  )
}

// ── Variable watch table — always shown; also the fallback ──
function WatchTable({ vars }) {
  const entries = Object.entries(vars || {})
  return (
    <div>
      <SectionTitle>Variables</SectionTitle>
      {entries.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No variables at this step.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-base)' }}>Name</th>
              <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-base)' }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '6px 8px', color: 'var(--accent-color)', fontFamily: 'monospace' }}>{k}</td>
                <td style={{ padding: '6px 8px', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{formatValue(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function VariablesPanel({ vars }) {
  // Only render this again if the primary view wasn't already the WatchTable
  return null
}

function CallStackStrip({ callStack }) {
  return (
    <div>
      <SectionTitle>Call Stack ({callStack.length})</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {callStack.map((frame, i) => {
          const isTop = i === callStack.length - 1
          return (
            <div key={i} style={{
              padding: '6px 10px',
              background: isTop ? 'var(--bg-elevated)' : 'var(--bg-surface)',
              border: `1px solid ${isTop ? 'var(--accent-color)' : 'var(--border-base)'}`,
              borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-primary)'
            }}>
              <span style={{ color: 'var(--accent-color)', fontWeight: 600 }}>{frame.fn || 'fn'}</span>
              <span style={{ color: 'var(--text-muted)' }}>({formatValue(frame.args)})</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px',
      color: 'var(--text-muted)', fontWeight: 700, marginBottom: '10px'
    }}>{children}</div>
  )
}

function formatValue(v) {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v === 'string') return `"${v}"`
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v)
      return s.length > 60 ? s.slice(0, 57) + '...' : s
    } catch {
      return String(v)
    }
  }
  return String(v)
}
