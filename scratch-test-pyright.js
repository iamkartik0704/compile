const { spawn } = require('child_process');

const pyright = spawn('node', ['node_modules/pyright/dist/pyright-langserver.js', '--stdio']);
// Alternatively, if pyright-langserver is in .bin, we can use that, but node_modules/pyright/dist/pyright-langserver.js is usually safer.
// Wait, the .bin command exists. Let's just spawn it:
// const pyright = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['pyright-langserver', '--stdio']);

pyright.stdout.on('data', d => console.log('STDOUT:', d.toString()));
pyright.stderr.on('data', d => console.error('STDERR:', d.toString()));
pyright.on('close', c => console.log('CLOSED:', c));

const payload = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    processId: null,
    rootUri: null,
    capabilities: {}
  }
});

const req = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
console.log('Sending req:', req);
pyright.stdin.write(req);

setTimeout(() => pyright.kill(), 5000);
