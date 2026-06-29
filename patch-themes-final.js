const fs = require('fs');

let term = fs.readFileSync('src/renderer/src/components/TerminalPanel.jsx', 'utf8');

// 1. Fix the Fix with AI button color to var(--accent-text) instead of var(--bg-main)
term = term.replace("background: 'var(--accent-color)', color: 'var(--bg-main)'", "background: 'var(--accent-color)', color: 'var(--accent-text)'");

// 2. Add compile-dark to getXtermTheme
if (!term.includes("if (activeTheme === 'compile-dark')")) {
  const compileDarkTheme = 
  if (activeTheme === 'compile-dark') {
    return {
      background: '#232521',
      foreground: '#d4d4d4',
      cursor: '#ebd79e',
      selection: 'rgba(235, 215, 158, 0.3)',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
    }
  }
;
  term = term.replace("const getXtermTheme = (activeTheme) => {", "const getXtermTheme = (activeTheme) => {" + compileDarkTheme);
}

fs.writeFileSync('src/renderer/src/components/TerminalPanel.jsx', term, 'utf8');

// 3. Fix main.css for send-btn, empty-icon, avatar-ai
let mainCss = fs.readFileSync('src/renderer/src/assets/main.css', 'utf8');
mainCss = mainCss.replace(".send-btn {\n    width: 32px;\n    height: 32px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    background: var(--gradient-primary);\n    border: none;\n    border-radius: var(--radius-sm);\n    color: white;\n    cursor: pointer;", ".send-btn {\n    width: 32px;\n    height: 32px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    background: var(--accent-color);\n    border: none;\n    border-radius: var(--radius-sm);\n    color: var(--accent-text);\n    cursor: pointer;");

mainCss = mainCss.replace(".empty-icon {\n    font-size: 48px;\n    font-weight: 800;\n    background: var(--gradient-primary);\n    -webkit-background-clip: text;\n    -webkit-text-fill-color: transparent;\n    background-clip: text;", ".empty-icon {\n    font-size: 48px;\n    font-weight: 800;\n    background: var(--accent-color);\n    -webkit-background-clip: text;\n    -webkit-text-fill-color: transparent;\n    background-clip: text;");

mainCss = mainCss.replace(".avatar-ai {\n    background: var(--gradient-primary);\n    color: white;", ".avatar-ai {\n    background: var(--accent-color);\n    color: var(--accent-text);");

fs.writeFileSync('src/renderer/src/assets/main.css', mainCss, 'utf8');

console.log('Fixed styling!');
