const fs = require('fs');
const babel = require('@babel/core');

const code = fs.readFileSync('src/renderer/src/App.jsx', 'utf8');

try {
  babel.parseSync(code, {
    filename: 'App.jsx',
    parserOpts: {
      plugins: [
        'jsx',
        'optionalChaining',
        'nullishCoalescingOperator',
        'optionalCatchBinding'
      ]
    }
  });
  console.log("Parse successful!");
} catch (e) {
  console.error("ERROR:");
  console.error(e.message);
}
