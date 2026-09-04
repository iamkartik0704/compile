// ============================================================
// JAVA HARNESS GENERATOR
// Same shape as cppHarness.js. Wraps the user's Solution class
// inside a top-level public class `DsaTrace` (required — filename
// is DsaTrace.java in the main process) and generates:
//
//   • Static inner ListNode / TreeNode when signature references them.
//   • Static build/serialize helpers for those.
//   • main() that constructs each argument from the JSON sample input
//     and invokes the Solution method.
// ============================================================

const UNSUPPORTED = "Couldn't auto-generate a test harness for this signature."

const PRIMITIVES = new Set(['int', 'long', 'double', 'float', 'boolean', 'char', 'String'])

export function normalizeType(t) {
  if (!t) return ''
  let s = t.replace(/\bfinal\b/g, '').trim()
  s = s.replace(/\s+/g, ' ').trim()
  // `int []` → `int[]`
  s = s.replace(/\s*\[\s*\]/g, '[]')
  s = s.replace(/\s*<\s*/g, '<').replace(/\s*>\s*/g, '>')
  s = s.replace(/,\s*/g, ',')
  // Integer / Long / Double as boxed forms — keep raw so we can dispatch.
  return s
}

function innerListOf(t) {
  const n = normalizeType(t)
  const m = n.match(/^List<(.+)>$/)
  return m ? m[1] : null
}

// ── Parse `class Solution { ... }` and pull signature ──
export function parseJavaSolutionSignature(userCode, expectedArgs = -1) {
  // Strip comments before looking for class bounds so we don't accidentally
  // lock onto a commented-out `class Solution` block.
  const code = userCode.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  const idx = code.search(/class\s+Solution\b/)
  if (idx < 0) return null
  const openBrace = code.indexOf('{', idx)
  if (openBrace < 0) return null
  let depth = 0, close = -1
  for (let i = openBrace; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') { depth--; if (depth === 0) { close = i; break } }
  }
  if (close < 0) return null
  let body = code.slice(openBrace + 1, close)

  // Reject explicit constructor and static state carriers for now.

  // Reject explicit constructor and static state carriers for now.
  if (/(^|[^\w])Solution\s*\(/.test(body)) {
    return { stateful: true, reason: 'design/OOP class with a constructor is not supported yet.' }
  }

  // Find first public non-constructor method.
  const methodRe = /public\s+(?:static\s+)?([A-Za-z_][\w\[\]<>,\s]*?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws\s+[\w,\s]+)?\s*\{/g
  let m
  const methods = []
  while ((m = methodRe.exec(body)) !== null) {
    const retType = normalizeType(m[1])
    const name = m[2].trim()
    if (name === 'Solution') continue
    const params = parseParamList(m[3])
    if (!params) continue
    methods.push({ retType, name, params })
  }

  if (methods.length === 0) return null

  let candidates = methods
  if (expectedArgs >= 0) {
    const matching = methods.filter(m => m.params.length === expectedArgs)
    if (matching.length > 0) candidates = matching
  }

  // If expectedArgs is not provided, we guess.
  // We prefer the LAST non-void method, because users typically add helper methods ABOVE the main method.
  let best = null
  for (let i = candidates.length - 1; i >= 0; i--) {
    const method = candidates[i]
    if (method.retType !== 'void') { best = method; break }
    if (!best) best = method
  }
  
  return best
}

function parseParamList(raw) {
  const trimmed = raw.trim()
  if (!trimmed) return []
  const parts = []
  let depth = 0, start = 0
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]
    if (c === '<') depth++
    else if (c === '>') depth--
    else if (c === ',' && depth === 0) { parts.push(trimmed.slice(start, i).trim()); start = i + 1 }
  }
  parts.push(trimmed.slice(start).trim())

  const out = []
  for (const p of parts) {
    if (!p) continue
    const m = p.match(/^(.+?)\s+([A-Za-z_]\w*)\s*$/)
    if (!m) return null
    out.push({ type: normalizeType(m[1]), name: m[2] })
  }
  return out
}

// ── JSON → Java literal ──
function buildArg(type, json) {
  const t = normalizeType(type)
  if (PRIMITIVES.has(t)) return buildPrimitive(t, json)
  if (t === 'Integer' || t === 'Long' || t === 'Double' || t === 'Boolean' || t === 'Character') {
    return buildBoxed(t, json)
  }
  if (t.endsWith('[][]')) return buildArray2(t.slice(0, -4), json)
  if (t.endsWith('[]')) return buildArray1(t.slice(0, -2), json)
  const inner = innerListOf(t)
  if (inner !== null) {
    const inner2 = innerListOf(inner)
    if (inner2 !== null) return buildList2(inner2, json)
    return buildList1(inner, json)
  }
  if (t === 'ListNode') return buildListNode(json)
  if (t === 'TreeNode') return buildTreeNode(json)
  return { ok: false, error: `Type "${t}" not in supported set.` }
}

function buildPrimitive(t, v) {
  if (t === 'String') {
    if (typeof v !== 'string') return { ok: false, error: 'expected string' }
    return { ok: true, expr: JSON.stringify(v) }
  }
  if (t === 'char') {
    if (typeof v !== 'string' || v.length === 0) return { ok: false, error: 'expected 1-char string' }
    const c = v[0]
    return { ok: true, expr: `'${c.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` }
  }
  if (t === 'boolean') {
    if (typeof v !== 'boolean') return { ok: false, error: 'expected bool' }
    return { ok: true, expr: v ? 'true' : 'false' }
  }
  if (t === 'double' || t === 'float') {
    if (typeof v !== 'number') return { ok: false, error: 'expected number' }
    const s = Number.isInteger(v) ? `${v}.0` : String(v)
    return { ok: true, expr: t === 'float' ? `${s}f` : s }
  }
  if (t === 'long') {
    if (typeof v !== 'number') return { ok: false, error: 'expected number' }
    return { ok: true, expr: `${Math.trunc(v)}L` }
  }
  if (typeof v !== 'number') return { ok: false, error: 'expected int' }
  return { ok: true, expr: `${Math.trunc(v)}` }
}

function buildBoxed(t, v) {
  if (v === null) return { ok: true, expr: 'null' }
  const primType = { Integer: 'int', Long: 'long', Double: 'double', Boolean: 'boolean', Character: 'char' }[t]
  const r = buildPrimitive(primType, v)
  if (!r.ok) return r
  return { ok: true, expr: `${t}.valueOf(${r.expr})` }
}

function buildArray1(elemType, v) {
  if (!Array.isArray(v)) return { ok: false, error: 'expected JSON array' }
  const parts = []
  for (const el of v) {
    const r = buildArg(elemType, el)
    if (!r.ok) return r
    parts.push(r.expr)
  }
  return { ok: true, expr: `new ${elemType}[]{${parts.join(', ')}}` }
}

function buildArray2(elemType, v) {
  if (!Array.isArray(v)) return { ok: false, error: 'expected JSON array' }
  const rows = []
  for (const row of v) {
    const r = buildArray1(elemType, row)
    if (!r.ok) return r
    rows.push(r.expr.replace(new RegExp(`^new ${elemType}\\[\\]`), ''))
  }
  return { ok: true, expr: `new ${elemType}[][]{${rows.join(', ')}}` }
}

function buildList1(inner, v) {
  if (!Array.isArray(v)) return { ok: false, error: 'expected JSON array' }
  const parts = []
  for (const el of v) {
    const r = buildArg(inner, el)
    if (!r.ok) return r
    parts.push(r.expr)
  }
  return {
    ok: true,
    expr: parts.length
      ? `new java.util.ArrayList<${javaTypeName(inner)}>(java.util.Arrays.asList(${parts.join(', ')}))`
      : `new java.util.ArrayList<${javaTypeName(inner)}>()`
  }
}

function buildList2(inner, v) {
  if (!Array.isArray(v)) return { ok: false, error: 'expected JSON array' }
  const rows = []
  for (const row of v) {
    const r = buildList1(inner, row)
    if (!r.ok) return r
    rows.push(r.expr)
  }
  return {
    ok: true,
    expr: rows.length
      ? `new java.util.ArrayList<java.util.List<${javaTypeName(inner)}>>(java.util.Arrays.asList(${rows.join(', ')}))`
      : `new java.util.ArrayList<java.util.List<${javaTypeName(inner)}>>()`
  }
}

function buildListNode(v) {
  if (!Array.isArray(v)) return { ok: false, error: 'ListNode input must be JSON array of ints' }
  if (v.some(x => typeof x !== 'number')) return { ok: false, error: 'ListNode array must contain ints' }
  return { ok: true, expr: `dsaBuildList(new int[]{${v.map(x => Math.trunc(x)).join(', ')}})`, needsListNode: true }
}

function buildTreeNode(v) {
  if (v === null) return { ok: true, expr: '(TreeNode) null', needsTreeNode: true }
  if (!Array.isArray(v)) return { ok: false, error: 'TreeNode input must be LeetCode array with nulls' }
  const parts = v.map(x => x === null ? 'null' : (typeof x === 'number' ? `Integer.valueOf(${Math.trunc(x)})` : null))
  if (parts.some(p => p === null)) return { ok: false, error: 'TreeNode array must contain ints or null' }
  return { ok: true, expr: `dsaBuildTree(new Integer[]{${parts.join(', ')}})`, needsTreeNode: true }
}

function javaTypeName(t) {
  const n = normalizeType(t)
  if (n === 'int') return 'Integer'
  if (n === 'long') return 'Long'
  if (n === 'double') return 'Double'
  if (n === 'boolean') return 'Boolean'
  if (n === 'char') return 'Character'
  if (n === 'String') return 'String'
  const inner = innerListOf(n)
  if (inner !== null) return `java.util.List<${javaTypeName(inner)}>`
  return n
}

function printResult(retType, expr) {
  const t = normalizeType(retType)
  if (t === 'void') return null
  if (t === 'String') return `System.out.println("\\"" + ${expr} + "\\"");`
  if (t === 'char') return `System.out.println("\\"" + ${expr} + "\\"");`
  if (PRIMITIVES.has(t)) return `System.out.println(${expr});`
  if (t === 'ListNode') return `dsaPrintList(${expr}); System.out.println();`
  if (t === 'TreeNode') return `dsaPrintTree(${expr}); System.out.println();`
  if (t.endsWith('[][]')) return `dsaPrintArr2(${expr}); System.out.println();`
  if (t.endsWith('[]')) return `dsaPrintArr(${expr}); System.out.println();`
  const inner = innerListOf(t)
  if (inner !== null) return `System.out.println(${expr}.toString());`
  return `System.out.println(String.valueOf(${expr}));`
}

// ── Injected helpers ──
const LISTNODE_SRC = `
  static class ListNode {
    int val;
    ListNode next;
    ListNode() {}
    ListNode(int val) { this.val = val; }
    ListNode(int val, ListNode next) { this.val = val; this.next = next; }
  }
  static ListNode dsaBuildList(int[] v) {
    if (v == null || v.length == 0) return null;
    ListNode head = new ListNode(v[0]);
    ListNode cur = head;
    for (int i = 1; i < v.length; i++) { cur.next = new ListNode(v[i]); cur = cur.next; }
    return head;
  }
  static void dsaPrintList(ListNode h) {
    System.out.print("[");
    boolean first = true;
    while (h != null) { if (!first) System.out.print(","); System.out.print(h.val); first = false; h = h.next; }
    System.out.print("]");
  }
  static String dsaToJson(ListNode h) {
    if (h == null) return "null";
    return "{\\"val\\":" + h.val + ",\\"next\\":" + dsaToJson(h.next) + "}";
  }`.trim()

const TREENODE_SRC = `
  static class TreeNode {
    int val;
    TreeNode left, right;
    TreeNode() {}
    TreeNode(int val) { this.val = val; }
    TreeNode(int val, TreeNode left, TreeNode right) { this.val = val; this.left = left; this.right = right; }
  }
  static TreeNode dsaBuildTree(Integer[] a) {
    if (a.length == 0 || a[0] == null) return null;
    TreeNode root = new TreeNode(a[0]);
    java.util.ArrayDeque<TreeNode> q = new java.util.ArrayDeque<>();
    q.offer(root);
    int i = 1;
    while (!q.isEmpty() && i < a.length) {
      TreeNode cur = q.poll();
      if (i < a.length && a[i] != null) { cur.left = new TreeNode(a[i]); q.offer(cur.left); } i++;
      if (i < a.length && a[i] != null) { cur.right = new TreeNode(a[i]); q.offer(cur.right); } i++;
    }
    return root;
  }
  static void dsaPrintTree(TreeNode root) {
    System.out.print("[");
    if (root == null) { System.out.print("]"); return; }
    java.util.ArrayDeque<TreeNode> q = new java.util.ArrayDeque<>();
    q.offer(root);
    java.util.ArrayList<String> parts = new java.util.ArrayList<>();
    parts.add(String.valueOf(root.val));
    while (!q.isEmpty()) {
      TreeNode cur = q.poll();
      if (cur.left != null)  { parts.add(String.valueOf(cur.left.val));  q.offer(cur.left); }  else parts.add("null");
      if (cur.right != null) { parts.add(String.valueOf(cur.right.val)); q.offer(cur.right); } else parts.add("null");
    }
    while (!parts.isEmpty() && parts.get(parts.size()-1).equals("null")) parts.remove(parts.size()-1);
    for (int i = 0; i < parts.size(); i++) { if (i > 0) System.out.print(","); System.out.print(parts.get(i)); }
    System.out.print("]");
  }
  static String dsaToJson(TreeNode t) {
    if (t == null) return "null";
    return "{\\"val\\":" + t.val + ",\\"left\\":" + dsaToJson(t.left) + ",\\"right\\":" + dsaToJson(t.right) + "}";
  }`.trim()

const ARRAY_PRINT_SRC = `
  static void dsaPrintArr(int[] a)     { System.out.print(java.util.Arrays.toString(a)); }
  static void dsaPrintArr(long[] a)    { System.out.print(java.util.Arrays.toString(a)); }
  static void dsaPrintArr(double[] a)  { System.out.print(java.util.Arrays.toString(a)); }
  static void dsaPrintArr(boolean[] a) { System.out.print(java.util.Arrays.toString(a)); }
  static void dsaPrintArr(char[] a)    { System.out.print(java.util.Arrays.toString(a)); }
  static void dsaPrintArr(String[] a)  { System.out.print(java.util.Arrays.deepToString(a)); }
  static void dsaPrintArr2(int[][] a)     { System.out.print(java.util.Arrays.deepToString(a)); }
  static void dsaPrintArr2(long[][] a)    { System.out.print(java.util.Arrays.deepToString(a)); }
  static void dsaPrintArr2(double[][] a)  { System.out.print(java.util.Arrays.deepToString(a)); }
  static void dsaPrintArr2(boolean[][] a) { System.out.print(java.util.Arrays.deepToString(a)); }
  static void dsaPrintArr2(char[][] a)    { System.out.print(java.util.Arrays.deepToString(a)); }
  static void dsaPrintArr2(String[][] a)  { System.out.print(java.util.Arrays.deepToString(a)); }
  
  static String dsaToJson(Object o) {
    if (o == null) return "null";
    if (o instanceof String) return "\\"" + o.toString().replace("\\"", "\\\\\\"") + "\\"";
    if (o.getClass().isArray()) {
      StringBuilder sb = new StringBuilder("[");
      int len = java.lang.reflect.Array.getLength(o);
      for (int i = 0; i < len; i++) {
        if (i > 0) sb.append(",");
        sb.append(dsaToJson(java.lang.reflect.Array.get(o, i)));
      }
      return sb.append("]").toString();
    }
    if (o instanceof java.util.Collection) {
      StringBuilder sb = new StringBuilder("[");
      boolean first = true;
      for (Object item : (java.util.Collection<?>)o) {
        if (!first) sb.append(",");
        sb.append(dsaToJson(item));
        first = false;
      }
      return sb.append("]").toString();
    }
    return String.valueOf(o);
  }
`.trim()

// ── Public API ──
export function buildJavaHarness(userCode, sampleInput) {
  const args = Array.isArray(sampleInput) ? sampleInput : [sampleInput]
  const sig = parseJavaSolutionSignature(userCode, args.length)
  if (!sig) return { ok: false, error: null }
  if (sig.stateful) {
    return { ok: false, error: `Stateful design/OOP Solution classes aren't supported yet — this class has a constructor. ${UNSUPPORTED}` }
  }

  if (args.length !== sig.params.length) {
    return { ok: false, error: `${UNSUPPORTED} Expected ${sig.params.length} arg(s), got ${args.length}.` }
  }

  let needsList = false, needsTree = false
  const argDecls = []
  const callArgs = []
  for (let i = 0; i < sig.params.length; i++) {
    const p = sig.params[i]
    const built = buildArg(p.type, args[i])
    if (!built.ok) return { ok: false, error: `${UNSUPPORTED} (param "${p.name}": ${built.error})` }
    needsList = needsList || !!built.needsListNode
    needsTree = needsTree || !!built.needsTreeNode
    argDecls.push(`${javaDeclType(p.type)} arg${i} = ${built.expr};`)
    callArgs.push(`arg${i}`)
  }
  const retN = normalizeType(sig.retType)
  if (retN === 'ListNode') needsList = true
  if (retN === 'TreeNode') needsTree = true

  const call = retN === 'void'
    ? `sol.${sig.name}(${callArgs.join(', ')});`
    : `${javaDeclType(sig.retType)} result = sol.${sig.name}(${callArgs.join(', ')});`

  let printStmt
  if (retN === 'void') {
    let idx = -1
    for (let i = 0; i < sig.params.length; i++) {
      const t = normalizeType(sig.params[i].type)
      if (t.endsWith('[]') || t.startsWith('List<') || t === 'ListNode' || t === 'TreeNode' || t === 'String') { idx = i; break }
    }
    printStmt = idx >= 0
      ? printResult(sig.params[idx].type, `arg${idx}`) || `System.out.println("(void)");`
      : `System.out.println("(void)");`
  } else {
    printStmt = printResult(sig.retType, 'result') || `System.out.println("(unprintable)");`
  }

  const injections = [
    ARRAY_PRINT_SRC,
    needsList ? LISTNODE_SRC : null,
    needsTree ? TREENODE_SRC : null
  ].filter(Boolean).join('\n\n')

  const preamble = `import java.util.*;
import java.math.*;

public class DsaTrace {
${injections}

  static int __dsa_stepIndex = 0;
  static void dsa_snapshot(int line, String event, String vars_json, String ds_json) {
    if (__dsa_stepIndex > 200) return;
    System.out.println("__DSA__{\\"stepIndex\\":" + (__dsa_stepIndex++) 
              + ",\\"line\\":" + line 
              + ",\\"event\\":\\"" + event 
              + "\\",\\"variables\\":" + vars_json 
              + ",\\"dataStructureState\\":" + ds_json 
              + "}");
  }

  // ── User code (Solution class) — instrumented with __DSA__ emissions ──
`
  const solutionSrc = indentBlock(stripPublicOnSolution(userCode), '  ')
  const suffix = `

  public static void main(String[] args) {
${argDecls.map(d => '    ' + d).join('\n')}
    Solution sol = new Solution();
    ${call}
    ${printStmt}
  }
}
`

  const fullCode = preamble + solutionSrc + suffix

  return {
    ok: true,
    code: fullCode,
    preamble,
    // Java suffix has an extra `}` at the end for DsaTrace — split
    // the "Solution goes here" span uses indentBlock+stripPublicOnSolution,
    // so callers must apply the same transform before splicing. We surface
    // it as `wrapSolution` so the caller doesn't re-derive it.
    suffix,
    wrapSolution: (src) => indentBlock(stripPublicOnSolution(src), '  '),
    sig,
    needsListNode: needsList,
    needsTreeNode: needsTree
  }
}

function javaDeclType(t) {
  const n = normalizeType(t)
  // For declarations we want the exact source-level type — but strip
  // package prefixes we injected (users will just write `List`).
  return n
}

// Prevent `public class Solution` inside our top-level DsaTrace file —
// Java forbids two public classes. Downgrade to package-private/static.
function stripPublicOnSolution(src) {
  return src
    .replace(/public\s+class\s+Solution\b/, 'static class Solution')
    .replace(/(^|[\s{])class\s+Solution\b/, '$1static class Solution')
}

function indentBlock(src, indent) {
  return src.split('\n').map(l => l.length ? indent + l : l).join('\n')
}
