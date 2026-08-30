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
1. Emit each snapshot with cout: std::cout << "__DSA__" << "{...json...}" << std::endl;
2. Hand-serialize the JSON — no external library. Escape backslashes and quotes.
3. Schema: {"stepIndex":N,"line":L,"event":"...","variables":{...},"dataStructureState":...,"callStack":[...]}
4. stepIndex is a monotonic 0-based counter. DO NOT declare it. Use the globally defined \`__dsa_stepIndex\` variable.
5. "line" is the ORIGINAL source line number. The input code below is prefixed with line numbers (e.g. "24: "). Use these EXACT numbers for the "line" field. Do NOT include line numbers in your generated C++ output.
6. Do NOT emit more than 200 snapshots — short-circuit gracefully using \`if (__dsa_stepIndex > 200) return;\`.
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
1. Emit each snapshot with cout as ONE line prefixed with "__DSA__" followed by a JSON object body. Use: std::cout << "__DSA__" << "{...json...}" << std::endl;
2. Do NOT depend on any external JSON library — hand-serialize the object. Keys and string values in double quotes. Escape backslashes and inner quotes.
3. Snapshot schema: {"stepIndex":N,"line":L,"event":"...","variables":{...},"dataStructureState":...,"callStack":[...]}
4. stepIndex is a monotonic 0-based counter — declare a global variable \`int dsa_stepIndex = 0;\` at the top of the file, outside the Solution class.
5. "line" is the ORIGINAL Solution-class line number the snapshot corresponds to.
6. Do NOT emit more than 200 snapshots — short-circuit gracefully.
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

Captured trace (each entry is one execution step, in order):
${JSON.stringify(summary, null, 2)}

Return ONLY a JSON array (no markdown, no prose) with exactly one string per step in the original trace. Each string is one short sentence (max ~25 words) describing what that specific step did — what changed, why, in terms a learner can follow. Reference variables and values that actually appeared in the trace at that step. Do not invent steps that are not in the trace. STATE FACTS PLAINLY. DO NOT use hedging or contradictory language like "actually" or "but due to". Describe only what the data shows.
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

  // Array (default when sample is a flat array)
  if (Array.isArray(sample) && sample.every(v => typeof v !== 'object' || v === null)) return 'array'

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
