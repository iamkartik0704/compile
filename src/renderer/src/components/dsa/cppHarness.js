// ============================================================
// C++ HARNESS GENERATOR
// Given a LeetCode-style `class Solution { public: ... }` snippet
// and a JSON array of args, produce a full, compilable C++ file:
//
//   1. Pull the first non-constructor public method's signature.
//   2. Dispatch each param's C++ type to a JSON→C++ literal builder.
//   3. Inject ListNode / TreeNode struct defs + build/serialize
//      helpers only when the signature references them.
//   4. Wrap the (AI-instrumented) user Solution class with:
//        #includes + injected helpers + Solution + main()
//
// Return { ok, code, error, needsListNode, needsTreeNode }.
// A caller with `ok: false` should surface the error string
// verbatim (that's what "Couldn't auto-generate a test harness
// for this signature" gets shown for).
// ============================================================

const UNSUPPORTED = "Couldn't auto-generate a test harness for this signature."

// ── Type vocabulary (must all be listed as real branch logic, per spec) ──
const PRIMITIVES = new Set([
  'int', 'long', 'long long', 'double', 'float',
  'bool', 'char', 'string'
])

// Canonicalize a C++ type: strip const/&/spaces/std::.
export function normalizeType(t) {
  if (!t) return ''
  let s = t.replace(/\bstd::/g, '').replace(/\bconst\b/g, '').trim()
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/\s*&\s*$/, '').replace(/\s*&\s*/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  // Normalize `vector < int >` → `vector<int>`
  s = s.replace(/\s*<\s*/g, '<').replace(/\s*>\s*/g, '>')
  s = s.replace(/,\s*/g, ',')
  return s.trim()
}

// Peel one layer: `vector<vector<int>>` → 'vector<int>'
function innerOf(type) {
  const t = normalizeType(type)
  const m = t.match(/^vector<(.+)>$/)
  return m ? m[1] : null
}

function pairOf(type) {
  const t = normalizeType(type)
  const m = t.match(/^pair<(.+)>$/)
  if (!m) return null
  // Split top-level comma
  const body = m[1]
  let depth = 0, cut = -1
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '<') depth++
    else if (body[i] === '>') depth--
    else if (body[i] === ',' && depth === 0) { cut = i; break }
  }
  if (cut < 0) return null
  return [body.slice(0, cut).trim(), body.slice(cut + 1).trim()]
}

// ── Parse `class Solution { public: ... }` and pull signature ──
export function parseCppSolutionSignature(userCode, expectedArgs = -1) {
  // Strip comments before looking for class bounds so we don't accidentally
  // lock onto a commented-out `class Solution` block.
  const code = userCode.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  // Reject stateful/design classes: constructors, or members with `=` at class scope.
  // We match the first `class Solution` up to the balanced `};`.
  const classIdx = code.search(/class\s+Solution\b/)
  if (classIdx < 0) return null

  // Walk braces to find the class body extent.
  const openBrace = code.indexOf('{', classIdx)
  if (openBrace < 0) return null
  let depth = 0, close = -1
  for (let i = openBrace; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') {
      depth--
      if (depth === 0) { close = i; break }
    }
  }
  if (close < 0) return null
  const body = code.slice(openBrace + 1, close)

  // Stateful markers we refuse for now.
  const hasCtor = /(^|[^\w:])Solution\s*\(/.test(body)
  if (hasCtor) {
    return { stateful: true, reason: 'design/OOP class with a constructor is not supported yet.' }
  }

  // Only look at the public: block(s).
  const publicRegions = []
  const sectionRe = /(public|private|protected)\s*:/g
  let match, lastLabel = null, lastStart = 0
  while ((match = sectionRe.exec(body)) !== null) {
    if (lastLabel) publicRegions.push({ label: lastLabel, start: lastStart, end: match.index })
    lastLabel = match[1]
    lastStart = match.index + match[0].length
  }
  publicRegions.push({ label: lastLabel || 'private', start: lastStart, end: body.length })

  let publicText = publicRegions
    .filter(r => r.label === 'public')
    .map(r => body.slice(r.start, r.end))
    .join('\n')

  // Find first method: `<Type> <name> ( <params> ) { ... }`.
  // Type is greedy up to before the identifier; allow template angles inside.
  const methodRe = /([A-Za-z_][\w:<>,\s*&]*?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:const\s*)?\{/g
  const methods = []
  while ((match = methodRe.exec(publicText)) !== null) {
    const retRaw = match[1].trim()
    const name = match[2].trim()
    if (name === 'Solution') continue
    const retType = normalizeType(retRaw)
    if (!retType) continue
    const params = parseParamList(match[3])
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
    const m = candidates[i]
    if (m.retType !== 'void') { best = m; break }
    if (!best) best = m
  }
  
  return best
}

function parseParamList(raw) {
  const trimmed = raw.trim()
  if (!trimmed) return []
  // Split by top-level commas.
  const parts = []
  let depth = 0, start = 0
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]
    if (c === '<' || c === '(') depth++
    else if (c === '>' || c === ')') depth--
    else if (c === ',' && depth === 0) {
      parts.push(trimmed.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(trimmed.slice(start).trim())

  const out = []
  for (const p of parts) {
    if (!p) continue
    // Last identifier is the name.
    const m = p.match(/^(.+?)\s*(\**\s*&?\s*)?([A-Za-z_]\w*)\s*$/)
    if (!m) return null
    // Type = everything before the name; incorporate trailing * / & from the group.
    const namePart = m[3]
    const rest = p.slice(0, p.length - namePart.length).trim()
    out.push({ type: normalizeType(rest), name: namePart })
  }
  return out
}

// ── JSON → C++ literal expression, by type ──
// Returns { ok, expr, needsListNode, needsTreeNode }.
function buildArg(type, json) {
  const t = normalizeType(type)

  if (PRIMITIVES.has(t)) return buildPrimitive(t, json)
  const inner = innerOf(t)
  if (inner !== null) return buildVector(inner, json)
  if (t === 'ListNode*') return buildListNode(json)
  if (t === 'TreeNode*') return buildTreeNode(json)
  const pr = pairOf(t)
  if (pr) return buildPair(pr[0], pr[1], json)

  return { ok: false, error: `Type "${t}" not in supported set.` }
}

function buildPrimitive(t, v) {
  if (t === 'string') {
    if (typeof v !== 'string') return { ok: false, error: 'expected string' }
    return { ok: true, expr: `std::string(${JSON.stringify(v)})` }
  }
  if (t === 'char') {
    if (typeof v !== 'string' || v.length === 0) return { ok: false, error: 'expected 1-char string' }
    return { ok: true, expr: `'${v[0].replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` }
  }
  if (t === 'bool') {
    if (typeof v !== 'boolean') return { ok: false, error: 'expected bool' }
    return { ok: true, expr: v ? 'true' : 'false' }
  }
  if (t === 'double' || t === 'float') {
    if (typeof v !== 'number') return { ok: false, error: 'expected number' }
    return { ok: true, expr: Number.isInteger(v) ? `${v}.0` : String(v) }
  }
  if (t === 'long long') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: 'expected number' }
    return { ok: true, expr: `${Math.trunc(v)}LL` }
  }
  if (t === 'long') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: 'expected number' }
    return { ok: true, expr: `${Math.trunc(v)}L` }
  }
  // int
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: 'expected int' }
  return { ok: true, expr: `${Math.trunc(v)}` }
}

function buildVector(innerType, v) {
  if (!Array.isArray(v)) return { ok: false, error: 'expected JSON array' }
  let needsList = false, needsTree = false
  const parts = []
  for (const el of v) {
    const r = buildArg(innerType, el)
    if (!r.ok) return r
    parts.push(r.expr)
    needsList = needsList || r.needsListNode
    needsTree = needsTree || r.needsTreeNode
  }
  const cxxInner = cxxTypeName(innerType)
  return {
    ok: true,
    expr: `std::vector<${cxxInner}>{${parts.join(', ')}}`,
    needsListNode: needsList,
    needsTreeNode: needsTree
  }
}

function buildPair(a, b, v) {
  if (!Array.isArray(v) || v.length !== 2) return { ok: false, error: 'expected 2-element array for pair' }
  const ra = buildArg(a, v[0]), rb = buildArg(b, v[1])
  if (!ra.ok) return ra
  if (!rb.ok) return rb
  return {
    ok: true,
    expr: `std::make_pair<${cxxTypeName(a)}, ${cxxTypeName(b)}>(${ra.expr}, ${rb.expr})`,
    needsListNode: ra.needsListNode || rb.needsListNode,
    needsTreeNode: ra.needsTreeNode || rb.needsTreeNode
  }
}

function buildListNode(v) {
  if (!Array.isArray(v)) return { ok: false, error: 'ListNode input must be JSON array of ints' }
  if (v.some(x => typeof x !== 'number')) return { ok: false, error: 'ListNode array must contain ints' }
  const parts = v.map(x => `${Math.trunc(x)}`)
  return { ok: true, expr: `dsa_buildList({${parts.join(', ')}})`, needsListNode: true }
}

function buildTreeNode(v) {
  if (v === null) return { ok: true, expr: `(TreeNode*)nullptr`, needsTreeNode: true }
  if (!Array.isArray(v)) return { ok: false, error: 'TreeNode input must be LeetCode array with nulls' }
  const parts = v.map(x => {
    if (x === null) return '{false, 0}'
    if (typeof x !== 'number') return null
    return `{true, ${Math.trunc(x)}}`
  })
  if (parts.some(p => p === null)) return { ok: false, error: 'TreeNode array must contain ints or null' }
  return { ok: true, expr: `dsa_buildTree({${parts.join(', ')}})`, needsTreeNode: true }
}

// Print the C++ type name we want to declare with. Normalized types
// come back the same shape (no std:: prefix); wrap containers with std::.
function cxxTypeName(t) {
  const n = normalizeType(t)
  if (PRIMITIVES.has(n)) return n === 'string' ? 'std::string' : n
  if (n === 'ListNode*') return 'ListNode*'
  if (n === 'TreeNode*') return 'TreeNode*'
  const inner = innerOf(n)
  if (inner !== null) return `std::vector<${cxxTypeName(inner)}>`
  const pr = pairOf(n)
  if (pr) return `std::pair<${cxxTypeName(pr[0])}, ${cxxTypeName(pr[1])}>`
  return n
}

// ── Print statement for the result, keyed by return type ──
function printResult(retType, expr) {
  const t = normalizeType(retType)
  if (t === 'void') return null // caller prints mutated args instead
  if (PRIMITIVES.has(t)) {
    if (t === 'bool') return `std::cout << (${expr} ? "true" : "false") << std::endl;`
    if (t === 'string') return `std::cout << "\\"" << ${expr} << "\\"" << std::endl;`
    if (t === 'char') return `std::cout << "\\"" << ${expr} << "\\"" << std::endl;`
    return `std::cout << ${expr} << std::endl;`
  }
  if (t === 'ListNode*') return `dsa_printList(${expr}); std::cout << std::endl;`
  if (t === 'TreeNode*') return `dsa_printTree(${expr}); std::cout << std::endl;`
  const inner = innerOf(t)
  if (inner !== null) return `dsa_printVec<${cxxTypeName(inner)}>(${expr}); std::cout << std::endl;`
  const pr = pairOf(t)
  if (pr) return `std::cout << "[" << ${expr}.first << "," << ${expr}.second << "]" << std::endl;`
  return `std::cout << "(unprintable)" << std::endl;`
}

// ── Injected helpers ──
const LISTNODE_SRC = `
struct ListNode {
  int val;
  ListNode *next;
  ListNode() : val(0), next(nullptr) {}
  ListNode(int x) : val(x), next(nullptr) {}
  ListNode(int x, ListNode *n) : val(x), next(n) {}
};
static ListNode* dsa_buildList(std::vector<int> v) {
  if (v.empty()) return nullptr;
  ListNode* head = new ListNode(v[0]);
  ListNode* cur = head;
  for (size_t i = 1; i < v.size(); ++i) { cur->next = new ListNode(v[i]); cur = cur->next; }
  return head;
}
static void dsa_printList(ListNode* h) {
  std::cout << "[";
  bool first = true;
  while (h) { if (!first) std::cout << ","; std::cout << h->val; first = false; h = h->next; }
  std::cout << "]";
}
static std::string dsa_toJson(ListNode* h) {
  if (!h) return "null";
  return "{\\"val\\":" + std::to_string(h->val) + ",\\"next\\":" + dsa_toJson(h->next) + "}";
}
`.trim()

const TREENODE_SRC = `
struct TreeNode {
  int val;
  TreeNode *left, *right;
  TreeNode() : val(0), left(nullptr), right(nullptr) {}
  TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
  TreeNode(int x, TreeNode* l, TreeNode* r) : val(x), left(l), right(r) {}
};
static TreeNode* dsa_buildTree(std::vector<std::pair<bool,int>> v) {
  if (v.empty() || !v[0].first) return nullptr;
  TreeNode* root = new TreeNode(v[0].second);
  std::queue<TreeNode*> q; q.push(root);
  size_t i = 1;
  while (!q.empty() && i < v.size()) {
    TreeNode* cur = q.front(); q.pop();
    if (i < v.size() && v[i].first) { cur->left = new TreeNode(v[i].second); q.push(cur->left); } ++i;
    if (i < v.size() && v[i].first) { cur->right = new TreeNode(v[i].second); q.push(cur->right); } ++i;
  }
  return root;
}
static void dsa_printTree(TreeNode* root) {
  std::cout << "[";
  if (!root) { std::cout << "]"; return; }
  std::queue<TreeNode*> q; q.push(root);
  std::vector<std::string> parts; parts.push_back(std::to_string(root->val));
  while (!q.empty()) {
    TreeNode* cur = q.front(); q.pop();
    if (cur->left)  { parts.push_back(std::to_string(cur->left->val));  q.push(cur->left); }  else parts.push_back("null");
    if (cur->right) { parts.push_back(std::to_string(cur->right->val)); q.push(cur->right); } else parts.push_back("null");
  }
  while (!parts.empty() && parts.back() == "null") parts.pop_back();
  for (size_t i = 0; i < parts.size(); ++i) { if (i) std::cout << ","; std::cout << parts[i]; }
  std::cout << "]";
}
static std::string dsa_toJson(TreeNode* t) {
  if (!t) return "null";
  return "{\\"val\\":" + std::to_string(t->val) + ",\\"left\\":" + dsa_toJson(t->left) + ",\\"right\\":" + dsa_toJson(t->right) + "}";
}
`.trim()

const VECTOR_PRINT_SRC = `
template <typename T>
static void dsa_printVec(const std::vector<T>& v) {
  std::cout << "[";
  for (size_t i = 0; i < v.size(); ++i) { if (i) std::cout << ","; std::cout << v[i]; }
  std::cout << "]";
}
template <>
void dsa_printVec<std::string>(const std::vector<std::string>& v) {
  std::cout << "[";
  for (size_t i = 0; i < v.size(); ++i) { if (i) std::cout << ","; std::cout << "\\"" << v[i] << "\\""; }
  std::cout << "]";
}
template <>
void dsa_printVec<bool>(const std::vector<bool>& v) {
  std::cout << "[";
  for (size_t i = 0; i < v.size(); ++i) { if (i) std::cout << ","; std::cout << (v[i] ? "true" : "false"); }
  std::cout << "]";
}
template <typename T>
static void dsa_printVec(const std::vector<std::vector<T>>& v) {
  std::cout << "[";
  for (size_t i = 0; i < v.size(); ++i) { if (i) std::cout << ","; dsa_printVec<T>(v[i]); }
  std::cout << "]";
}

template <typename T> static std::string dsa_toJson(const std::vector<T>& v);
template <typename T> static std::string dsa_toJson(const std::vector<std::vector<T>>& v);
static std::string dsa_toJson(int v) { return std::to_string(v); }
static std::string dsa_toJson(long v) { return std::to_string(v); }
static std::string dsa_toJson(long long v) { return std::to_string(v); }
static std::string dsa_toJson(double v) { return std::to_string(v); }
static std::string dsa_toJson(bool v) { return v ? "true" : "false"; }
static std::string dsa_toJson(const std::string& v) { return "\\"" + v + "\\""; }
template <typename T>
static std::string dsa_toJson(const std::vector<T>& v) {
  std::string s = "[";
  for (size_t i = 0; i < v.size(); ++i) { if (i) s += ","; s += dsa_toJson(v[i]); }
  return s + "]";
}
template <typename T>
static std::string dsa_toJson(const std::vector<std::vector<T>>& v) {
  std::string s = "[";
  for (size_t i = 0; i < v.size(); ++i) { if (i) s += ","; s += dsa_toJson(v[i]); }
  return s + "]";
}
`.trim()

// ── Public API ──
export function buildCppHarness(userCode, sampleInput) {
  const args = Array.isArray(sampleInput) ? sampleInput : [sampleInput]
  const sig = parseCppSolutionSignature(userCode, args.length)
  if (!sig) return { ok: false, error: null } // fallback path — caller may still ask AI to build main()
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
    argDecls.push(`${cxxTypeName(p.type)} arg${i} = ${built.expr};`)
    callArgs.push(`arg${i}`)
  }
  // If return type references ListNode/TreeNode, we need the defs too.
  const retN = normalizeType(sig.retType)
  if (retN === 'ListNode*') needsList = true
  if (retN === 'TreeNode*') needsTree = true

  const call = retN === 'void'
    ? `sol.${sig.name}(${callArgs.join(', ')});`
    : `auto result = sol.${sig.name}(${callArgs.join(', ')});`

  // Void → print the first non-primitive mutated arg (in-place mutation case).
  let printStmt
  if (retN === 'void') {
    let idx = -1
    for (let i = 0; i < sig.params.length; i++) {
      const t = normalizeType(sig.params[i].type)
      if (t.startsWith('vector<') || t === 'ListNode*' || t === 'TreeNode*' || t === 'string') { idx = i; break }
    }
    printStmt = idx >= 0
      ? printResult(sig.params[idx].type, `arg${idx}`) || `std::cout << "(void)" << std::endl;`
      : `std::cout << "(void)" << std::endl;`
  } else {
    printStmt = printResult(sig.retType, 'result') || `std::cout << "(unprintable)" << std::endl;`
  }

  const injections = [
    VECTOR_PRINT_SRC,
    needsList ? LISTNODE_SRC : null,
    needsTree ? TREENODE_SRC : null
  ].filter(Boolean).join('\n\n')

  const includes = [
    '#include <iostream>',
    '#include <vector>',
    '#include <string>',
    '#include <utility>',
    '#include <unordered_map>',
    '#include <unordered_set>',
    '#include <map>',
    '#include <set>',
    '#include <algorithm>',
    '#include <numeric>',
    '#include <cmath>',
    '#include <stack>',
    '#include <queue>',
    '#include <deque>',
    '#include <list>',
    '#include <bitset>'
  ].join('\n')

  // Split the file into preamble + suffix. The caller assembles the
  // final source as `preamble + <AI-instrumented Solution class> + suffix`.
  // We NEVER send main()/helpers/includes to the AI — that eliminates
  // the whole class of "AI dropped main() and now g++ errors on WinMain".
  const preamble = `${includes}
using namespace std;

${injections}

int __dsa_stepIndex = 0;

// ── User code (Solution class) — AI-instrumented with __DSA__ emissions ──
`
  const suffix = `

int main() {
${argDecls.map(d => '  ' + d).join('\n')}
  Solution sol;
  ${call}
  ${printStmt}
  return 0;
}
`

  const fullCode = preamble + userCode + suffix

  return {
    ok: true,
    // Deterministic full file (used when no AI instrumentation happens,
    // and as the reference the caller assembles against).
    code: fullCode,
    // Splice points for the caller.
    preamble,
    suffix,
    sig,
    needsListNode: needsList,
    needsTreeNode: needsTree
  }
}
