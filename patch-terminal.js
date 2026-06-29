const fs = require('fs');

let term = fs.readFileSync('src/renderer/src/components/TerminalPanel.jsx', 'utf8');

// 1. Add compile-dark theme to getXtermTheme
if (!term.includes("if (activeTheme === 'compile-dark')")) {
  const compileDarkTheme = 
  if (activeTheme === 'compile-dark') {
    return {
      background: '#111111',
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

// 2. Fix the Fix with AI button text color
term = term.replace("background: 'var(--accent-color)', color: 'var(--bg-main)'", "background: 'var(--accent-color)', color: 'var(--accent-text)'");

fs.writeFileSync('src/renderer/src/components/TerminalPanel.jsx', term, 'utf8');
console.log('TerminalPanel.jsx updated successfully!');
