const fs = require('fs');
const path = require('path');
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.js')) {
      results.push(file);
    }
  });
  return results;
}
const files = walk('node_modules/monaco-editor/esm/vs/editor');
let actions = new Set();
files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const matches = content.match(/id:\s*['"](editor\.action\.[a-zA-Z0-9._]+?)['"]/g);
  if (matches) {
    matches.forEach(m => actions.add(m.match(/['"]([^'"]+)['"]/)[1]));
  }
});
console.log(Array.from(actions).sort().join('\n'));
