const pty = require('node-pty')
const os = require('os')

const ptys = {}

// Default shell detection
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
