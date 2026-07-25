import { ipcMain, app } from 'electron'
import os from 'os'
import path from 'path'

class TerminalManager {
  constructor() {
    this.nextId = 1
    this.ptys = {}
    this.terminalWindows = {} // Map of terminal ID to webContents
  }

  getPty() {
    let ptyPath = 'node-pty'
    if (app.isPackaged) {
      ptyPath = path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'node_modules', 'node-pty')
    }
    return require(ptyPath)
  }

  getDefaultShell() {
    if (os.platform() === 'win32') {
      return process.env.COMSPEC || 'powershell.exe'
    }
    if (os.platform() === 'darwin') {
      return process.env.SHELL || '/bin/zsh'
    }
    return process.env.SHELL || '/bin/bash'
  }

  init() {
    if (this._handlersRegistered) return
    this._handlersRegistered = true

    let pty;
    try {
      pty = this.getPty()
    } catch (err) {
      console.error('Failed to load node-pty:', err)
      return
    }

    // Spawn a new terminal
    ipcMain.handle('create-terminal', (event, options = {}) => {
      const id = this.nextId++
      this.terminalWindows[id] = event.sender

      try {
        const shell = options.shell || this.getDefaultShell()
        const ptyProcess = pty.spawn(shell, [], {
          name: 'xterm-color',
          cols: options.cols || 80,
          rows: options.rows || 24,
          cwd: options.cwd || process.env.HOME || process.cwd(),
          env: process.env
        })

        this.ptys[id] = ptyProcess

        ptyProcess.onData((data) => {
          const sender = this.terminalWindows[id]
          if (sender && !sender.isDestroyed()) {
            sender.send(`terminal-data-${id}`, data)
          }
        })

        ptyProcess.onExit((e) => {
          const sender = this.terminalWindows[id]
          if (sender && !sender.isDestroyed()) {
            sender.send(`terminal-exit-${id}`, { exitCode: e.exitCode })
          }
          delete this.ptys[id]
          delete this.terminalWindows[id]
        })

        return id
      } catch (err) {
        console.error('Failed to create terminal:', err)
        return null
      }
    })

    // Resize terminal
    ipcMain.handle('resize-terminal', (event, { id, cols, rows }) => {
      const ptyProcess = this.ptys[id]
      if (ptyProcess) {
        try { ptyProcess.resize(cols, rows) } catch (e) {}
      }
    })

    // Write data to terminal (from user input)
    ipcMain.handle('send-terminal-data', (event, { id, data }) => {
      const ptyProcess = this.ptys[id]
      if (ptyProcess) {
        try { ptyProcess.write(data) } catch (e) {}
      }
    })

    // Kill terminal
    ipcMain.handle('kill-terminal', (event, id) => {
      const ptyProcess = this.ptys[id]
      if (ptyProcess) {
        try { ptyProcess.kill() } catch (e) {}
        delete this.ptys[id]
        delete this.terminalWindows[id]
      }
    })
  }

  killAll() {
    for (const id of Object.keys(this.ptys)) {
      try { this.ptys[id].kill() } catch (e) {}
    }
    this.ptys = {}
  }
}

export const terminalManager = new TerminalManager()
