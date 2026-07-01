import React, { useState, useRef, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { Trash2 } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { Resizer } from './Resizer'
import ReactMarkdown from 'react-markdown'
// import { Resizer } from './Resizer'

export function PostmanView() {
  const { activeTheme } = useAppStore()
  const monacoTheme = activeTheme === 'light-modern' ? 'vs' : 'vs-dark'

  const [url, setUrl] = useState(() => localStorage.getItem('postman_last_url') || 'https://jsonplaceholder.typicode.com/todos/1')
  const [method, setMethod] = useState(() => localStorage.getItem('postman_last_method') || 'GET')
  const [activeTab, setActiveTab] = useState('Body')
  const [bodyType, setBodyType] = useState('raw')
  const [rawBodyType, setRawBodyType] = useState('JSON')
  const [bodyContent, setBodyContent] = useState('')
  const [headers, setHeaders] = useState([{ key: '', value: '', enabled: true }])
  const [queryParams, setQueryParams] = useState([{ key: '', value: '', enabled: true }])
  const [formData, setFormData] = useState([{ key: '', value: '', enabled: true }])
  const [response, setResponse] = useState(null)
  const [responseStatus, setResponseStatus] = useState(null)
  const [responseTime, setResponseTime] = useState(null)
  const [responseSize, setResponseSize] = useState(null)
  const [loading, setLoading] = useState(false)
  const [configHeight, setConfigHeight] = useState(250)
  const containerRef = useRef(null)

  const [responseTab, setResponseTab] = useState('Response')
  const [aiDebugger, setAiDebugger] = useState({ explanation: '', codeFix: '', loading: false })

  useEffect(() => {
    if (window.api && window.api.onPostmanDebuggerStream) {
      window.api.onPostmanDebuggerStream((chunk) => {
        setAiDebugger(prev => {
          const text = prev.explanation + chunk
          const marker = "FIX:\n"
          const idx = text.indexOf(marker)
          if (idx !== -1) {
            return { ...prev, explanation: text.substring(0, idx).replace('EXPLANATION:', '').trim(), codeFix: text.substring(idx + marker.length).trim(), loading: false }
          } else {
            return { ...prev, explanation: text.replace('EXPLANATION:', '').trim(), loading: false }
          }
        })
      })
    }
  }, [])

  const handleSend = async () => {
    setLoading(true)
    const startTime = Date.now()
    setResponse(null)
    setResponseStatus(null)
    setResponseTime(null)
    setResponseSize(null)
    
    // Save last used URL and Method
    localStorage.setItem('postman_last_url', url)
    localStorage.setItem('postman_last_method', method)

    try {
      let finalUrl = url
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'http://' + finalUrl
      }
      const urlObj = new URL(finalUrl)
      queryParams.filter(p => p.enabled && p.key).forEach(p => {
        urlObj.searchParams.append(p.key, p.value)
      })
      
      const reqHeaders = {}
      headers.filter(h => h.enabled && h.key).forEach(h => {
        reqHeaders[h.key] = h.value
      })
      
      if (bodyType === 'raw' && !reqHeaders['Content-Type']) {
        const contentTypeMap = {
          'JSON': 'application/json',
          'HTML': 'text/html',
          'XML': 'application/xml',
          'JavaScript': 'application/javascript',
          'Text': 'text/plain'
        }
        reqHeaders['Content-Type'] = contentTypeMap[rawBodyType] || 'text/plain'
      }
      
      const fetchOptions = {
        method,
        headers: reqHeaders
      }
      
      if (method !== 'GET' && method !== 'HEAD') {
        if (bodyType === 'raw' && bodyContent) {
          fetchOptions.body = bodyContent
        } else if (bodyType === 'x-www-form-urlencoded') {
          const params = new URLSearchParams()
          formData.filter(f => f.enabled && f.key).forEach(f => {
            params.append(f.key, f.value)
          })
          fetchOptions.body = params.toString()
          reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
        }
      }
      
      const res = await window.api.postmanRequest(urlObj.toString(), fetchOptions)
      const timeTaken = Date.now() - startTime
      setResponseTime(timeTaken)
      
      if (res.success) {
        setResponseStatus({ code: res.status, text: res.statusText })
        const contentType = res.headers['content-type'] || res.headers['Content-Type']
        let data = res.data
        if (contentType && contentType.includes('application/json')) {
          try {
            data = JSON.stringify(JSON.parse(data), null, 2)
          } catch (e) {}
        }
        setResponseSize(new Blob([data || '']).size)
        setResponse(data)
      } else {
        setResponseStatus({ code: 'Error', text: 'Failed to fetch' })
        setResponse(res.error)
      }
    } catch (err) {
      setResponseTime(Date.now() - startTime)
      setResponse(err.message)
      setResponseStatus({ code: 'Error', text: 'Failed to fetch' })
    } finally {
      setLoading(false)
    }
  }

  const renderKeyValueEditor = (items, setItems) => {
    const handleRemove = (index) => setItems(items.filter((_, i) => i !== index))
    const handleChange = (index, field, val) => {
      const newItems = [...items]
      newItems[index][field] = val
      // Auto add new row if editing the last one
      if (index === items.length - 1 && val !== '') {
        newItems.push({ key: '', value: '', enabled: true })
      }
      setItems(newItems)
    }

    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-base)', color: 'var(--text-muted)' }}>
              <th style={{ width: '30px', padding: '8px' }}></th>
              <th style={{ padding: '8px', borderRight: '1px solid var(--border-base)' }}>Key</th>
              <th style={{ padding: '8px', borderRight: '1px solid var(--border-base)' }}>Value</th>
              <th style={{ width: '40px', padding: '8px', textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-base)' }}>
                <td style={{ padding: '4px', textAlign: 'center' }}>
                  <input type="checkbox" checked={item.enabled} onChange={(e) => handleChange(i, 'enabled', e.target.checked)} />
                </td>
                <td style={{ padding: '0', borderRight: '1px solid var(--border-base)' }}>
                  <input
                    type="text"
                    value={item.key}
                    onChange={(e) => handleChange(i, 'key', e.target.value)}
                    placeholder="Key"
                    style={{ width: '100%', padding: '6px 8px', background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </td>
                <td style={{ padding: '0', borderRight: '1px solid var(--border-base)' }}>
                  <input
                    type="text"
                    value={item.value}
                    onChange={(e) => handleChange(i, 'value', e.target.value)}
                    placeholder="Value"
                    style={{ width: '100%', padding: '6px 8px', background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none' }}
                  />
                </td>
                <td style={{ padding: '4px', textAlign: 'center' }}>
                  {i < items.length - 1 && (
                    <button onClick={() => handleRemove(i)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const statusColor = responseStatus?.code >= 200 && responseStatus?.code < 300 ? '#10a37f' : 'var(--error-color)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', background: 'var(--bg-deep)', color: 'var(--text-primary)', fontSize: '13px' }}>
      
      {/* Top Bar */}
      <div style={{ padding: '15px', borderBottom: '1px solid var(--border-base)', display: 'flex', gap: '8px' }}>
        <select 
          value={method} 
          onChange={(e) => setMethod(e.target.value)}
          style={{ padding: '8px 12px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-base)', borderRadius: '4px', outline: 'none', width: '100px', fontWeight: 'bold' }}
        >
          <option style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>GET</option>
          <option style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>POST</option>
          <option style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>PUT</option>
          <option style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>PATCH</option>
          <option style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>DELETE</option>
        </select>
        <input 
          type="text" 
          value={url} 
          onChange={(e) => setUrl(e.target.value)} 
          style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-base)', borderRadius: '4px', outline: 'none' }}
          placeholder="Enter request URL"
        />
        <button 
          onClick={handleSend}
          disabled={loading}
          style={{ background: '#007acc', color: '#fff', border: 'none', padding: '8px 24px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>

      {/* Main Content Split */}
      <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        
        {/* Request Config (Top Half) */}
        <div style={{ display: 'flex', flexDirection: 'column', flexBasis: configHeight, flexShrink: 1, minHeight: '100px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-base)', padding: '0 10px' }}>
            {['Params', 'Headers', 'Body'].map(tab => (
              <div 
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{ 
                  padding: '10px 15px', 
                  cursor: 'pointer',
                  borderBottom: activeTab === tab ? '2px solid var(--accent-color)' : '2px solid transparent',
                  color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: activeTab === tab ? 500 : 400
                }}
              >
                {tab}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activeTab === 'Params' && renderKeyValueEditor(queryParams, setQueryParams)}
            {activeTab === 'Headers' && renderKeyValueEditor(headers, setHeaders)}
            {activeTab === 'Body' && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ display: 'flex', gap: '15px', padding: '10px 15px', borderBottom: '1px solid var(--border-base)', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                    <input type="radio" checked={bodyType === 'none'} onChange={() => setBodyType('none')} /> none
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                    <input type="radio" checked={bodyType === 'x-www-form-urlencoded'} onChange={() => setBodyType('x-www-form-urlencoded')} /> x-www-form-urlencoded
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                    <input type="radio" checked={bodyType === 'raw'} onChange={() => setBodyType('raw')} /> raw
                  </label>
                  {bodyType === 'raw' && (
                    <select 
                      value={rawBodyType} 
                      onChange={(e) => setRawBodyType(e.target.value)}
                      style={{ marginLeft: '10px', background: 'transparent', color: 'var(--accent-color)', border: 'none', outline: 'none', cursor: 'pointer', fontWeight: 500 }}
                    >
                      <option style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>Text</option>
                      <option style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>JavaScript</option>
                      <option style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>JSON</option>
                      <option style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>HTML</option>
                      <option style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>XML</option>
                    </select>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  {bodyType === 'raw' ? (
                    <Editor
                      height="100%"
                      language={
                        rawBodyType === 'JSON' ? 'json' :
                        rawBodyType === 'HTML' ? 'html' :
                        rawBodyType === 'XML' ? 'xml' :
                        rawBodyType === 'JavaScript' ? 'javascript' : 'plaintext'
                      }
                      theme={monacoTheme}
                      value={bodyContent}
                      onChange={setBodyContent}
                      options={{ minimap: { enabled: false }, lineNumbers: 'on', scrollBeyondLastLine: false }}
                    />
                  ) : bodyType === 'x-www-form-urlencoded' ? (
                    renderKeyValueEditor(formData, setFormData)
                  ) : (
                    <div style={{ padding: '20px', color: 'var(--text-muted)', textAlign: 'center' }}>This request does not have a body</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Resizer */}
        <div style={{ position: 'relative', height: '1px', background: 'var(--border-base)', zIndex: 10, display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', top: -3, left: 0, right: 0, height: '7px' }}>
            <Resizer
              orientation="horizontal"
              onResize={(_, y) => {
                if (containerRef.current) {
                  const rect = containerRef.current.getBoundingClientRect()
                  setConfigHeight(Math.max(100, Math.min(y - rect.top, rect.height - 100)))
                }
              }}
            />
          </div>
          <div style={{ width: '40px', height: '4px', background: 'rgba(150,150,150,0.3)', borderRadius: '2px', marginTop: '-1px', pointerEvents: 'none', zIndex: 11 }} />
        </div>

        {/* Response View (Bottom Half) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100px', flexShrink: 1, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 10px', borderBottom: '1px solid var(--border-base)', alignItems: 'center', backgroundColor: 'var(--bg-elevated)' }}>
            <div style={{ display: 'flex' }}>
              {['Response', 'AI Debugger'].map(tab => (
                <div 
                  key={tab}
                  onClick={() => setResponseTab(tab)}
                  style={{ 
                    padding: '10px 15px', 
                    cursor: 'pointer',
                    borderBottom: responseTab === tab ? '2px solid var(--accent-color)' : '2px solid transparent',
                    color: responseTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: responseTab === tab ? 500 : 400
                  }}
                >
                  {tab}
                </div>
              ))}
            </div>
            {responseStatus && (
              <div style={{ display: 'flex', gap: '15px', fontSize: '12px', alignItems: 'center' }}>
                <span>Status: <span style={{ color: statusColor, fontWeight: 500 }}>{responseStatus.code} {responseStatus.text}</span></span>
                <span>Time: <span style={{ color: '#10a37f', fontWeight: 500 }}>{responseTime} ms</span></span>
                {responseSize && <span>Size: <span style={{ color: '#10a37f', fontWeight: 500 }}>{formatBytes(responseSize)}</span></span>}
                <button
                  onClick={() => {
                    const reqHeaders = headers.filter(h => h.enabled && h.key).reduce((acc, h) => ({ ...acc, [h.key]: h.value }), {})
                    if (bodyType === 'raw' && !reqHeaders['Content-Type']) {
                      const contentTypeMap = { 'JSON': 'application/json', 'HTML': 'text/html', 'XML': 'application/xml', 'JavaScript': 'application/javascript', 'Text': 'text/plain' }
                      reqHeaders['Content-Type'] = contentTypeMap[rawBodyType] || 'text/plain'
                    } else if (bodyType === 'x-www-form-urlencoded') {
                      reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
                    }
                    
                    setResponseTab('AI Debugger')
                    setAiDebugger({ explanation: '', codeFix: '', loading: true })

                    let activeFileContent = ''
                    try {
                      if (typeof window.getEditorValue === 'function') {
                        activeFileContent = window.getEditorValue() || ''
                      }
                    } catch (e) {}

                    const promptText = `The user encountered an error with an API request in the Postman client.
Request URL: ${url}
Request Method: ${method}
Request Headers: ${JSON.stringify(reqHeaders, null, 2)}
Request Body: ${bodyContent}

Response Status: ${responseStatus?.code} ${responseStatus?.text}
Response Body:
${response}

Active File content from their IDE:
${activeFileContent.substring(0, 3000)}

Analyze the API request and response to figure out what went wrong. Provide a fix if applicable. Return your response in exactly this format:
EXPLANATION: <brief explanation of the error in 1-2 short sentences>
FIX:
<explain the fix or provide a code edit block if server code needs changing>`

                    if (window.api && window.api.streamAiDebugger) {
                      window.api.streamAiDebugger(promptText, { emitEvent: 'postman-debugger-stream' })
                        .catch(err => {
                          setAiDebugger({ explanation: `Error: ${err.message}`, codeFix: '', loading: false })
                        })
                    }
                  }}
                  style={{ background: 'var(--accent-color)', color: 'var(--accent-text)', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', marginLeft: '10px' }}
                >
                  ✨ Debug with AI
                </button>
              </div>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {responseTab === 'Response' ? (
              response === null && !loading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-muted)' }}>
                  Enter the URL and click Send to get a response
                </div>
              ) : loading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-muted)' }}>
                  Sending request...
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                  <Editor
                    height="100%"
                    language={response && (response.trim().startsWith('{') || response.trim().startsWith('[')) ? 'json' : 'plaintext'}
                    theme={monacoTheme}
                    value={response}
                    options={{ 
                      minimap: { enabled: false }, 
                      readOnly: true, 
                      scrollBeyondLastLine: false, 
                      wordWrap: 'on',
                      scrollbar: { vertical: 'visible', verticalScrollbarSize: 10 } 
                    }}
                  />
                </div>
              )
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: 'var(--bg-deep)' }} className="custom-scroll">
                {aiDebugger.loading ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                    <div className="loading-spinner" style={{ marginBottom: '16px', fontSize: '24px' }}>⚙️</div>
                    Analyzing request and response...
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {aiDebugger.explanation && (
                      <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <strong style={{ display: 'block', marginBottom: '12px', color: '#10a37f', fontSize: '14px' }}>Explanation:</strong>
                        <ReactMarkdown
                          components={{
                            p: ({ node, ...props }) => <p style={{ margin: '0 0 10px 0', color: 'var(--text-primary)', fontSize: '13px', lineHeight: '1.6' }} {...props} />,
                            blockquote: ({ node, ...props }) => <blockquote style={{ margin: '0 0 10px 0', padding: '8px 16px', borderLeft: '4px solid #10a37f', color: 'var(--text-muted)', fontStyle: 'italic', background: 'rgba(16, 163, 127, 0.1)' }} {...props} />
                          }}
                        >
                          {aiDebugger.explanation}
                        </ReactMarkdown>
                      </div>
                    )}
                    {aiDebugger.codeFix && (
                      <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <strong style={{ display: 'block', marginBottom: '12px', color: '#8b5cf6', fontSize: '14px' }}>Suggested Fix:</strong>
                        <ReactMarkdown
                          components={{
                            pre: ({ node, ...props }) => <pre style={{ background: '#1e1e1e', padding: '12px', borderRadius: '6px', overflowX: 'auto', border: '1px solid #333' }} {...props} />,
                            code: ({ node, inline, ...props }) => 
                              inline ? <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 4px', borderRadius: '4px', fontSize: '12px' }} {...props} />
                                     : <code style={{ fontSize: '13px', fontFamily: "'Fira Code', monospace" }} {...props} />
                          }}
                        >
                          {aiDebugger.codeFix}
                        </ReactMarkdown>
                      </div>
                    )}
                    {!aiDebugger.loading && !aiDebugger.explanation && (
                      <div style={{ color: 'var(--text-muted)' }}>Click "Debug with AI" to analyze this request.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}
