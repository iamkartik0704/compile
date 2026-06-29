const fs = require('fs');
const files = [
  'src/renderer/src/App.jsx',
  'src/renderer/src/components/CodeEditor.jsx',
  'src/renderer/src/components/ExtensionsPanel.jsx',
  'src/renderer/src/components/ContextInspector.jsx',
  'src/renderer/src/components/TerminalPanel.jsx',
  'src/renderer/src/utils/extensionRegistry.js'
];
files.forEach(f => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, 'utf8');
    content = content.replace(/^\uFEFF/, '');
    
    // Fix 'comπle' variants
    content = content.replace(/comÏ€le/g, 'comπle');
    content = content.replace(/com\?\?le/g, 'comπle');
    content = content.replace(/comI\?le/g, 'comπle');
    
    // Fix 'πlot' variants
    content = content.replace(/Ï€lot/g, 'πlot');
    content = content.replace(/\?\?lot/g, 'πlot');
    content = content.replace(/I\?lot/g, 'πlot');
    
    // Fix random emojis corrupted to ansi
    content = content.replace(/â€“/g, '–');
    content = content.replace(/âœ¨/g, '✨');
    content = content.replace(/ðŸ¤–/g, '🤖');
    content = content.replace(/ðŸ“¦/g, '📦');
    
    // Clean any remaining standalone Ï€
    content = content.replace(/Ï€/g, 'π');

    fs.writeFileSync(f, content, 'utf8');
  }
});
console.log('Fixed encodings.');
