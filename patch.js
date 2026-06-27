const fs = require('fs');
const file = 'src/renderer/src/App.jsx';
let content = fs.readFileSync(file, 'utf8');

const marker = `          } else {
            console.warn(\`Ignoring edit for \${editPath} (active file is \${activeFile})\`)
          }
        }`;

const insert = `
        if (!hasMatches) {
          const searchReplaceRegex = /<search>([\\s\\S]*?)<\\/search>\\s*<replace>([\\s\\S]*?)<\\/replace>/g;
          let srMatch = searchReplaceRegex.exec(finalMsg);
          if (srMatch !== null) {
            window.dispatchEvent(new CustomEvent('auto-apply-diff', {
              detail: { path: activeFile, body: srMatch[0] }
            }));
          }
        }`;

content = content.replace(marker, marker + insert);
fs.writeFileSync(file, content);
console.log("Done");
