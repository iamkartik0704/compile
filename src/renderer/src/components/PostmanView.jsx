import React, { useState } from 'react'

export function PostmanView() {
  const [url, setUrl] = useState('https://jsonplaceholder.typicode.com/todos/1')
  const [method, setMethod] = useState('GET')
  const [response, setResponse] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSend = async () => {
    setLoading(true)
    try {
      const res = await fetch(url, { method })
      const data = await res.json()
      setResponse(JSON.stringify(data, null, 2))
    } catch (err) {
      setResponse(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px', color: 'var(--text-main)', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ fontSize: '24px', marginBottom: '20px', color: 'var(--text-primary)' }}>API Client</h1>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <select 
          value={method} 
          onChange={(e) => setMethod(e.target.value)}
          style={{ padding: '8px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-base)', borderRadius: '4px' }}
        >
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>DELETE</option>
        </select>
        <input 
          type="text" 
          value={url} 
          onChange={(e) => setUrl(e.target.value)} 
          style={{ flex: 1, padding: '8px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-base)', borderRadius: '4px' }}
          placeholder="Enter request URL"
        />
        <button 
          onClick={handleSend}
          disabled={loading}
          style={{ background: 'var(--accent-color)', color: 'var(--accent-text)', border: 'none', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ marginBottom: '10px', color: 'var(--text-primary)' }}>Response</h3>
        <textarea 
          readOnly
          value={response || ''}
          style={{ flex: 1, padding: '15px', background: 'var(--bg-dark)', color: '#a6accd', border: '1px solid var(--border-base)', borderRadius: '4px', fontFamily: 'monospace', resize: 'none' }}
          placeholder="Response will appear here..."
        />
      </div>
    </div>
  )
}
