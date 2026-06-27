import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import '../assets/terminal.css'

export const TerminalPanel = forwardRef(({ height, cwd, onFixWithAi, hideHeader }, ref) => {
  const terminalRef = useRef(null)
  const terminalInstance = useRef(null)
  const fitAddon = useRef(null)
  const terminalId = useRef(null)
  const [isTerminalReady, setIsTerminalReady] = useState(false)

  useEffect(() => {
    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 14,
      theme: {
        background: '#0c0c14',
        foreground: '#e2e2e2',
        cursor: '#f4b1ee',
        selection: '#ffffff40',
        black: '#1e1e1e',
        red: '#f48771',
        green: '#10a37f',
        yellow: '#f4c371',
        blue: '#71a3f4',
        magenta: '#f4b1ee',
        cyan: '#71f4e2',
        white: '#e2e2e2',
      }
    })
    
    const fit = new FitAddon()
    term.loadAddon(fit)

    term.open(terminalRef.current)
    fit.fit()

    terminalInstance.current = term
    fitAddon.current = fit

    let mounted = true

    // Request backend to spawn a pty
    window.api.createTerminal({
      cols: term.cols,
      rows: term.rows,
      cwd
    }).then(id => {
      if (!mounted) {
        window.api.killTerminal(id)
        return
      }
      terminalId.current = id
      setIsTerminalReady(true)

      // Listen for data from the backend pty and write to xterm
      window.api.onTerminalData(id, (data) => {
        term.write(data)
      })

      // Listen for data from xterm (user typing) and send to backend pty
      term.onData((data) => {
        window.api.sendTerminalData(id, data)
      })

      // Handle resize events
      term.onResize(({ cols, rows }) => {
        window.api.resizeTerminal(id, cols, rows)
      })

      window.api.onTerminalExit(id, () => {
        term.write('\r\n[Process exited]\r\n')
      })
    })

    const handleWindowResize = () => {
      if (fitAddon.current && terminalInstance.current) {
        fitAddon.current.fit()
      }
    }
    window.addEventListener('resize', handleWindowResize)

    return () => {
      mounted = false
      window.removeEventListener('resize', handleWindowResize)
      if (terminalId.current !== null) {
        window.api.killTerminal(terminalId.current)
      }
      term.dispose()
    }
  }, [])

  useImperativeHandle(ref, () => ({
    executeCommand: (cmd) => {
      if (terminalId.current !== null) {
        window.api.sendTerminalData(terminalId.current, cmd + '\r')
      }
    },
    getBuffer: () => {
      if (!terminalInstance.current) return ''
      const term = terminalInstance.current
      let bufferText = ''
      for (let i = 0; i < term.buffer.active.length; i++) {
        bufferText += term.buffer.active.getLine(i).translateToString(true) + '\n'
      }
      return bufferText
    },
    write: (text) => {
      if (terminalInstance.current) {
        terminalInstance.current.write(text)
      }
    }
  }))

  // Refit when height changes
  useEffect(() => {
    if (isTerminalReady && fitAddon.current) {
      setTimeout(() => fitAddon.current.fit(), 50)
    }
  }, [height, isTerminalReady])

  return (
    <div className="terminal-container" style={{ height: height ? (typeof height === 'number' ? `${height}px` : height) : '100%', display: 'flex', flexDirection: 'column' }}>
      {!hideHeader && (
        <div className="terminal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: '12px' }}>
          <span className="terminal-title">Terminal</span>
          {onFixWithAi && (
            <button 
              onClick={onFixWithAi} 
              style={{ background: 'var(--accent-color)', color: 'var(--bg-main)', border: 'none', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
            >
              ✨ Fix with AI
            </button>
          )}
        </div>
      )}
      <div className="terminal-wrapper" ref={terminalRef} style={{ flex: 1, overflow: 'hidden' }}></div>
    </div>
  )
})
