const cp = require('child_process');
const child = cp.spawn('clangd', []);
const request = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { processId: null, rootUri: null, capabilities: {} }
};
const didOpen = {
  jsonrpc: '2.0',
  method: 'textDocument/didOpen',
  params: {
    textDocument: {
      uri: 'file:///c:/Users/iamka/Desktop/comiple ide testing 2/test.cpp',
      languageId: 'cpp',
      version: 1,
      text: 'int my_awesome_variable = 5;\nint main() {\n  my_a\n  return 0;\n}'
    }
  }
};
const completion = {
  jsonrpc: '2.0',
  id: 2,
  method: 'textDocument/completion',
  params: {
    textDocument: { uri: 'file:///c:/Users/iamka/Desktop/comiple ide testing 2/test.cpp' },
    position: { line: 2, character: 6 },
    context: { triggerKind: 1 }
  }
};
const send = (msg) => {
  const str = JSON.stringify(msg);
  child.stdin.write('Content-Length: ' + str.length + '\r\n\r\n' + str);
};
let out = '';
child.stdout.on('data', d => {
  out += d.toString();
  if (out.includes('"id":2')) {
    const match = out.match(/"id":2,.*?(\{.*\})/);
    if (match) {
        console.log(match[0].substring(0, 500));
        child.kill();
    }
  }
});
send(request);
setTimeout(() => send(didOpen), 1000);
setTimeout(() => send(completion), 2000);
setTimeout(() => child.kill(), 5000);
