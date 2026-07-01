import React, { useState, useEffect, useCallback } from 'react'
import { Anchor, RefreshCw, AlertTriangle, Download, Trash2, FileText, ExternalLink, ChevronDown } from 'lucide-react'

// Safe JSON parse helper — never throws
function safeParseJson(text) {
  if (!text || typeof text !== 'string') return null
  try {
    return JSON.parse(text.trim())
  } catch {
    return null
  }
}

export function KubernetesPanel({ width }) {
  const [installed, setInstalled] = useState(null) // null = checking, true/false
  const [versionText, setVersionText] = useState('')
  const [tab, setTab] = useState('pods') // 'pods' | 'deployments'
  const [namespaces, setNamespaces] = useState([])
  const [selectedNs, setSelectedNs] = useState('default')
  const [pods, setPods] = useState([])
  const [deployments, setDeployments] = useState([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(null)
  const [error, setError] = useState(null)

  // ── Pre-flight check ──
  useEffect(() => {
    (async () => {
      try {
        const result = await window.api.runCommand('kubectl version --client --short 2>&1')
        if (result.error && !result.stdout) {
          // Also try without --short for newer kubectl
          const result2 = await window.api.runCommand('kubectl version --client -o json 2>&1')
          if (result2.error && !result2.stdout) {
            setInstalled(false)
            return
          }
          const parsed = safeParseJson(result2.stdout)
          setVersionText(parsed?.clientVersion ? `Client: v${parsed.clientVersion.major}.${parsed.clientVersion.minor}` : result2.stdout.trim().split('\n')[0])
          setInstalled(true)
        } else {
          setInstalled(true)
          setVersionText(result.stdout?.trim().split('\n')[0] || 'kubectl installed')
        }
      } catch {
        setInstalled(false)
      }
    })()
  }, [])

  // ── Load namespaces and initial data when kubectl is found ──
  useEffect(() => {
    if (installed) {
      fetchNamespaces()
    }
  }, [installed])

  useEffect(() => {
    if (installed && selectedNs) {
      fetchPods()
      fetchDeployments()
    }
  }, [installed, selectedNs])

  // ── Fetch namespaces ──
  const fetchNamespaces = useCallback(async () => {
    try {
      const result = await window.api.runCommand('kubectl get namespaces -o json')
      if (result.error) return
      const parsed = safeParseJson(result.stdout)
      if (parsed?.items) {
        setNamespaces(parsed.items.map(ns => ns.metadata?.name).filter(Boolean))
      }
    } catch {
      // non-fatal
    }
  }, [])

  // ── Fetch pods ──
  const fetchPods = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.runCommand(`kubectl get pods -n ${selectedNs} -o json`)
      if (result.error) {
        setError(result.stderr || result.error)
        setPods([])
      } else {
        const parsed = safeParseJson(result.stdout)
        setPods(parsed?.items || [])
      }
    } catch (e) {
      setError(e.message)
      setPods([])
    }
    setLoading(false)
  }, [selectedNs])

  // ── Fetch deployments ──
  const fetchDeployments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.runCommand(`kubectl get deployments -n ${selectedNs} -o json`)
      if (result.error) {
        setError(result.stderr || result.error)
        setDeployments([])
      } else {
        const parsed = safeParseJson(result.stdout)
        setDeployments(parsed?.items || [])
      }
    } catch (e) {
      setError(e.message)
      setDeployments([])
    }
    setLoading(false)
  }, [selectedNs])

  const handleRefresh = () => {
    if (tab === 'pods') fetchPods()
    else fetchDeployments()
  }

  // ── Delete pod ──
  const deletePod = async (name) => {
    setActionLoading(name)
    try {
      await window.api.runCommand(`kubectl delete pod ${name} -n ${selectedNs}`)
    } catch {
      // silently fail
    }
    setActionLoading(null)
    fetchPods()
  }

  // ── Pod status color ──
  const podStatusColor = (phase) => {
    if (!phase) return 'var(--text-muted)'
    switch (phase.toLowerCase()) {
      case 'running': return '#10a37f'
      case 'succeeded': return '#3b82f6'
      case 'pending': return '#f59e0b'
      case 'failed': return '#ef4444'
      case 'crashloopbackoff': return '#ef4444'
      default: return 'var(--text-muted)'
    }
  }

  const statusDot = (color) => (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, marginRight: 6, flexShrink: 0
    }} />
  )

  // ── Fallback: checking ──
  if (installed === null) {
    return (
      <aside className="sidebar" style={{ width: width ? `${width}px` : '260px' }}>
        <div className="sidebar-header" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-base)' }}>
          <h2 style={{ fontSize: '12px', letterSpacing: '0.5px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Anchor size={14} /> KUBERNETES
          </h2>
        </div>
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Checking kubectl installation...
        </div>
      </aside>
    )
  }

  // ── Fallback: not installed ──
  if (installed === false) {
    return (
      <aside className="sidebar" style={{ width: width ? `${width}px` : '260px' }}>
        <div className="sidebar-header" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-base)' }}>
          <h2 style={{ fontSize: '12px', letterSpacing: '0.5px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Anchor size={14} /> KUBERNETES
          </h2>
        </div>
        <div style={{ padding: '30px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <AlertTriangle size={32} color="#ef4444" />
          </div>
          <div>
            <div style={{ fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: 6, fontSize: '14px' }}>kubectl Not Found</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: 1.5 }}>
              The Kubernetes CLI (kubectl) is not installed or not in your system PATH. Install it to manage clusters, pods, and deployments from the IDE.
            </div>
          </div>
          <button
            onClick={() => window.api.openUrl('https://kubernetes.io/docs/tasks/tools/')}
            style={{
              padding: '8px 16px', background: '#326ce5', color: '#fff', border: 'none',
              borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px',
              display: 'flex', alignItems: 'center', gap: '6px'
            }}
          >
            <Download size={14} /> Install kubectl
            <ExternalLink size={12} />
          </button>
        </div>
      </aside>
    )
  }

  // ── Main dashboard ──
  return (
    <aside className="sidebar" style={{ width: width ? `${width}px` : '260px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="sidebar-header" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-base)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '12px', letterSpacing: '0.5px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Anchor size={14} /> KUBERNETES
        </h2>
        <button
          onClick={handleRefresh}
          title="Refresh"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex' }}
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Version info */}
      <div style={{ padding: '4px 16px', fontSize: '10px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-base)' }}>
        {versionText}
      </div>

      {/* Namespace selector */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-base)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>Namespace:</span>
        <div style={{ position: 'relative', flex: 1 }}>
          <select
            value={selectedNs}
            onChange={(e) => setSelectedNs(e.target.value)}
            style={{
              width: '100%', padding: '4px 24px 4px 8px', background: 'var(--bg-elevated)',
              color: 'var(--text-primary)', border: '1px solid var(--border-base)',
              borderRadius: '4px', fontSize: '11px', outline: 'none', cursor: 'pointer',
              appearance: 'none', WebkitAppearance: 'none'
            }}
          >
            {namespaces.length === 0 ? (
              <option value="default">default</option>
            ) : (
              namespaces.map(ns => (
                <option key={ns} value={ns} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>{ns}</option>
              ))
            )}
          </select>
          <ChevronDown size={12} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-base)' }}>
        {[
          { id: 'pods', label: 'Pods' },
          { id: 'deployments', label: 'Deployments' }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); t.id === 'pods' ? fetchPods() : fetchDeployments() }}
            style={{
              flex: 1, padding: '8px 0', background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent-color)' : '2px solid transparent',
              color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: '11px', fontWeight: tab === t.id ? 'bold' : 'normal',
              transition: 'all 0.2s'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="sidebar-content custom-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {error && (
          <div style={{ padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: '#ef4444', fontSize: '11px', marginBottom: '8px', wordBreak: 'break-word' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: '12px' }}>
            Loading...
          </div>
        ) : tab === 'pods' ? (
          pods.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>
              No pods found in "{selectedNs}".
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {pods.map((pod, i) => {
                const name = pod.metadata?.name || `pod-${i}`
                const phase = pod.status?.phase || 'Unknown'
                const containerCount = pod.spec?.containers?.length || 0
                const readyCount = (pod.status?.containerStatuses || []).filter(cs => cs.ready).length

                return (
                  <div
                    key={name}
                    style={{
                      padding: '8px 10px', borderRadius: '6px', background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-base)', fontSize: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', color: 'var(--text-primary)', overflow: 'hidden' }}>
                        {statusDot(podStatusColor(phase))}
                        <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{name}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                        <button onClick={() => deletePod(name)} title="Delete Pod"
                          disabled={actionLoading === name}
                          style={actionBtnStyle('#ef4444')}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                      {phase} • {readyCount}/{containerCount} ready
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          deployments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>
              No deployments found in "{selectedNs}".
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {deployments.map((dep, i) => {
                const name = dep.metadata?.name || `deployment-${i}`
                const desired = dep.spec?.replicas ?? 0
                const ready = dep.status?.readyReplicas ?? 0
                const available = dep.status?.availableReplicas ?? 0
                const isHealthy = ready === desired && desired > 0

                return (
                  <div
                    key={name}
                    style={{
                      padding: '8px 10px', borderRadius: '6px', background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-base)', fontSize: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                      {statusDot(isHealthy ? '#10a37f' : '#f59e0b')}
                      <span style={{ fontWeight: 'bold', color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{name}</span>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                      Ready: {ready}/{desired} • Available: {available}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </aside>
  )
}

const actionBtnStyle = (color) => ({
  background: 'transparent', border: 'none', color, cursor: 'pointer',
  padding: '4px', display: 'flex', borderRadius: '4px',
  opacity: 0.7, transition: 'opacity 0.2s'
})
