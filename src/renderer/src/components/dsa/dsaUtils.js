// ============================================================
// DSA EXPLAINER — Shared utilities:
//   • Instrumentation prompt templates (JS / Python)
//   • Explanation prompt template
//   • Structure detection (array | tree | graph | linked-list | watch)
//   • Trace-frame snapshot normalization
// ============================================================

export const JS_INSTRUMENTATION_PROMPT = (userCode, sampleInput) => `You are a code instrumenter. Rewrite the JavaScript snippet below so that it prints a JSON snapshot at every meaningful execution event (loop iteration, recursive call/return, swap, pointer/index change, comparison).

STRICT RULES:
1. Print each snapshot with console.log("__DSA__" + JSON.stringify({ stepIndex, line, event, variables, dataStructureState, callStack })). The "__DSA__" prefix is REQUIRED so the runner can parse it.
2. stepIndex starts at 0 and increments monotonically. Use a top-level counter.
3. "line" is the ORIGINAL user-code line number. The input code below is prefixed with line numbers. Use these EXACT numbers for the "line" field. Do NOT include line numbers in your generated JS output.
4. "variables" is a shallow snapshot of relevant local names → values.
5. "dataStructureState" mirrors the array / tree / graph / linked-list currently under mutation. Use plain JS values (arrays, objects). Omit if not applicable.
6. "callStack" is an array of {fn, args} for currently active recursive calls (push on entry, pop on return). If iterative, use [].
7. Do NOT emit more than 200 snapshots; short-circuit gracefully if you hit that.
8. Preserve the original algorithm's behavior — do NOT rewrite the logic, only ADD snapshot emissions.
9. At the very bottom, INVOKE the function with this sample input: ${JSON.stringify(sampleInput)}
10. Output ONLY the raw instrumented JS. No markdown fences. No prose. No <edit_file>.

Original code:
${userCode}
`

export const PY_INSTRUMENTATION_PROMPT = (userCode, sampleInput) => `You are a code instrumenter. Rewrite the Python snippet below so that it prints a JSON snapshot at every meaningful execution event (loop iteration, recursive call/return, swap, pointer/index change, comparison).

STRICT RULES:
1. import json at the top. Also add common imports used in LeetCode (e.g., collections, math, heapq, typing.*). Print each snapshot as: print("__DSA__" + json.dumps({"stepIndex": n, "line": L, "event": E, "variables": V, "dataStructureState": D, "callStack": C})). The "__DSA__" prefix is REQUIRED.
2. stepIndex starts at 0 and increments monotonically. Use a module-level counter (e.g. via a list wrapper).
3. "line" is the ORIGINAL user-code line number. The input code below is prefixed with line numbers. Use these EXACT numbers for the "line" field. Do NOT include line numbers in your generated Python output.
4. "variables" is a shallow snapshot of relevant local names → values.
5. "dataStructureState" mirrors the array / tree / graph / linked-list currently under mutation. Use plain Python values. Omit if not applicable.
6. "callStack" is a list of {"fn": ..., "args": ...} for currently active recursive calls. If iterative, use [].
7. Do NOT emit more than 200 snapshots.
8. Preserve the original algorithm's behavior — do NOT rewrite the logic, only ADD snapshot emissions.
9. At the very bottom, INVOKE the function with this sample input: ${JSON.stringify(sampleInput)}
10. Output ONLY the raw instrumented Python. No markdown fences. No prose. No <edit_file>.

Original code:
${userCode}
`

export const CPP_INSTRUMENTATION_PROMPT = (userCode, sampleInput) => `You are a code instrumenter. Rewrite the C++ snippet below so that it prints a JSON snapshot at every meaningful execution event (loop iteration, recursive call/return, swap, pointer/index change, comparison).

STRICT RULES:
1. Emit each snapshot with cout or printf as ONE line prefixed with "__DSA__" followed by a JSON object. The "__DSA__" prefix is REQUIRED. Use std::cout << "__DSA__" << json_body << "\\n"; std::cout << std::flush;
2. Do NOT depend on any external JSON library. Hand-serialize the object manually so the output is a valid JSON string: {"stepIndex":N,"line":L,"event":"...","variables":{...},"dataStructureState":...,"callStack":[...]}. Use double quotes on ALL keys and string values. Escape backslashes and inner double quotes.
3. stepIndex is a monotonic 0-based counter (static int or global).
4. "line" is the ORIGINAL user-code line number the snapshot corresponds to.
5. "variables" is a shallow snapshot of relevant local names → values.
6. "dataStructureState" mirrors the array (vector), tree, graph, or linked-list currently under mutation. Omit if not applicable.
7. "callStack" is a JSON array of {"fn":"...","args":"..."} for currently active recursive calls. If iterative, use [].
8. Do NOT emit more than 200 snapshots — stop emitting once the counter reaches 200.
9. Preserve the original algorithm's behavior — ADD snapshot emissions, do NOT rewrite the logic.
10. include <iostream>, <vector>, <string> as needed. Provide a main() that INVOKES the function with this sample input: ${JSON.stringify(sampleInput)}
11. Output ONLY the raw instrumented C++. No markdown fences. No prose. No <edit_file>.

Original code:
${userCode}
`

export const JAVA_INSTRUMENTATION_PROMPT = (userCode, sampleInput) => `You are a code instrumenter. Rewrite the Java snippet below so that it prints a JSON snapshot at every meaningful execution event (loop iteration, recursive call/return, swap, pointer/index change, comparison).

STRICT RULES:
1. Emit each snapshot with System.out.println("__DSA__" + jsonBody). The "__DSA__" prefix is REQUIRED.
2. Do NOT import any external JSON library. Hand-serialize the object manually so the output is a valid JSON string: {"stepIndex":N,"line":L,"event":"...","variables":{...},"dataStructureState":...,"callStack":[...]}. Use double quotes on ALL keys and string values. Escape backslashes and inner double quotes.
3. stepIndex is a monotonic 0-based counter (static int).
4. "line" is the ORIGINAL user-code line number the snapshot corresponds to.
5. "variables" is a shallow snapshot of relevant local names → values.
6. "dataStructureState" mirrors the array / tree / graph / linked-list currently under mutation. Omit if not applicable.
7. "callStack" is a JSON array of {"fn":"...","args":"..."} for currently active recursive calls. If iterative, use [].
8. Do NOT emit more than 200 snapshots — stop emitting once the counter reaches 200.
9. Preserve the original algorithm's behavior — ADD snapshot emissions, do NOT rewrite the logic.
10. The PUBLIC CLASS MUST be named exactly \`DsaTrace\` and the file will be saved as DsaTrace.java. Put ALL classes (helper classes like TreeNode, ListNode) INSIDE the DsaTrace class or as non-public top-level classes in the same file.
11. Provide a public static void main(String[] args) that INVOKES the function with this sample input: ${JSON.stringify(sampleInput)}
12. Output ONLY the raw instrumented Java. No markdown fences. No prose. No <edit_file>.

Original code:
${userCode}
`

// ──────────────────────────────────────────────────────────────
// Split-responsibility prompts — used when a deterministic harness
// has already been generated. The AI ONLY instruments the Solution
// class body; it does NOT rewrite main(), helpers, or #includes.
// ──────────────────────────────────────────────────────────────
// New: send ONLY the Solution class body. Renderer splices between our
// preamble/suffix, so the AI can't drop main() or corrupt helpers.
export const CPP_INSTRUMENT_SOLUTION_PROMPT = (solutionClass) => `Add __DSA__ execution-trace emissions to this C++ Solution class.

RULES:
1. Emit each snapshot using the provided helper: dsa_snapshot(line, "event_name", vars_json, ds_json);
2. Example: dsa_snapshot(24, "init", "{\\"n\\":" + std::to_string(n) + "}", "{\\"car\\":" + dsa_toJson(car) + "}");
3. Schema: vars_json and ds_json must be valid JSON string objects (or "null" if empty).
4. Do NOT manage stepIndex yourself. It is handled automatically by the helper.
5. "line" is the ORIGINAL source line number. The input code below is prefixed with line numbers (e.g. "24: "). Use these EXACT numbers for the "line" field. Do NOT include line numbers in your generated C++ output.
6. The dsa_snapshot helper already limits to 200 snapshots.
7. Preserve the algorithm's behavior. ADD emissions only, do NOT rewrite logic.
8. Output the FULL instrumented class Solution { ... } wrapper with your methods inside it. Do NOT include #includes or main().
9. CRITICAL: DO NOT rename the method. DO NOT change the method signature. DO NOT output an empty class or use placeholder comments like "// code goes here". You MUST output the exact same method you were given, just with cout statements added.
10. Use the provided dsa_toJson(var) helper to serialize ListNode*, TreeNode*, and vector variables into valid JSON strings. DO NOT write your own JSON serialization for structs/arrays.

Solution class to instrument:
${solutionClass}
`

export const JAVA_INSTRUMENT_SOLUTION_PROMPT = (solutionClass) => `Add __DSA__ execution-trace emissions to this Java Solution class.

RULES:
1. Emit each snapshot with System.out.println("__DSA__" + jsonBody). Hand-serialize the JSON.
2. Schema: {"stepIndex":N,"line":L,"event":"...","variables":{...},"dataStructureState":...,"callStack":[...]}
3. stepIndex is a monotonic 0-based counter (static int inside Solution).
4. "line" is the ORIGINAL source line number. The input code below is prefixed with line numbers (e.g. "24: "). Use these EXACT numbers for the "line" field. Do NOT include line numbers in your generated Java output.
5. Do NOT emit more than 200 snapshots.
6. Preserve the algorithm's behavior. ADD emissions only, do NOT rewrite logic.
7. Output the FULL instrumented class Solution { ... } wrapper with your methods inside it. Do NOT include imports or main().
8. CRITICAL: DO NOT rename the method. DO NOT change the method signature. DO NOT output an empty class or use placeholder comments. You MUST output the exact same method you were given, just with System.out.println statements added.
9. Use the provided dsaToJson(var) helper to serialize ListNode, TreeNode, arrays, and Lists into valid JSON strings. DO NOT write your own JSON serialization for structs/arrays.

Solution class to instrument:
${solutionClass}
`

export const CPP_INSTRUMENT_ONLY_PROMPT = (fullFile) => `Below is a complete, compilable C++ file. Instrument the Solution class methods so they emit a JSON snapshot at every meaningful execution event (loop iteration, recursive call/return, swap, pointer/index change, comparison).

STRICT RULES:
1. Emit each snapshot using the provided helper: dsa_snapshot(line, "event_name", vars_json, ds_json);
2. Example: dsa_snapshot(24, "init", "{\\"n\\":" + std::to_string(n) + "}", "{\\"car\\":" + dsa_toJson(car) + "}");
3. Schema: vars_json and ds_json must be valid JSON string objects (or "null" if empty).
4. Do NOT manage stepIndex yourself. It is handled automatically by the helper.
5. "line" is the ORIGINAL Solution-class line number the snapshot corresponds to.
6. The dsa_snapshot helper already limits to 200 snapshots.
7. Preserve the algorithm's behavior. ADD emissions, do NOT rewrite the logic.
8. DO NOT modify #include lines, the ListNode/TreeNode struct definitions, the dsa_* helper functions, or main(). Only edit the Solution class body.
9. Use the provided dsa_toJson(var) helper to serialize data structures. DO NOT write your own JSON serialization logic for structs/vectors.
10. Output ONLY the raw modified C++ file (whole file, top to bottom). No markdown fences. No prose. No <edit_file>.

File to instrument:
${fullFile}
`

export const JAVA_INSTRUMENT_ONLY_PROMPT = (fullFile) => `Below is a complete, compilable Java file (public class DsaTrace). Instrument the Solution class methods so they emit a JSON snapshot at every meaningful execution event.

STRICT RULES:
1. Emit each snapshot with System.out.println("__DSA__" + jsonBody). Hand-serialize the object — no external JSON library.
2. Snapshot schema: {"stepIndex":N,"line":L,"event":"...","variables":{...},"dataStructureState":...,"callStack":[...]}
3. stepIndex is a monotonic 0-based counter (static int inside DsaTrace or Solution).
4. "line" is the ORIGINAL Solution-class line number the snapshot corresponds to.
5. Do NOT emit more than 200 snapshots.
6. Preserve the algorithm's behavior. ADD emissions, do NOT rewrite the logic.
7. DO NOT modify the ListNode/TreeNode inner classes, the dsa* helper methods, or main(). Only edit the Solution class body.
8. Use the provided dsaToJson(var) helper to serialize arrays, lists, and node objects. DO NOT write your own JSON serialization logic for data structures.
9. The file MUST remain a single top-level public class named DsaTrace.
10. Output ONLY the raw modified Java file. No markdown fences. No prose. No <edit_file>.

File to instrument:
${fullFile}
`

export const EXPLANATION_PROMPT = (userCode, trace) => {
  // Trim trace for context — send at most 60 frames + first/last markers
  const summary = trace.length <= 60
    ? trace
    : [...trace.slice(0, 30), { note: `... ${trace.length - 60} intermediate frames elided ...` }, ...trace.slice(-30)]

  return `You will produce a per-step plain-English narration for this code, GROUNDED in the actual captured execution trace.

Original code:
\`\`\`
${userCode}
\`\`\`

Captured trace (${summary.length} items):
${JSON.stringify(summary, null, 2)}

Return ONLY a JSON array of objects (no markdown, no prose). There must be exactly ${summary.length} objects, one for each item in the trace above.
Each object must have this format:
{
  "stepIndex": <the stepIndex from the trace, or -1 if it's an elided note>,
  "text": "<one short sentence, max 25 words, describing what happened in this step>"
}
Reference variables and values that actually appeared in the trace at that step. Do not invent steps. STATE FACTS PLAINLY. Describe only what the data shows.
`
}

export const SAMPLE_INPUT_PROMPT = (userCode, language) => `Below is a ${language} function. Infer a small, simple sample input (small array, short string, or tiny tree/graph literal) that exercises the function meaningfully in ~20 steps or fewer.

Code:
${userCode}

Return ONLY a raw JSON value (array, object, number, or string) — NO markdown fences, NO prose. It will be spread as the function arguments.
Examples of valid outputs:
[[5, 2, 8, 1, 9], 8]
[[3, 1, 4, 1, 5, 9, 2, 6]]
`

export const COMPLEXITY_ANALYSIS_PROMPT = (userCode, language) => `Analyze the time and space complexity of the following ${language} code.
If the solution is a brute-force or naive approach, provide a short recommendation (1-2 sentences) for a more optimal approach. If it is already optimal, leave the recommendation empty.

Code:
${userCode}

Return ONLY a JSON object (no markdown fences, no prose) with exactly these three keys:
- "timeComplexity": A string representing the Big-O time complexity (e.g., "O(N^2)").
- "spaceComplexity": A string representing the Big-O space complexity (e.g., "O(1)").
- "recommendation": A string containing your suggestion for a better approach, or an empty string if optimal.
`

// ============================================================
// STRUCTURE DETECTION
// Inspects a trace frame's dataStructureState + user code and
// picks one of: 'array' | 'tree' | 'graph' | 'linkedList' | 'watch'
// ============================================================
export function detectStructure(userCode, trace) {
  const code = userCode || ''
  const codeLc = code.toLowerCase()

  // Look at the first non-empty dataStructureState we can find
  let sample = null
  for (const frame of trace) {
    if (frame && frame.dataStructureState !== undefined && frame.dataStructureState !== null) {
      sample = frame.dataStructureState
      break
    }
  }

  // Tree — code has node.left/right, node->left/right (C++), or children[]
  //   AND sample is an object with left/right/children
  const looksLikeTreeInCode =
    /\.left\b|\.right\b|->left\b|->right\b|\bchildren\s*[:=[(]/.test(code) ||
    /\bTreeNode\b|\bBinaryTree\b/.test(code)
  if (looksLikeTreeInCode && sample && typeof sample === 'object' && !Array.isArray(sample)) {
    if ('left' in sample || 'right' in sample || 'children' in sample) return 'tree'
  }

  // Linked list — node.next OR node->next chain (C++) OR ListNode/LinkedList idioms
  const looksLikeLinkedListInCode =
    /\.next\b|->next\b/.test(code) || /\bListNode\b|\bLinkedList\b/i.test(code)
  if (looksLikeLinkedListInCode && sample && typeof sample === 'object' && !Array.isArray(sample)) {
    if ('next' in sample) return 'linkedList'
  }

  // Graph — adjacency list ({A: [B,C], ...}), adjacency matrix (2D int array),
  //   or C++ vector<vector<int>> / Java ArrayList<ArrayList<Integer>> idioms
  const looksLikeGraphInCode =
    /\badjacency\b|\bneighbou?rs?\b|\bgraph\b|\bedges\b/i.test(codeLc) ||
    /vector\s*<\s*vector\s*<[^>]+>\s*>/.test(code) ||
    /ArrayList\s*<\s*ArrayList\s*<[^>]+>\s*>/.test(code) ||
    /List\s*<\s*List\s*<[^>]+>\s*>/.test(code)
  if (looksLikeGraphInCode && sample) {
    if (Array.isArray(sample) && Array.isArray(sample[0]) && typeof sample[0][0] === 'number') return 'graph'
    if (!Array.isArray(sample) && typeof sample === 'object') {
      const vals = Object.values(sample)
      if (vals.length && vals.every(v => Array.isArray(v))) return 'graph'
    }
  }

  // Array (default when sample is an array, graph matrix check happens earlier)
  if (Array.isArray(sample)) return 'array'

  // Fallback
  return 'watch'
}

// Extract the highlighted pointers/indices from a frame's variables
// for the array visualization: any variable named i, j, k, left, right,
// low, high, mid, l, r, start, end, lo, hi, ptr, pivot, cur, curr, index
// that is a small non-negative integer < array length.
const POINTER_NAMES = new Set([
  'i', 'j', 'k', 'l', 'r', 'left', 'right', 'low', 'high', 'lo', 'hi',
  'mid', 'start', 'end', 'ptr', 'pivot', 'cur', 'curr', 'index', 'idx',
  'slow', 'fast', 'first', 'last'
])

export function extractPointers(frame, arrayLength) {
  const vars = (frame && frame.variables) || {}
  const pointers = []
  for (const [name, value] of Object.entries(vars)) {
    if (POINTER_NAMES.has(name.toLowerCase()) &&
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 && value < arrayLength) {
      pointers.push({ name, index: value })
    }
  }
  return pointers
}

// Strip markdown fences / prose so we can JSON.parse an LLM reply
export function extractJson(raw) {
  if (!raw) return null
  let s = raw.trim()
  // Strip ```json ... ``` or ``` ... ```
  const fence = /^```(?:json|javascript|js)?\n([\s\S]*?)\n```$/i
  const m = s.match(fence)
  if (m) s = m[1].trim()
  try {
    return JSON.parse(s)
  } catch {
    // Try to slice the first {...} or [...] block
    const first = s.search(/[[{]/)
    const last = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'))
    if (first !== -1 && last > first) {
      try { return JSON.parse(s.slice(first, last + 1)) } catch { return null }
    }
    return null
  }
}

// ============================================================
// DETERMINISTIC EXPLANATION GENERATOR
// Produces meaningful per-step explanations from trace frames
// without requiring an AI call. Used as:
//   1. Instant fallback when AI explanation fails
//   2. Initial display while AI explanations load
// ============================================================
export function generateDeterministicExplanations(trace, userCode) {
  const codeLines = (userCode || '').split('\n')

  function truncStr(s, max) {
    if (!s) return ''
    return s.length > max ? s.slice(0, max - 3) + '...' : s
  }

  function varSummary(vars, key) {
    if (!(key in vars)) return ''
    var val = JSON.stringify(vars[key])
    return truncStr(val, 40)
  }

  return trace.map(function (frame, idx) {
    var event = frame.event || ''
    var vars = frame.variables || {}
    var line = frame.line
    var codeLine = (line >= 1 && line <= codeLines.length) ? codeLines[line - 1].trim() : ''

    if (event === 'function_entry') {
      var paramNames = Object.keys(vars)
      if (paramNames.length === 0) return 'Function called with no arguments.'
      var parts = paramNames.map(function (k) {
        return k + ' = ' + truncStr(JSON.stringify(vars[k]), 40)
      })
      return 'Function called with ' + parts.join(', ') + '.'
    }

    if (event === 'loop_iteration') {
      var counters = ['i', 'j', 'k', 'l', 'idx', 'index', 'n']
      for (var ci = 0; ci < counters.length; ci++) {
        if (counters[ci] in vars) {
          return 'Loop iteration with ' + counters[ci] + ' = ' + vars[counters[ci]] + '.'
        }
      }
      return 'Loop iteration at line ' + line + '.'
    }

    if (event === 'while_iteration') {
      var wCounters = ['i', 'j', 'k', 'l', 'idx', 'index']
      for (var wi = 0; wi < wCounters.length; wi++) {
        if (wCounters[wi] in vars) {
          return 'While-loop check with ' + wCounters[wi] + ' = ' + vars[wCounters[wi]] + '.'
        }
      }
      return 'While-loop condition check at line ' + line + '.'
    }

    if (event === 'condition_check') {
      return 'Condition evaluated at line ' + line + ': ' + truncStr(codeLine, 50)
    }

    if (event === 'else_branch') {
      return 'Else branch taken at line ' + line + '.'
    }

    if (event === 'ds_modify') {
      var pushMatch = codeLine.match(/(\w+)\.(push|append|add)\s*\((.+?)\)/)
      var popMatch = codeLine.match(/(\w+)\.(pop|shift|remove)\s*\(/)
      if (pushMatch) {
        var dsName = pushMatch[1]
        var dsVal = varSummary(vars, dsName)
        return 'Pushed to ' + dsName + (dsVal ? ' \u2192 now ' + dsVal : '') + '.'
      }
      if (popMatch) {
        var dsName2 = popMatch[1]
        var dsVal2 = varSummary(vars, dsName2)
        return 'Popped from ' + dsName2 + (dsVal2 ? ' \u2192 now ' + dsVal2 : '') + '.'
      }
      return 'Data structure modified at line ' + line + ': ' + truncStr(codeLine, 45)
    }

    if (event === 'assign') {
      var assignMatch = codeLine.match(/(\w+(?:\[.*?\])?)\s*(?:=|\+=|-=|\*=|\/=)\s*(.+?);\s*$/)
      if (assignMatch) {
        var target = assignMatch[1]
        var baseName = target.replace(/\[.*\]/, '')
        if (baseName in vars) {
          return target + ' updated \u2192 ' + truncStr(JSON.stringify(vars[baseName]), 40)
        }
        return 'Assignment: ' + truncStr(codeLine, 50)
      }
      return 'Variable updated at line ' + line + '.'
    }

    if (event === 'return') {
      if (codeLine.startsWith('return')) {
        var resultNames = ['result', 'ans', 'answer', 'res', 'output', 'ret', 'count', 'sum', 'max', 'min']
        for (var ri = 0; ri < resultNames.length; ri++) {
          if (resultNames[ri] in vars) {
            return 'Returning ' + resultNames[ri] + ' = ' + truncStr(JSON.stringify(vars[resultNames[ri]]), 40)
          }
        }
      }
      return 'Function returning at line ' + line + '.'
    }

    if (event === 'recursive_call') return 'Recursive call at line ' + line + '.'
    if (event === 'recursive_return') return 'Returning from recursive call at line ' + line + '.'
    if (event === 'swap') return 'Swap operation at line ' + line + ': ' + truncStr(codeLine, 45)
    if (event === 'transform') return 'Transformation at line ' + line + ': ' + truncStr(codeLine, 45)

    if (codeLine) {
      return 'Line ' + line + ': ' + truncStr(codeLine, 50)
    }
    return 'Step ' + (idx + 1) + ' at line ' + line + '.'
  })
}

// ============================================================
// DETERMINISTIC COMPLEXITY ANALYZER
// Detects common algorithmic patterns to estimate time/space
// complexity without requiring an AI call.
// ============================================================
export function analyzeDeterministicComplexity(userCode) {
  var code = (userCode || '').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  // Count loop nesting depth
  var lines = code.split('\n')
  var maxLoopDepth = 0
  var currentLoopDepth = 0
  var braceStack = []

  for (var li = 0; li < lines.length; li++) {
    var trimmed = lines[li].trim()
    var isLoop = /^\s*(for|while)\s*\(/.test(trimmed)
    if (isLoop) {
      currentLoopDepth++
      if (currentLoopDepth > maxLoopDepth) maxLoopDepth = currentLoopDepth
    }
    for (var ci = 0; ci < trimmed.length; ci++) {
      if (trimmed[ci] === '{') {
        braceStack.push(isLoop ? 'loop' : 'other')
        isLoop = false
      } else if (trimmed[ci] === '}') {
        var popped = braceStack.pop()
        if (popped === 'loop') currentLoopDepth--
      }
    }
  }

  // Pattern detection
  var hasBinarySearch = /mid\s*=|lo\s*<\s*hi|low\s*<\s*high|left\s*<\s*right|>>>\s*1|Math\.floor\s*\(\s*\(.*\+.*\)\s*\/\s*2\s*\)/.test(code)
  var hasSorting = /\.sort\s*\(|Arrays\.sort|Collections\.sort|sorted\s*\(|std::sort/.test(code)
  var hasHashMap = /new\s+Map|new\s+Set|HashMap|HashSet|dict\s*\(|set\s*\(|\{\s*\}|defaultdict|Counter\s*\(|unordered_map|unordered_set/.test(code)
  var hasRecursion = false
  var funcMatch = code.match(/(?:function|def|var|let|const)\s+(\w+)|(\w+)\s*=\s*function/)
  if (funcMatch) {
    var funcName = funcMatch[1] || funcMatch[2]
    if (funcName) {
      var bodyAfterDef = code.slice(code.indexOf(funcName) + funcName.length)
      hasRecursion = bodyAfterDef.indexOf(funcName + '(') !== -1
    }
  }
  var hasStack = /\.push\s*\(.*\)[\s\S]*\.pop\s*\(/.test(code) || /stack/.test(code.toLowerCase())
  var hasQueue = /\.shift\s*\(|\.offer\s*\(|deque|Queue/.test(code)
  var hasHeap = /heapq|PriorityQueue|MinHeap|MaxHeap|heap/.test(code)
  var hasDp = /dp\s*[\[=]|memo\s*[\[=]|tabulation|memoiz/.test(code.toLowerCase())
  var hasMatrix = /\[\s*\[/.test(code) && maxLoopDepth >= 2

  // Determine time complexity
  var timeComplexity = 'O(N)'
  var spaceComplexity = 'O(1)'
  var recommendation = ''

  if (hasBinarySearch && maxLoopDepth <= 1) {
    timeComplexity = 'O(log N)'
    spaceComplexity = hasRecursion ? 'O(log N)' : 'O(1)'
  } else if (hasSorting && maxLoopDepth <= 1) {
    timeComplexity = 'O(N log N)'
    spaceComplexity = 'O(N)'
  } else if (hasSorting && maxLoopDepth === 2) {
    timeComplexity = 'O(N log N)'
    spaceComplexity = 'O(N)'
  } else if (hasRecursion && hasBinarySearch) {
    timeComplexity = 'O(N log N)'
    spaceComplexity = 'O(log N)'
  } else if (hasRecursion && hasDp) {
    timeComplexity = 'O(N)'
    spaceComplexity = 'O(N)'
  } else if (hasRecursion && !hasDp && maxLoopDepth <= 1) {
    timeComplexity = 'O(2^N)'
    spaceComplexity = 'O(N)'
    recommendation = 'Consider using dynamic programming or memoization to avoid redundant recursive calls.'
  } else if (maxLoopDepth >= 3) {
    timeComplexity = 'O(N^' + maxLoopDepth + ')'
    spaceComplexity = hasHashMap ? 'O(N)' : 'O(1)'
    recommendation = 'Consider reducing loop nesting. Can any inner loops be replaced with hash lookups?'
  } else if (maxLoopDepth === 2) {
    if (hasMatrix) {
      timeComplexity = 'O(M \u00D7 N)'
      spaceComplexity = 'O(M \u00D7 N)'
    } else {
      timeComplexity = 'O(N\u00B2)'
      spaceComplexity = hasHashMap ? 'O(N)' : 'O(1)'
      if (!hasSorting && !hasBinarySearch) {
        recommendation = 'Consider using a hash map or sorting to reduce from O(N\u00B2) to O(N) or O(N log N).'
      }
    }
  } else if (maxLoopDepth === 1) {
    timeComplexity = 'O(N)'
    if (hasHashMap || hasStack || hasQueue) {
      spaceComplexity = 'O(N)'
    } else if (hasDp) {
      spaceComplexity = 'O(N)'
    }
  } else if (maxLoopDepth === 0 && !hasRecursion) {
    timeComplexity = 'O(1)'
    spaceComplexity = 'O(1)'
  }

  if (hasHeap && maxLoopDepth <= 1) {
    timeComplexity = 'O(N log K)'
    spaceComplexity = 'O(K)'
  }

  return {
    timeComplexity: timeComplexity,
    spaceComplexity: spaceComplexity,
    recommendation: recommendation
  }
}
