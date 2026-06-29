const fs = require('fs');
let content = fs.readFileSync('src/renderer/src/App.jsx', 'utf8');

if (!content.includes('import { ErrorBoundary }')) {
  content = content.replace(
    import { CodeEditor } from './components/CodeEditor',
    import { ErrorBoundary } from './components/ErrorBoundary'\nimport { CodeEditor } from './components/CodeEditor'
  );
}

const targetStart = <CodeEditor;
const targetEnd = />;
let startIndex = content.indexOf(targetStart, content.indexOf('<div style={{ flex: 1, minHeight: 0, overflow: ''hidden'' }}>'));

if (startIndex !== -1) {
  let endIndex = content.indexOf(targetEnd, startIndex);
  if (endIndex !== -1) {
    let before = content.substring(0, startIndex);
    let middle = content.substring(startIndex, endIndex + 2);
    let after = content.substring(endIndex + 2);
    content = before + '<ErrorBoundary>\n' + middle + '\n</ErrorBoundary>' + after;
  }
}

fs.writeFileSync('src/renderer/src/App.jsx', content);
console.log('App.jsx updated with ErrorBoundary.');
