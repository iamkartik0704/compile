const fs = require('fs');
const acorn = require('acorn');
const jsx = require('acorn-jsx');

const code = fs.readFileSync('src/renderer/src/App.jsx', 'utf8');

try {
  acorn.Parser.extend(jsx()).parse(code, { sourceType: 'module', ecmaVersion: 2020 });
  console.log("Acorn parsing successful.");
} catch (e) {
  console.error("Acorn Error:", e.message, "at line", e.loc ? e.loc.line : "unknown");
}
