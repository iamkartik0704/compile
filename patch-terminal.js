const fs = require('fs');
const file = 'src/renderer/src/components/TerminalPanel.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Change to forwardRef
content = content.replace(
  "import React, { useEffect, useRef, useState } from 'react'",
  "import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'"
);

content = content.replace(
  "export const TerminalPanel = ({ height, cwd }) => {",
  "export const TerminalPanel = forwardRef(({ height, cwd }, ref) => {"
);

// 2. Add useImperativeHandle before return
const imperativeHandleCode = `  useImperativeHandle(ref, () => ({
    executeCommand: (cmd) => {
      if (terminalId.current !== null) {
        window.api.sendTerminalData(terminalId.current, cmd + '\\r')
      }
    },
    getBuffer: () => {
      if (terminalInstance.current) {
        const buffer = terminalInstance.current.buffer.active
        const length = buffer.length
        let text = ''
        // Get the last 100 lines max
        const start = Math.max(0, length - 100)
        for (let i = start; i < length; i++) {
          const line = buffer.getLine(i)
          if (line) text += line.translateToString(true) + '\\n'
        }
        return text
      }
      return ''
    }
  }))

  return (`;

content = content.replace("  return (", imperativeHandleCode);

// 3. Fix the closing brace
content += "})\n";

fs.writeFileSync(file, content);
console.log('TerminalPanel refactored');
