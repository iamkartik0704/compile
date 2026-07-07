const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const pyright = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['pyright-langserver', '--stdio'], { shell: true });

pyright.stdout.on('data', d => console.log('STDOUT:', d.toString()));
pyright.stderr.on('data', d => console.error('STDERR:', d.toString()));
pyright.on('close', c => console.log('CLOSED:', c));

const brokenPyPath = path.resolve('dev-fixtures', 'broken.py');
const rootUri = 'file:///' + path.dirname(brokenPyPath).replace(/\\/g, '/');
const fileUri = 'file:///' + brokenPyPath.replace(/\\/g, '/');

const initPayload = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    processId: process.pid,
    rootUri: rootUri,
    capabilities: {}
  }
});

const send = (payload) => {
  const req = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
  console.log('Sending req length:', Buffer.byteLength(payload));
  pyright.stdin.write(req);
};

send(initPayload);

setTimeout(() => {
  console.log('Sending initialized and didOpen');
  send(JSON.stringify({
    jsonrpc: "2.0",
    method: "initialized",
    params: {}
  }));

  const text = fs.readFileSync(brokenPyPath, 'utf8');
  send(JSON.stringify({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri: fileUri,
        languageId: "python",
        version: 1,
        text: text
      }
    }
  }));
}, 2000);

setTimeout(() => {
  console.log('Timeout. Killing.');
  pyright.kill();
}, 8000);
