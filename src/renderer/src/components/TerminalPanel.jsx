import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import '../assets/terminal.css'
import { useAppStore } from '../store/appStore'

const getXtermTheme = (activeTheme) => {
  if (activeTheme === 'compile-dark') {
    return {
      background: '#111111',
      foreground: '#d4d4d4',
      cursor: '#ebd79e',
      selection: 'rgba(235, 215, 158, 0.3)',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
    }
  }

  if (activeTheme === 'light-modern') {
    return {
      background: '#ffffff',
      foreground: '#333333',
      cursor: '#007acc',
      selection: '#007acc40',
      black: '#000000',
      red: '#cd3131',
      green: '#00bc00',
      yellow: '#949800',
      blue: '#0451a5',
      magenta: '#bc05bc',
      cyan: '#0598bc',
      white: '#555555',
    }
  }
  
  if (activeTheme === 'dracula') {
    return {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selection: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
    }
  }
  
  // Default Dark Plus
  return {
    background: '#1e1e1e',
    foreground: '#cccccc',
    cursor: '#ffffff',
    selection: '#264f78',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
  }
}

export const TerminalPanel = forwardRef(({ height, cwd, onFixWithAi, hideHeader }, ref) => {
  const terminalRef = useRef(null)
  const terminalInstance = useRef(null)
  const fitAddon = useRef(null)
  const terminalId = useRef(null)
  const commandQueue = useRef([])
  const [isTerminalReady, setIsTerminalReady] = useState(false)
  const { activeTheme } = useAppStore()

  useEffect(() => {
    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 14,
      theme: getXtermTheme(activeTheme)
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

      // Flush any queued commands
      if (commandQueue.current.length > 0) {
        commandQueue.current.forEach(cmd => {
          window.api.sendTerminalData(id, cmd + '\r')
        })
        commandQueue.current = []
      }

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
  }, []) // Empty dep array for init

  // Update theme when activeTheme changes
  useEffect(() => {
    if (terminalInstance.current) {
      terminalInstance.current.options.theme = getXtermTheme(activeTheme)
    }
  }, [activeTheme])

  useImperativeHandle(ref, () => ({
    executeCommand: (cmd) => {
      if (terminalId.current !== null) {
        window.api.sendTerminalData(terminalId.current, cmd + '\r')
      } else {
        commandQueue.current.push(cmd)
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
              style={{ background: 'var(--accent-color)', color: 'var(--accent-text)', border: 'none', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
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

// force hmr 2
