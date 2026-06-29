import React, { useState, useEffect } from 'react'

export function DockerPanel({ width }) {
  return (
    <aside className="sidebar" style={{ width: width ? `${width}px` : '260px' }}>
      <div className="sidebar-header">
        <h2>DOCKER</h2>
      </div>
      <div className="sidebar-content" style={{ padding: '10px' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading containers...</p>
      </div>
    </aside>
  )
}
