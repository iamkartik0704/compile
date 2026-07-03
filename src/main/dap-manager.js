import { spawn, exec } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'
import fs from 'fs'
import WebSocket from 'ws'
import net from 'net'

class DebugAdapter extends EventEmitter {
  constructor(filePath) {
    super()
    this.filePath = filePath
    this.process = null
  }
  async start() { throw new Error('Not implemented') }
  async stop() { throw new Error('Not implemented') }
  async sendRequest(command, args) { throw new Error('Not implemented') }
}

class NodeAdapter extends DebugAdapter {
  constructor(filePath) {
    super(filePath)
    this.ws = null
    this.seq = 1
    this.pendingRequests = new Map()
    this.currentScopeId = null
  }
  
  async start() {
    return new Promise((resolve, reject) => {
      this.process = spawn('node', ['--inspect-brk=0', this.filePath], { cwd: path.dirname(this.filePath) })
      
      let stderrAcc = ''
      this.process.stderr.on('data', (data) => {
        const text = data.toString()
        stderrAcc += text
        const match = stderrAcc.match(/ws:\/\/[^\s]+/)
        if (match && !this.ws) {
          this.connectWs(match[0], resolve, reject)
        }
      })
      
      this.process.on('close', (code) => {
        if (!this.ws) reject(new Error(`Node exited with code ${code} before debugger could attach. Error: ${stderrAcc}`))
        this.emit('dap-output', `Node exited with code ${code}\n`)
        this.emit('dap-exit')
      })
    })
  }
  
  connectWs(url, resolve, reject) {
    this.ws = new WebSocket(url)
    this.ws.on('open', async () => {
      await this.sendCdp('Runtime.enable')
      await this.sendCdp('Debugger.enable')
      await this.sendCdp('Runtime.runIfWaitingForDebugger')
      resolve(true)
    })
    
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.id && this.pendingRequests.has(msg.id)) {
        const p = this.pendingRequests.get(msg.id)
        this.pendingRequests.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
      } else if (msg.method === 'Debugger.paused') {
        const frames = msg.params.callFrames.map(f => ({
          name: f.functionName || '(anonymous)',
          line: f.location.lineNumber + 1,
          id: f.callFrameId
        }))
        const callFrame = msg.params.callFrames[0]
        const line = callFrame.location.lineNumber + 1
        const localScope = callFrame.scopeChain.find(s => s.type === 'local')
        if (localScope) this.currentScopeId = localScope.object.objectId
        this.currentCallFrameId = callFrame.callFrameId
        this.emit('dap-paused', { line, callFrames: frames })
      } else if (msg.method === 'Debugger.resumed') {
        this.emit('dap-continue')
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value || a.description).join(' ')
        this.emit('dap-output', text + '\n')
      }
    })
    
    this.ws.on('error', (err) => this.emit('dap-error', err.message))
  }
  
  sendCdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('WS not connected'))
      const id = this.seq++
      this.pendingRequests.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  
  async sendRequest(command, args = {}) {
    switch (command) {
      case 'initialize': return true
      case 'launch': return true
      case 'setBreakpoints': {
        const url = 'file://' + this.filePath.replace(/\\/g, '/')
        console.log('[DAP] setBreakpoints received', args.breakpoints)
        for (const bp of args.breakpoints) {
          const urlRegex = '.*' + path.basename(this.filePath)
          const lineNumber = bp.line - 1
          console.log(`[DAP] Setting BP: urlRegex=${urlRegex}, line=${lineNumber}`)
          await this.sendCdp('Debugger.setBreakpointByUrl', {
            urlRegex,
            lineNumber
          })
        }
        return { breakpoints: args.breakpoints.map(b => ({ verified: true, line: b.line })) }
      }
      case 'continue': 
        await this.sendCdp('Debugger.resume')
        return true
      case 'next':
        await this.sendCdp('Debugger.stepOver')
        return true
      case 'stepIn':
        await this.sendCdp('Debugger.stepInto')
        return true
      case 'stepOut':
        await this.sendCdp('Debugger.stepOut')
        return true
      case 'evaluate': {
        if (!this.currentCallFrameId) return { result: 'error: no frame' }
        const res = await this.sendCdp('Debugger.evaluateOnCallFrame', {
          callFrameId: this.currentCallFrameId,
          expression: args.expression,
          returnByValue: true
        }).catch(e => ({ result: { type: 'error', description: e.message } }))
        if (res.result && res.result.type !== 'error') {
           return { result: String(res.result.value) }
        }
        return { result: res.result ? res.result.description : 'error' }
      }
      case 'variables': {
        if (!this.currentScopeId) return { variables: [] }
        const props = await this.sendCdp('Runtime.getProperties', {
          objectId: this.currentScopeId,
          ownProperties: true
        })
        const vars = props.result.map(p => ({
          name: p.name,
          value: p.value ? p.value.description || String(p.value.value) : 'undefined',
          type: p.value ? p.value.type : 'undefined'
        }))
        return { variables: vars }
      }
      default: return true
    }
  }
  
  stop() {
    if (this.ws) this.ws.close()
    if (this.process) this.process.kill()
  }
}

class PythonAdapter extends DebugAdapter {
  constructor(filePath) {
    super(filePath)
    this.socket = null
    this.buffer = ''
    this.lastThreadId = null
  }
  
  async start() {
    return new Promise((resolve, reject) => {
      this.process = spawn('python', ['-m', 'debugpy', '--listen', '5678', '--wait-for-client', this.filePath], { cwd: path.dirname(this.filePath) })
      
      this.process.stdout.on('data', data => this.emit('dap-output', data.toString()))
      this.process.stderr.on('data', data => {
        this.emit('dap-output', data.toString())
      })
      
      setTimeout(() => {
        this.socket = net.createConnection({ port: 5678, host: '127.0.0.1' }, () => {
          resolve(true)
        })
        
        this.socket.on('data', (data) => {
          this.buffer += data.toString()
          while (true) {
            const match = this.buffer.match(/Content-Length: (\d+)\r\n\r\n/)
            if (!match) break
            const length = parseInt(match[1])
            const headerLength = match[0].length
            if (this.buffer.length >= headerLength + length) {
              const bodyStr = this.buffer.substring(headerLength, headerLength + length)
              this.buffer = this.buffer.substring(headerLength + length)
              
              try {
                const msg = JSON.parse(bodyStr)
                if (msg.type === 'response') {
                  this.emit('dap-response', msg)
                } else if (msg.type === 'event') {
                  if (msg.event === 'stopped') {
                    this.lastThreadId = msg.body.threadId
                    this.emit('dap-paused', { line: 1 })
                  } else if (msg.event === 'output') {
                    this.emit('dap-output', msg.body.output)
                  }
                }
              } catch(e) {}
            } else {
              break
            }
          }
        })
        
        this.socket.on('error', err => reject(err))
      }, 500)
    })
  }
  
  async sendRequest(command, args = {}) {
    if (command === 'variables' && this.lastThreadId) {
      const stack = await this._sendRaw('stackTrace', { threadId: this.lastThreadId })
      if (!stack.stackFrames || stack.stackFrames.length === 0) return { variables: [] }
      const frameId = stack.stackFrames[0].id
      const scopes = await this._sendRaw('scopes', { frameId })
      const locals = scopes.scopes.find(s => s.name === 'Locals') || scopes.scopes[0]
      const vars = await this._sendRaw('variables', { variablesReference: locals.variablesReference })
      return { variables: vars.variables }
    }
    return await this._sendRaw(command, args)
  }
  
  _sendRaw(command, args) {
    return new Promise((resolve) => {
      const seq = Math.floor(Math.random() * 1000000)
      const req = { seq, type: 'request', command, arguments: args }
      const json = JSON.stringify(req)
      const msg = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`
      
      const onResponse = (res) => {
        if (res.request_seq === seq) {
          this.removeListener('dap-response', onResponse)
          resolve(res.body || {})
        }
      }
      this.on('dap-response', onResponse)
      if (this.socket) this.socket.write(msg)
    })
  }
  
  stop() {
    if (this.socket) this.socket.destroy()
    if (this.process) this.process.kill()
  }
}

class GdbAdapter extends DebugAdapter {
  constructor(filePath) {
    super(filePath)
    this.buffer = ''
    this.pendingCommands = []
  }
  
  async start() {
    return new Promise((resolve, reject) => {
      const exePath = this.filePath.replace(/\.(cpp|c)$/, process.platform === 'win32' ? '.exe' : '')
      exec(`g++ -g "${this.filePath}" -o "${exePath}"`, (err) => {
        if (err) {
          this.emit('dap-error', `Compilation failed: ${err.message}`)
          return reject(err)
        }
        
        this.process = spawn('gdb', ['-q', '--interpreter=mi', exePath], { cwd: path.dirname(this.filePath) })
        
        this.process.stdout.on('data', (data) => {
          fs.appendFileSync(path.join(path.dirname(this.filePath), 'gdb_debug.log'), 'STDOUT CHUNK: ' + data.toString() + '\n')
          this.buffer += data.toString()
          const lines = this.buffer.split('\n')
          this.buffer = lines.pop() // Keep the last incomplete line in the buffer
          for (let line of lines) {
            line = line.trim()
            if (!line) continue
            
            if (line.startsWith('*stopped')) {
              if (line.includes('reason="exited-normally"') || line.includes('reason="exited"')) {
                this.emit('dap-exit')
              } else {
                const lineMatch = line.match(/line="(\d+)"/)
                const ln = lineMatch ? parseInt(lineMatch[1]) : 1
                this.emit('dap-paused', { line: ln })
              }
            } else if (line.startsWith('^done') || line.startsWith('^error') || line.startsWith('^running')) {
              if (this.pendingCommands.length > 0) {
                const cb = this.pendingCommands.shift()
                cb(line)
              }
            } else if (line.startsWith('~')) {
              const text = line.substring(1).replace(/"/g, '').replace(/\\n/g, '\n')
              this.emit('dap-output', text)
            }
          }
        })
        
        this.process.stderr.on('data', data => {
          this.emit('dap-error', data.toString())
        })
        resolve(true)
      })
    })
  }
  
  _sendMi(cmd) {
    return new Promise((resolve) => {
      this.pendingCommands.push(resolve)
      fs.appendFileSync(path.join(path.dirname(this.filePath), 'gdb_debug.log'), 'STDIN: ' + cmd + '\n')
      this.process.stdin.write(cmd + '\n')
    })
  }
  
  async sendRequest(command, args = {}) {
    switch (command) {
      case 'initialize': return true
      case 'launch': 
        await this._sendMi('-exec-run')
        return true
      case 'setBreakpoints': 
        for (const bp of args.breakpoints) {
          const safePath = this.filePath.replace(/\\/g, '/')
          await this._sendMi(`-break-insert "${safePath}:${bp.line}"`)
        }
        return { breakpoints: args.breakpoints.map(b => ({ verified: true, line: b.line })) }
      case 'continue': 
        await this._sendMi('-exec-continue')
        return true
      case 'next': 
        await this._sendMi('-exec-next')
        return true
      case 'stepIn':
        await this._sendMi('-exec-step')
        return true
      case 'stepOut':
        await this._sendMi('-exec-finish')
        return true
      case 'evaluate': {
        if (!args.expression) return { result: '' }
        const res = await this._sendMi(`-data-evaluate-expression "${args.expression.replace(/"/g, '\\"')}"`)
        const match = res.match(/value="([^"]+)"/)
        if (match) return { result: match[1] }
        return { result: 'error: unable to evaluate' }
      }
      case 'variables': {
        const res = await this._sendMi('-stack-list-locals 1')
        const vars = []
        // Split by { to process each local variable object separately
        const items = res.split('{')
        for (const item of items) {
          const nameMatch = item.match(/name="([^"]+)"/)
          const valueMatch = item.match(/value="([^"]+)"/)
          if (nameMatch && valueMatch) {
            vars.push({ name: nameMatch[1], value: valueMatch[1], type: 'any' })
          }
        }
        return { variables: vars }
      }
      default: return true
    }
  }
  
  stop() {
    if (this.process) this.process.kill()
  }
}

export class DapManager extends EventEmitter {
  constructor() {
    super()
    this.adapter = null
  }
  
  async start(filePath, language, breakpoints = []) {
    if (this.adapter) {
      this.adapter.stop()
      this.adapter = null
    }
    
    if (language === 'javascript') {
      this.adapter = new NodeAdapter(filePath)
    } else if (language === 'python') {
      this.adapter = new PythonAdapter(filePath)
    } else if (language === 'cpp' || language === 'c') {
      this.adapter = new GdbAdapter(filePath)
    } else {
      throw new Error(`Debugger backend for ${language} not supported yet.`)
    }
    
    this.adapter.on('dap-paused', (data) => this.emit('dap-paused', data))
    this.adapter.on('dap-continue', (data) => this.emit('dap-continue', data))
    this.adapter.on('dap-output', (data) => this.emit('dap-output', data))
    this.adapter.on('dap-error', (data) => this.emit('dap-error', data))
    this.adapter.on('dap-exit', () => this.emit('dap-exit'))
    
    const pausePromise = language === 'javascript' ? new Promise(resolve => this.adapter.once('dap-paused', resolve)) : null
    
    await this.adapter.start()
    await this.adapter.sendRequest('initialize')
    
    if (breakpoints.length > 0) {
      await this.adapter.sendRequest('setBreakpoints', {
        breakpoints: breakpoints.map(l => ({ line: l }))
      })
    }
    
    await this.adapter.sendRequest('launch')
    
    if (language === 'javascript') {
      // Wait for the initial pause from --inspect-brk before sending continue
      await pausePromise
      await this.adapter.sendRequest('continue')
    }
    
    return true
  }
  
  async stop() {
    if (this.adapter) {
      this.adapter.stop()
      this.adapter = null
    }
  }
  
  async sendRequest(command, args = {}) {
    if (!this.adapter) throw new Error('Debugger not running')
    return await this.adapter.sendRequest(command, args)
  }
}
