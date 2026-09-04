export function instrumentPySolution(userCode) {
  const lines = userCode.split('\n');
  const result = [];
  
  // Find method signature
  const methodRe = /def\s+([a-zA-Z_]\w*)\s*\(\s*self\b([^)]*)\)/;
  let params = [];
  let baseIndent = 0;
  let insideMethod = false;

  const scopes = []; // array of {indent, vars: [name, name]}

  const getKnownVars = () => scopes.flatMap(s => s.vars);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1;
    const indent = line.length - line.trimStart().length;

    if (!insideMethod) {
      result.push(line);
      const m = line.match(methodRe);
      if (m) {
        insideMethod = true;
        baseIndent = indent + 4; // standard 4 spaces
        if (m[2]) {
          // parse params
          const paramStr = m[2].replace(/[:,]/g, ' ').replace(/List\[.*?\]/g, '');
          params = paramStr.split(' ').map(s => s.trim()).filter(s => s && s !== 'self' && s !== '->');
        }
        scopes.push({ indent: baseIndent, vars: [...params] });
        
        const paramVarsJson = buildVarsJson(params);
        // Inject entry snapshot right after def
        result.push(' '.repeat(baseIndent) + `dsa_snapshot(${lineNum}, "function_entry", ${paramVarsJson}, None)`);
      }
      continue;
    }

    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line);
      continue;
    }

    // Check if we exited the method
    if (indent < baseIndent) {
      insideMethod = false;
      result.push(line);
      continue;
    }

    // Pop scopes that have higher indent than current line
    while (scopes.length > 0 && scopes[scopes.length - 1].indent > indent) {
      scopes.pop();
    }
    // Ensure we have a scope for current indent
    if (scopes.length === 0 || scopes[scopes.length - 1].indent < indent) {
      scopes.push({ indent: indent, vars: [] });
    }

    const currentScope = scopes[scopes.length - 1];

    // Detect variable assignments: x = 5, or x, y = 5, 6
    const assignMatch = trimmed.match(/^([a-zA-Z_]\w*(?:\s*,\s*[a-zA-Z_]\w*)*)\s*=/);
    if (assignMatch && !trimmed.startsWith('if ') && !trimmed.startsWith('while ') && !trimmed.startsWith('for ')) {
      const vars = assignMatch[1].split(',').map(s => s.trim());
      for (const v of vars) {
        if (!currentScope.vars.includes(v)) currentScope.vars.push(v);
      }
    }

    const activeVars = getKnownVars();
    const currentVarsJson = buildVarsJson(activeVars);
    const indentStr = ' '.repeat(indent + 4);

    // ── FOR loop ──
    if (trimmed.startsWith('for ')) {
      result.push(line);
      result.push(indentStr + `dsa_snapshot(${lineNum}, "loop_iteration", ${currentVarsJson}, None)`);
      continue;
    }

    // ── WHILE loop ──
    if (trimmed.startsWith('while ')) {
      result.push(line);
      result.push(indentStr + `dsa_snapshot(${lineNum}, "while_iteration", ${currentVarsJson}, None)`);
      continue;
    }

    // ── IF statement ──
    if (trimmed.startsWith('if ') || trimmed.startsWith('elif ')) {
      result.push(line);
      result.push(indentStr + `dsa_snapshot(${lineNum}, "condition_check", ${currentVarsJson}, None)`);
      continue;
    }

    // ── ELSE ──
    if (trimmed.startsWith('else:')) {
      result.push(line);
      result.push(indentStr + `dsa_snapshot(${lineNum}, "else_branch", ${currentVarsJson}, None)`);
      continue;
    }

    // ── RETURN statement ──
    if (trimmed.startsWith('return ') || trimmed === 'return') {
      result.push(' '.repeat(indent) + `dsa_snapshot(${lineNum}, "return", ${currentVarsJson}, None)`);
      result.push(line);
      continue;
    }

    // ── push/pop/append/insert/remove/sort/reverse ──
    if (/\.(append|pop|insert|remove|sort|reverse)\s*\(/.test(trimmed)) {
      result.push(line);
      result.push(' '.repeat(indent) + `dsa_snapshot(${lineNum}, "ds_modify", ${currentVarsJson}, None)`);
      continue;
    }

    // ── Variable assignment ──
    if (assignMatch && !trimmed.startsWith('for ')) {
      result.push(line);
      result.push(' '.repeat(indent) + `dsa_snapshot(${lineNum}, "assign", ${currentVarsJson}, None)`);
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

function buildVarsJson(varNames) {
  if (varNames.length === 0) return '{}';
  const vars = [...new Set(varNames)].slice(0, 8); // deduplicate
  const parts = vars.map(name => `"${name}": ${name}`);
  return `{${parts.join(', ')}}`;
}
