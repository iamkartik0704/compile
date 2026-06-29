const fs = require('fs');

function replaceSafely(file, search, replace) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.split(search).join(replace);
  fs.writeFileSync(file, content, 'utf8');
}

// 1. CodeEditor.jsx
replaceSafely(
  'src/renderer/src/components/CodeEditor.jsx',
  "background: '#0e639c', color: 'white', border: 'none'",
  "background: 'var(--accent-color)', color: 'var(--accent-text)', border: 'none'"
);

// 2. ExtensionsPanel.jsx
replaceSafely(
  'src/renderer/src/components/ExtensionsPanel.jsx',
  "background: '#007acc', color: 'white', border: 'none'",
  "background: 'var(--accent-color)', color: 'var(--accent-text)', border: 'none'"
);

// 3. TerminalPanel.jsx
replaceSafely(
  'src/renderer/src/components/TerminalPanel.jsx',
  "cursor: '#ffffff',\n    selection: '#264f78',",
  "cursor: '#ebd79e',\n    selection: 'rgba(235, 215, 158, 0.3)',"
);

console.log('Restored styling changes safely.');
