const fs = require('fs');

const code = fs.readFileSync('src/renderer/src/App.jsx', 'utf8');

// A simple stack-based checker that ignores strings and comments
function findMismatch(text) {
    let stack = [];
    let i = 0;
    let line = 1;

    while (i < text.length) {
        let c = text[i];
        
        if (c === '\n') {
            line++;
            i++;
            continue;
        }

        // Handle string literals
        if (c === '"' || c === "'" || c === '`') {
            let quote = c;
            i++;
            while (i < text.length) {
                if (text[i] === '\n') line++;
                if (text[i] === '\\') {
                    i += 2; // skip escaped char
                    continue;
                }
                if (text[i] === quote) {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }

        // Handle comments
        if (c === '/' && text[i+1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && text[i+1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i+1] === '/')) {
                if (text[i] === '\n') line++;
                i++;
            }
            i += 2;
            continue;
        }

        // Check braces/parentheses
        if (c === '{' || c === '(' || c === '[') {
            stack.push({ char: c, line });
        } else if (c === '}' || c === ')' || c === ']') {
            if (stack.length === 0) {
                console.log(`Unmatched closing ${c} at line ${line}`);
            } else {
                let last = stack.pop();
                if ((c === '}' && last.char !== '{') ||
                    (c === ')' && last.char !== '(') ||
                    (c === ']' && last.char !== '[')) {
                    console.log(`Mismatched closing ${c} at line ${line}. Expected to close ${last.char} from line ${last.line}`);
                }
            }
        }
        i++;
    }

    if (stack.length > 0) {
        console.log("Unclosed brackets remaining:");
        stack.forEach(s => console.log(`${s.char} at line ${s.line}`));
    } else {
        console.log("All brackets matched!");
    }
}

findMismatch(code);
