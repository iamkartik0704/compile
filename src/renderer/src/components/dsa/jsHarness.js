export function buildJsHarness(userCode, sampleInput) {
  // Try to find the main function name
  let funcName = null;
  let paramsStr = "";
  const funcRe = /(?:var|let|const)\s+([a-zA-Z_]\w*)\s*=\s*function\s*\(([^)]*)\)/;
  const funcDeclRe = /function\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)/;
  
  let m = userCode.match(funcRe);
  if (m) { funcName = m[1]; paramsStr = m[2] || ''; }
  else {
    m = userCode.match(funcDeclRe);
    if (m) { funcName = m[1]; paramsStr = m[2] || ''; }
  }

  if (!funcName) {
    return { ok: false, error: "Couldn't auto-detect the JavaScript function name. Make sure it's defined as 'var myFunc = function...' or 'function myFunc...'" };
  }

  const numParams = paramsStr.split(',').map(p => p.trim()).filter(Boolean).length;
  const args = (Array.isArray(sampleInput) && sampleInput.length === numParams) ? sampleInput : [sampleInput];
  const argsJson = args.map(a => JSON.stringify(a)).join(', ');

  const preamble = `
// ── DSA Trace Helper ──
let __dsa_stepIndex = 0;
function dsa_snapshot(line, event, vars, ds) {
  if (__dsa_stepIndex > 200) return;
  console.log("__DSA__" + JSON.stringify({
    stepIndex: __dsa_stepIndex++,
    line: line,
    event: event,
    variables: vars,
    dataStructureState: ds
  }));
}

// ── User Code ──
`;

  const suffix = `
// ── Test Execution ──
const result = ${funcName}(${argsJson});
console.log(JSON.stringify(result));
`;

  return {
    ok: true,
    code: preamble + userCode + suffix,
    preamble,
    suffix,
    funcName
  };
}
