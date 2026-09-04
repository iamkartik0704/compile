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
        const paramDsExpr = buildDsExpr(params);
        // Inject entry snapshot right after def
        result.push(' '.repeat(baseIndent) + `dsa_snapshot(${lineNum}, "function_entry", ${paramVarsJson}, ${paramDsExpr})`);
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
    const currentDsExpr = buildDsExpr(activeVars);
    const indentStr = ' '.repeat(indent + 4);

    // ── FOR loop ──
    if (trimmed.startsWith('for ')) {
      result.push(line);
      result.push(indentStr + `dsa_snapshot(${lineNum}, "loop_iteration", ${currentVarsJson}, ${currentDsExpr})`);
      continue;
    }

    // ── WHILE loop ──
    if (trimmed.startsWith('while ')) {
      result.push(line);
      result.push(indentStr + `dsa_snapshot(${lineNum}, "while_iteration", ${currentVarsJson}, ${currentDsExpr})`);
      continue;
    }

    // ── IF statement ──
    if (trimmed.startsWith('if ') || trimmed.startsWith('elif ')) {
      result.push(line);
      result.push(indentStr + `dsa_snapshot(${lineNum}, "condition_check", ${currentVarsJson}, ${currentDsExpr})`);
      continue;
    }

    // ── ELSE ──
    if (trimmed.startsWith('else:')) {
      result.push(line);
      result.push(indentStr + `dsa_snapshot(${lineNum}, "else_branch", ${currentVarsJson}, ${currentDsExpr})`);
      continue;
    }

    // ── RETURN statement ──
    if (trimmed.startsWith('return ') || trimmed === 'return') {
      result.push(' '.repeat(indent) + `dsa_snapshot(${lineNum}, "return", ${currentVarsJson}, ${currentDsExpr})`);
      result.push(line);
      continue;
    }

    // ── push/pop/append/insert/remove/sort/reverse ──
    if (/\.(append|pop|insert|remove|sort|reverse)\s*\(/.test(trimmed)) {
      result.push(line);
      result.push(' '.repeat(indent) + `dsa_snapshot(${lineNum}, "ds_modify", ${currentVarsJson}, ${currentDsExpr})`);
      continue;
    }

    // ── Variable assignment ──
    if (assignMatch && !trimmed.startsWith('for ')) {
      result.push(line);
      result.push(' '.repeat(indent) + `dsa_snapshot(${lineNum}, "assign", ${currentVarsJson}, ${currentDsExpr})`);
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

function buildDsExpr(varNames) {
  if (varNames.length === 0) return 'None';
  // Pick the first declared complex object (usually the input parameter)
  let expr = 'None';
  for (let i = varNames.length - 1; i >= 0; i--) {
    const v = varNames[i];
    expr = `${v} if isinstance(${v}, (list, dict)) or hasattr(${v}, "__dict__") else (${expr})`;
  }
  return expr;
}
