const fs = require('fs');
let content = fs.readFileSync('src/renderer/src/App.jsx', 'utf8');

// Revert the wrong robot emoji replacement (inf🤖 -> info")
content = content.replace(/([a-zA-Z])🤖/g, "$1\"");
content = content.replace(/inf🤖>/g, 'info\">');

// Fix the key emoji 'ðŸ”‘' -> '🔑'
content = content.replace(/ðŸ”‘/g, '🔑');

// Fix box drawing characters 'â”€' -> '─'
content = content.replace(/â”€/g, '─');

fs.writeFileSync('src/renderer/src/App.jsx', content, 'utf8');
console.log('Fixed App.jsx');
