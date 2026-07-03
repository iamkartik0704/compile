const fs = require('fs');
const babel = require('@babel/core');

const code = fs.readFileSync('src/renderer/src/App.jsx', 'utf8');

try {
  babel.transformSync(code, {
    presets: ['@babel/preset-react'],
    ast: true
  });
  console.log("Babel parse successful.");
} catch (e) {
  console.error("Babel Error:", e.message);
}
