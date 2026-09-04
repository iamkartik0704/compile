export function instrumentJsSolution(userCode) {
  const lines = userCode.split('\n');
  const result = [];
  
  // Try to find the function signature to get parameters
  const funcRe = /(?:var|let|const)\s+([a-zA-Z_]\w*)\s*=\s*function\s*\(([^)]*)\)/;
  const funcDeclRe = /function\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)/;
  
  let m = userCode.match(funcRe) || userCode.match(funcDeclRe);
  let params = [];
  if (m && m[2]) {
    params = m[2].split(',').map(s => s.trim()).filter(s => s);
  }

  // We don't have "methods" like in C++, it's just a top-level function.
  // We'll process the whole file line by line.

  let currentDepth = 0;
  const scopes = [[...params]];
  
  const getKnownVars = () => scopes.flat();

  let insideFunction = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1;

    // Detect function start
    if (!insideFunction && (funcRe.test(line) || funcDeclRe.test(line))) {
      insideFunction = true;
      result.push(line);
      
      const paramVarsJson = buildVarsJson(params);
      const paramDsJson = buildDsJson(params); // we don't know types in JS, just guess based on name or treat as normal var
      result.push(`  dsa_snapshot(1, "function_entry", ${paramVarsJson}, null);`);
      
      // Count opening brace if it's on this line
      if (trimmed.includes('{')) {
        currentDepth++;
        if (scopes.length <= currentDepth) scopes.push([]);
      }
      continue;
    }

    if (!insideFunction) {
      result.push(line);
      continue;
    }

    // Adjust brace depth BEFORE processing the line
    for (const ch of trimmed) {
      if (ch === '{') {
        currentDepth++;
        if (scopes.length <= currentDepth) {
          scopes.push([]);
        }
      } else if (ch === '}') {
        if (currentDepth > 0) {
          scopes[currentDepth] = [];
          currentDepth--;
        }
      }
    }

    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      result.push(line);
      continue;
    }

    // Detect variable declarations
    const declMatch = detectVarDeclaration(trimmed);
    if (declMatch) {
      scopes[currentDepth].push(declMatch.name);
    }

    const activeVars = getKnownVars();
    const currentVarsJson = buildVarsJson(activeVars);
    
    // ── FOR loop ──
    if (/^\s*for\s*\(/.test(trimmed)) {
      result.push(line);
      result.push(`      dsa_snapshot(${lineNum}, "loop_iteration", ${currentVarsJson}, null);`);
      continue;
    }

    // ── WHILE loop ──
    if (/^\s*while\s*\(/.test(trimmed)) {
      result.push(line);
      result.push(`      dsa_snapshot(${lineNum}, "while_iteration", ${currentVarsJson}, null);`);
      continue;
    }

    // ── IF statement ──
    if (/^\s*if\s*\(/.test(trimmed) || /^\s*\}\s*else\s+if\s*\(/.test(trimmed)) {
      result.push(line);
      result.push(`      dsa_snapshot(${lineNum}, "condition_check", ${currentVarsJson}, null);`);
      continue;
    }

    // ── ELSE ──
    if (/^\s*\}\s*else\s*\{/.test(trimmed) || trimmed === 'else{' || trimmed === 'else {' || trimmed === '}else{') {
      result.push(line);
      result.push(`      dsa_snapshot(${lineNum}, "else_branch", ${currentVarsJson}, null);`);
      continue;
    }

    // ── RETURN statement ──
    if (/^\s*return\b/.test(trimmed)) {
      result.push(`      dsa_snapshot(${lineNum}, "return", ${currentVarsJson}, null);`);
      result.push(line);
      continue;
    }

    // ── push/pop/shift/unshift/splice ──
    if (/\.(push|pop|shift|unshift|splice|sort|reverse)\s*\(/.test(trimmed)) {
      result.push(line);
      result.push(`      dsa_snapshot(${lineNum}, "ds_modify", ${currentVarsJson}, null);`);
      continue;
    }

    // ── Variable assignment ──
    if (!declMatch && /[a-zA-Z_]\w*\s*(\[.*?\])?\s*(=|\+=|-=|\*=|\/=)\s*[^=]/.test(trimmed) && !trimmed.startsWith('for')) {
      result.push(line);
      result.push(`      dsa_snapshot(${lineNum}, "assign", ${currentVarsJson}, null);`);
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

function detectVarDeclaration(line) {
  // Check for normal declarations
  let m = line.match(/^\s*(?:let|const|var)\s+([a-zA-Z_]\w*)\s*[=;]/);
  if (m) return { name: m[1].trim() };
  
  // Check for for-loop declarations: for (let i = 0; ...)
  m = line.match(/^\s*for\s*\(\s*(?:let|const|var)\s+([a-zA-Z_]\w*)\s*[=;]/);
  if (m) return { name: m[1].trim() };
  
  // Check for for-of / for-in declarations: for (let item of arr)
  m = line.match(/^\s*for\s*\(\s*(?:let|const|var)\s+([a-zA-Z_]\w*)\s+(?:of|in)\s+/);
  if (m) return { name: m[1].trim() };

  return null;
}

function buildVarsJson(varNames) {
  if (varNames.length === 0) return 'null';
  const vars = [...new Set(varNames)].slice(0, 8); // deduplicate params and vars
  
  const parts = vars.map((name, idx) => {
    return `"${name}": typeof ${name} !== 'undefined' ? ${name} : null`;
  });
  
  return `{${parts.join(', ')}}`;
}

function buildDsJson(varNames) {
  // In JS it's harder to statically know what's an array without a TS parser.
  // We can just rely on JSON.stringify on the variables block itself, which will dump arrays.
  return 'null';
}
