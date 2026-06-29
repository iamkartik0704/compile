import React, { useState, useEffect } from 'react'

export function KubernetesPanel({ width }) {
  return (
    <aside className="sidebar" style={{ width: width ? `${width}px` : '260px' }}>
      <div className="sidebar-header">
        <h2>KUBERNETES</h2>
      </div>
      <div className="sidebar-content" style={{ padding: '10px' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading pods...</p>
      </div>
    </aside>
  )
}
