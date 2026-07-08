import { ipcMain } from 'electron'
import { spawn } from 'child_process'

const ptyHostCode = `
const pty = require(process.env.PTY_PATH || 'node-pty')
const os = require('os')

const ptys = {}

function getDefaultShell() {
  if (os.platform() === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

process.on('message', (msg) => {
  try {
    if (msg.type === 'create') {
      const shell = msg.shell || getDefaultShell()
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: msg.cols || 80,
        rows: msg.rows || 24,
        cwd: msg.cwd || process.env.HOME || process.cwd(),
        env: process.env
      })

      ptys[msg.id] = ptyProcess

      ptyProcess.onData((data) => {
        process.send({ type: 'data', id: msg.id, data })
      })

      ptyProcess.onExit((e) => {
        process.send({ type: 'exit', id: msg.id, exitCode: e.exitCode })
        delete ptys[msg.id]
      })

      process.send({ type: 'created', id: msg.id })

    } else if (msg.type === 'resize') {
      const ptyProcess = ptys[msg.id]
      if (ptyProcess) {
        ptyProcess.resize(msg.cols, msg.rows)
      }
    } else if (msg.type === 'data') {
      const ptyProcess = ptys[msg.id]
      if (ptyProcess) {
        ptyProcess.write(msg.data)
      }
    } else if (msg.type === 'kill') {
      const ptyProcess = ptys[msg.id]
      if (ptyProcess) {
        ptyProcess.kill()
        delete ptys[msg.id]
      }
    }
  } catch (err) {
    process.send({ type: 'error', id: msg.id, error: err.message })
  }
})

// Keep alive
setInterval(() => {}, 1000 * 60 * 60)
`

class TerminalManager {
  constructor() {
    this.nextId = 1
    this.hostProcess = null
    this.pendingResolves = {}
    this.terminalWindows = {} // Map of terminal ID to webContents
  }

  startHostProcess() {
    if (this.hostProcess) return

    // Resolve node-pty path for packaged app
    const { app } = require('electron')
    const path = require('path')
    let ptyPath = 'node-pty'
    
    if (app.isPackaged) {
      ptyPath = path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'node_modules', 'node-pty')
    }

    // Spawn a standard Node process, communicating via IPC
    // Use the Electron executable with ELECTRON_RUN_AS_NODE=1 to guarantee it works in packaged apps!
    this.hostProcess = spawn(process.execPath, ['-e', ptyHostCode], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PTY_PATH: ptyPath },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      windowsHide: true
    })

    this.hostProcess.on('message', (msg) => {
      if (msg.type === 'created' || msg.type === 'error') {
        if (msg.type === 'error') console.error('PTY Host Error:', msg.error)
        if (this.pendingResolves[msg.id]) {
          this.pendingResolves[msg.id]()
          delete this.pendingResolves[msg.id]
        }
        return
      }

      const sender = this.terminalWindows[msg.id]
      if (!sender || sender.isDestroyed()) return

      if (msg.type === 'data') {
        sender.send(`terminal-data-${msg.id}`, msg.data)
      } else if (msg.type === 'exit') {
        sender.send(`terminal-exit-${msg.id}`, { exitCode: msg.exitCode })
        delete this.terminalWindows[msg.id]
      }
    })

    this.hostProcess.on('error', (err) => {
      console.error('Failed to start PTY Host process:', err)
    })
    
    this.hostProcess.on('exit', () => {
      this.hostProcess = null
    })
  }

  init() {
    this.startHostProcess()

    if (this._handlersRegistered) return
    this._handlersRegistered = true

    // Spawn a new terminal
    ipcMain.handle('create-terminal', (event, options = {}) => {
      if (!this.hostProcess) {
        this.startHostProcess()
      }

      const id = this.nextId++
      this.terminalWindows[id] = event.sender

      return new Promise((resolve) => {
        this.pendingResolves[id] = () => resolve(id)

        this.hostProcess.send({
          type: 'create',
          id,
          cols: options.cols,
          rows: options.rows,
          cwd: options.cwd
        })
        
        // Timeout just in case it hangs
        setTimeout(() => {
          if (this.pendingResolves[id]) {
            resolve(id)
            delete this.pendingResolves[id]
          }
        }, 5000)
      })
    })

    // Resize terminal
    ipcMain.handle('resize-terminal', (event, { id, cols, rows }) => {
      if (this.hostProcess) {
        this.hostProcess.send({ type: 'resize', id, cols, rows })
      }
    })

    // Write data to terminal (from user input)
    ipcMain.handle('send-terminal-data', (event, { id, data }) => {
      if (this.hostProcess) {
        this.hostProcess.send({ type: 'data', id, data })
      }
    })

    // Kill terminal
    ipcMain.handle('kill-terminal', (event, id) => {
      if (this.hostProcess) {
        this.hostProcess.send({ type: 'kill', id })
      }
    })
  }

  killAll() {
    if (this.hostProcess) {
      this.hostProcess.kill()
      this.hostProcess = null
    }
  }
}

export const terminalManager = new TerminalManager()
