// ============================================================
// DETERMINISTIC C++ INSTRUMENTOR
// Automatically injects dsa_snapshot() calls into a Solution
// class body WITHOUT requiring any AI model. This provides
// instant, free, 100% reliable instrumentation.
//
// Strategy:
//   1. Parse the Solution class to find method bodies
//   2. Track variable declarations
//   3. Inject dsa_snapshot() at key points:
//      - Function entry (log parameters)
//      - Loop iterations (for, while, do-while)
//      - Conditionals (if/else branches taken)
//      - Return statements (log result)
//      - After significant assignments
// ============================================================

/**
 * Given the raw user code (class Solution { ... }),
 * returns a new version with dsa_snapshot() calls injected.
 * No AI needed.
 */
export function instrumentJavaSolution(userCode) {
  // Extract the class Solution body
  const classMatch = userCode.match(/class\s+Solution\s*\{/)
  if (!classMatch) return null

  const classStart = classMatch.index
  const braceStart = userCode.indexOf('{', classStart)
  if (braceStart < 0) return null

  // Find matching closing brace
  let depth = 0, classEnd = -1
  for (let i = braceStart; i < userCode.length; i++) {
    if (userCode[i] === '{') depth++
    else if (userCode[i] === '}') {
      depth--
      if (depth === 0) { classEnd = i; break }
    }
  }
  if (classEnd < 0) return null

  const classBody = userCode.slice(braceStart + 1, classEnd)

  // Find methods in the class body
  const methods = findMethods(classBody)
  if (methods.length === 0) return null

  // Instrument each method
  let instrumentedBody = classBody
  // Process methods in reverse order so indices stay valid
  const sortedMethods = [...methods].sort((a, b) => b.bodyStart - a.bodyStart)

  for (const method of sortedMethods) {
    const methodBody = instrumentedBody.slice(method.bodyStart, method.bodyEnd)
    const instrumentedMethod = instrumentMethodBody(methodBody, method)
    instrumentedBody =
      instrumentedBody.slice(0, method.bodyStart) +
      instrumentedMethod +
      instrumentedBody.slice(method.bodyEnd)
  }

  return userCode.slice(0, braceStart + 1) + instrumentedBody + userCode.slice(classEnd)
}

/**
 * Find all methods in the class body and extract their signatures + body ranges
 */
function findMethods(classBody) {
  const methods = []
  // Match method signatures: ReturnType methodName(params) { ... }
  const methodRe = /([A-Za-z_][\w:<>,\s*&]*?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:const\s*)?\{/g
  let match

  while ((match = methodRe.exec(classBody)) !== null) {
    const name = match[2].trim()
    if (name === 'Solution') continue // skip constructor

    const retType = match[1].trim()
    const paramsRaw = match[3].trim()
    const params = parseParams(paramsRaw)

    // Find the matching closing brace for this method
    const openBrace = match.index + match[0].length - 1
    let d = 0, closeBrace = -1
    for (let i = openBrace; i < classBody.length; i++) {
      if (classBody[i] === '{') d++
      else if (classBody[i] === '}') {
        d--
        if (d === 0) { closeBrace = i; break }
      }
    }
    if (closeBrace < 0) continue

    methods.push({
      name,
      retType,
      params,
      bodyStart: openBrace + 1,  // after the opening {
      bodyEnd: closeBrace         // before the closing }
    })
  }

  return methods
}

/**
 * Parse a C++ parameter list into [{type, name}]
 */
function parseParams(raw) {
  if (!raw.trim()) return []
  const params = []
  let depth = 0, start = 0
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '<' || raw[i] === '(') depth++
    else if (raw[i] === '>' || raw[i] === ')') depth--
    else if (raw[i] === ',' && depth === 0) {
      params.push(parseOneParam(raw.slice(start, i).trim()))
      start = i + 1
    }
  }
  params.push(parseOneParam(raw.slice(start).trim()))
  return params.filter(p => p !== null)
}

function parseOneParam(s) {
  s = s.trim()
  if (!s) return null
  // Remove const, &
  const cleaned = s.replace(/\bconst\b/g, '').replace(/&/g, '').trim()
  // Split on last whitespace to get type + name
  const lastSpace = cleaned.lastIndexOf(' ')
  if (lastSpace < 0) return null
  const type = s.slice(0, s.lastIndexOf(cleaned.slice(lastSpace + 1))).replace(/&\s*$/, '').trim()
  const name = cleaned.slice(lastSpace + 1).trim()
  return { type, name }
}

/**
 * Given a method body (between { and }), inject dsa_snapshot calls
 */
function instrumentMethodBody(body, method) {
  const lines = body.split('\n')
  const result = []

  // Add entry snapshot
  const paramVarsJson = buildVarsJson(method.params.map(p => p.name))
  const paramDsJson = buildDsJson(method.params)

  result.push('')
  result.push(`    dsa_snapshot(1, "function_entry", ${paramVarsJson}, ${paramDsJson});`)

  // Track scopes: array of arrays of {type, name}
  // Scope 0 is method scope (params)
  const scopes = [[...method.params]]
  let currentDepth = 0

  const getKnownVars = () => scopes.flat()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const lineNum = i + 1

    // Adjust brace depth BEFORE processing the line
    for (const ch of trimmed) {
      if (ch === '{') {
        currentDepth++
        if (scopes.length <= currentDepth) {
          scopes.push([])
        }
      } else if (ch === '}') {
        // Pop variables from the exiting scope
        if (currentDepth > 0) {
          scopes[currentDepth] = []
          currentDepth--
        }
      }
    }

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      result.push(line)
      continue
    }

    // Detect variable declarations and add to current scope
    const declMatch = detectVarDeclaration(trimmed)
    if (declMatch) {
      scopes[currentDepth].push(declMatch)
    }

    // Build current variable snapshots from all active scopes
    const activeVars = getKnownVars()
    const allVarNames = activeVars.map(v => v.name)
    const currentVarsJson = buildVarsJson(allVarNames)
    const currentDsJson = buildDsJson(activeVars)

    // ── FOR loop ──
    if (/^\s*for\s*\(/.test(trimmed)) {
      result.push(line)
      // Wait for brace to inject snapshot if it's on this line
      if (trimmed.includes('{')) {
        result.push(`      dsa_snapshot(${lineNum}, "loop_iteration", ${currentVarsJson}, ${currentDsJson});`)
      } else {
        result.push(`      dsa_snapshot(${lineNum}, "loop_iteration", ${currentVarsJson}, ${currentDsJson});`)
      }
      continue
    }

    // ── WHILE loop ──
    if (/^\s*while\s*\(/.test(trimmed)) {
      result.push(line)
      result.push(`      dsa_snapshot(${lineNum}, "while_iteration", ${currentVarsJson}, ${currentDsJson});`)
      continue
    }

    // ── IF statement ──
    if (/^\s*if\s*\(/.test(trimmed) || /^\s*\}\s*else\s+if\s*\(/.test(trimmed)) {
      result.push(line)
      result.push(`      dsa_snapshot(${lineNum}, "condition_check", ${currentVarsJson}, ${currentDsJson});`)
      continue
    }

    // ── ELSE ──
    if (/^\s*\}\s*else\s*\{/.test(trimmed) || trimmed === 'else{' || trimmed === 'else {' || trimmed === '}else{') {
      result.push(line)
      result.push(`      dsa_snapshot(${lineNum}, "else_branch", ${currentVarsJson}, ${currentDsJson});`)
      continue
    }

    // ── RETURN statement ──
    if (/^\s*return\b/.test(trimmed)) {
      result.push(`      dsa_snapshot(${lineNum}, "return", ${currentVarsJson}, ${currentDsJson});`)
      result.push(line)
      continue
    }

    // ── push/pop/insert/erase operations on data structures ──
    if (/\.(push|pop|push_back|push_front|pop_back|pop_front|insert|erase|emplace|emplace_back)\s*\(/.test(trimmed)) {
      result.push(line)
      result.push(`      dsa_snapshot(${lineNum}, "ds_modify", ${currentVarsJson}, ${currentDsJson});`)
      continue
    }

    // ── sort/swap ──
    if (/\b(sort|swap|reverse|fill)\s*\(/.test(trimmed)) {
      result.push(line)
      result.push(`      dsa_snapshot(${lineNum}, "transform", ${currentVarsJson}, ${currentDsJson});`)
      continue
    }

    // ── Variable assignment ──
    if (!declMatch && /[a-zA-Z_]\w*\s*(\[.*?\])?\s*=\s*[^=]/.test(trimmed) && !trimmed.startsWith('for')) {
      result.push(line)
      result.push(`      dsa_snapshot(${lineNum}, "assign", ${currentVarsJson}, ${currentDsJson});`)
      continue
    }

    // Default: just keep the line
    result.push(line)
  }

  return result.join('\n')
}

/**
 * Detect simple variable declarations
 * Returns {type, name} or null
 */
function detectVarDeclaration(line) {
  // Common patterns:
  // int x = ...;
  // List<Integer> v = ...;
  // Stack<Double> st;
  // double time = ...;
  // int[] arr = ...;
  const patterns = [
    // Type name = expr;  or  Type name; (primitives, wrappers, String, arrays)
    /^((?:int|long|double|float|boolean|char|byte|short|String|Integer|Long|Double|Float|Boolean|Character)(?:\s*\[\s*\])*)\s+([a-zA-Z_]\w*)\s*[=;]/,
    // Collection<...> name (with or without space before name)
    /^((?:List|ArrayList|LinkedList|Set|HashSet|TreeSet|Map|HashMap|TreeMap|Queue|PriorityQueue|Deque|ArrayDeque|Stack|Vector)\s*<.+?>)\s*([a-zA-Z_]\w*)\s*[\(=;{]/,
    // TreeNode name
    /^(TreeNode|ListNode)\s+([a-zA-Z_]\w*)\s*[=;]/,
  ]

  for (const pat of patterns) {
    const m = line.match(pat)
    if (m) {
      return { type: m[1].trim(), name: m[2].trim() }
    }
  }
  return null
}

/**
 * Build a Java expression string that produces JSON for scalar variables.
 * E.g.: "{\"n\":" + dsaToJson(n) + ",\"i\":" + dsaToJson(i) + "}"
 */
function buildVarsJson(varNames) {
  if (varNames.length === 0) return '"null"'
  const vars = varNames.slice(0, 8)
  const parts = vars.map((name, idx) => {
    const prefix = idx > 0 ? ',' : '{'
    return '"' + prefix + '\\"' + name + '\\":" + dsaToJson(' + name + ')'
  })
  return parts.join(' + ') + ' + "}"'
}

/**
 * Build a Java expression string for the dataStructureState field.
 * Only includes container-type variables.
 */
function buildDsJson(vars) {
  const dsVars = vars.filter(v => isContainerType(v.type))
  if (dsVars.length === 0) return '"null"'
  const primaryDs = dsVars[0]
  return 'dsaToJson(' + primaryDs.name + ')'
}

function isContainerType(type) {
  if (!type) return false
  const t = type.trim()
  return /^(List|ArrayList|LinkedList|Set|HashSet|TreeSet|Map|HashMap|TreeMap|Queue|PriorityQueue|Deque|ArrayDeque|Stack|Vector)\s*</.test(t)
    || t === 'TreeNode' || t === 'ListNode' || /\[\s*\]$/.test(t)
}

function countPrecedingNewlines(s) {
  let count = 0
  for (const ch of s) {
    if (ch === '\n') count++
    else if (ch.trim()) break
  }
  return count
}
