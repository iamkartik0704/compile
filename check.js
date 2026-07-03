const fs = require('fs'); 
let code = fs.readFileSync('src/renderer/src/App.jsx', 'utf8'); 
let openParen = 0; let openBrace = 0; let openBracket = 0; 
let inString = false; let strChar = ''; let inComment = false; let inMultilineComment = false; 

for (let i = 0; i < code.length; i++) { 
  let c = code[i]; let next = code[i+1]; 
  if (!inString && !inComment && !inMultilineComment && c === '/' && next === '/') { 
    inComment = true; i++; continue; 
  } 
  if (!inString && !inComment && !inMultilineComment && c === '/' && next === '*') { 
    inMultilineComment = true; i++; continue; 
  } 
  if (inComment && c === '\n') { 
    inComment = false; continue; 
  } 
  if (inMultilineComment && c === '*' && next === '/') { 
    inMultilineComment = false; i++; continue; 
  } 
  if (!inComment && !inMultilineComment && (c === "'" || c === '"' || c === '`')) { 
    if (!inString) { inString = true; strChar = c; } 
    else if (inString && c === strChar && code[i-1] !== '\\') { inString = false; } 
  } else if (!inString && !inComment && !inMultilineComment) { 
    if (c === '(') openParen++; 
    else if (c === ')') openParen--; 
    else if (c === '{') openBrace++; 
    else if (c === '}') openBrace--; 
    else if (c === '[') openBracket++; 
    else if (c === ']') openBracket--; 
  } 
} 
console.log('parens:', openParen, 'braces:', openBrace, 'brackets:', openBracket);
