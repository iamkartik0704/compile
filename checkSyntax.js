const fs = require('fs');

const code = fs.readFileSync('src/renderer/src/App.jsx', 'utf8');

const stack = [];
for (let i = 0; i < code.length; i++) {
  const char = code[i];
  if (char === '{' || char === '(' || char === '[' || char === '<') {
    stack.push({ char, line: code.slice(0, i).split('\n').length });
  } else if (char === '}' || char === ')' || char === ']' || char === '>') {
    if (stack.length > 0) {
      const last = stack[stack.length - 1];
      if ((char === '}' && last.char === '{') ||
          (char === ')' && last.char === '(') ||
          (char === ']' && last.char === '[') ||
          (char === '>' && last.char === '<')) {
        stack.pop();
      }
    }
  }
}

console.log("Remaining unclosed brackets:");
console.log(stack.filter(s => s.char !== '<' && s.char !== '>').slice(-10));
