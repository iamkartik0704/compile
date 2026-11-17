// Outline of a source file for Quick Open's "@" mode.
//
// Uses the tree-sitter grammars the app already ships, so it works without a
// language server. Languages with no grammar fall back to a line-based scan.

import { initTreeSitter } from './astParser'

const MAX_SYMBOLS = 3000
const MAX_SOURCE_LENGTH = 1_500_000

// File extension -> grammar name understood by initTreeSitter.
const GRAMMAR_BY_EXT = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  py: 'python', pyw: 'python', pyi: 'python',
  c: 'c', h: 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', 'c++': 'cpp',
  java: 'java', go: 'go', rs: 'rust', cs: 'csharp', php: 'php', rb: 'ruby',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', css: 'css'
}

// Node type -> symbol kind. Names come from the node's `name` field unless handled below.
const DECLARATIONS = {
  // JavaScript / TypeScript
  function_declaration: 'function',
  generator_function_declaration: 'function',
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  method_definition: 'method',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
  // Python, Bash, PHP
  function_definition: 'function',
  class_definition: 'class',
  // C / C++
  class_specifier: 'class',
  struct_specifier: 'struct',
  enum_specifier: 'enum',
  namespace_definition: 'namespace',
  // Java / C# / PHP
  method_declaration: 'method',
  constructor_declaration: 'constructor',
  record_declaration: 'class',
  struct_declaration: 'struct',
  namespace_declaration: 'namespace',
  trait_declaration: 'interface',
  // Go
  type_spec: 'type',
  // Rust
  function_item: 'function',
  struct_item: 'struct',
  enum_item: 'enum',
  trait_item: 'interface',
  mod_item: 'namespace',
  impl_item: 'impl',
  // Ruby
  method: 'method',
  singleton_method: 'method',
  class: 'class',
  module: 'namespace'
}

// A type that is only being referenced (`struct Foo x;`) has no body.
const NEEDS_BODY = new Set(['class_specifier', 'struct_specifier', 'enum_specifier'])
const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function', 'generator_function'])
const CLASS_VALUES = new Set(['class', 'class_expression'])
const TYPE_CONTAINERS = new Set(['class', 'struct', 'interface', 'impl'])

const oneLine = (text, max = 80) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

// C-family declarators nest: function_definition -> pointer_declarator -> function_declarator -> identifier.
function declaratorName(node) {
  let current = node.childForFieldName('declarator')
  for (let hops = 0; current && hops < 8; hops++) {
    const inner = current.childForFieldName('declarator')
    if (!inner) return current
    current = inner
  }
  return current
}

function describe(node, parentKind) {
  const type = node.type

  // const foo = () => {} / const Foo = class {} / top-level constants
  if (type === 'variable_declarator') {
    const name = node.childForFieldName('name')
    const value = node.childForFieldName('value')
    if (!name || name.type !== 'identifier') return null
    if (value && FUNCTION_VALUES.has(value.type)) return { kind: 'function', nameNode: name }
    if (value && CLASS_VALUES.has(value.type)) return { kind: 'class', nameNode: name }
    const scope = node.parent && node.parent.parent
    const isTopLevel = scope && (scope.type === 'program' || scope.type === 'export_statement')
    return isTopLevel ? { kind: 'variable', nameNode: name } : null
  }

  // class Foo { handle = () => {} }
  if (type === 'field_definition' || type === 'public_field_definition') {
    const name = node.childForFieldName('name') || node.childForFieldName('property')
    const value = node.childForFieldName('value')
    if (name && value && FUNCTION_VALUES.has(value.type)) return { kind: 'method', nameNode: name }
    return null
  }

  if (type === 'rule_set') {
    const selectors = node.namedChildren.find((child) => child && child.type === 'selectors')
    return selectors ? { kind: 'rule', nameNode: selectors } : null
  }

  if (!Object.hasOwn(DECLARATIONS, type)) return null
  let kind = DECLARATIONS[type]
  if (NEEDS_BODY.has(type) && !node.childForFieldName('body')) return null

  if (type === 'impl_item') {
    const target = node.childForFieldName('type')
    const trait = node.childForFieldName('trait')
    if (!target) return null
    return { kind, nameNode: target, name: trait ? `impl ${oneLine(trait.text)} for ${oneLine(target.text)}` : `impl ${oneLine(target.text)}` }
  }

  const nameNode = node.childForFieldName('name') || declaratorName(node)
  if (!nameNode) return null
  if (kind === 'function' && TYPE_CONTAINERS.has(parentKind)) kind = 'method'
  return { kind, nameNode }
}

function collectFromTree(rootNode) {
  const symbols = []

  const visit = (node, depth, parent) => {
    if (symbols.length >= MAX_SYMBOLS) return
    let nextDepth = depth
    let nextParent = parent

    const found = describe(node, parent ? parent.kind : null)
    if (found) {
      const name = found.name || oneLine(found.nameNode.text)
      if (name) {
        const symbol = {
          name,
          kind: found.kind,
          line: found.nameNode.startPosition.row + 1,
          column: found.nameNode.startPosition.column + 1,
          depth,
          container: parent ? parent.name : ''
        }
        symbols.push(symbol)
        nextDepth = depth + 1
        nextParent = symbol
      }
    }

    for (const child of node.namedChildren) {
      if (child) visit(child, nextDepth, nextParent)
    }
  }

  visit(rootNode, 0, null)
  return symbols
}

const KEYWORD_KINDS = {
  function: 'function', def: 'function', fn: 'function', func: 'function', fun: 'function', sub: 'function',
  class: 'class', struct: 'struct', enum: 'enum', object: 'class',
  interface: 'interface', trait: 'interface', protocol: 'interface',
  module: 'namespace', namespace: 'namespace', type: 'type'
}

const GENERIC_DECLARATION =
  /^(\s*)(?:(?:export|default|public|private|protected|internal|open|static|final|abstract|async|override|pub|suspend|inline|data|sealed)\s+)*(function|def|fn|func|fun|sub|class|struct|enum|object|interface|trait|protocol|module|namespace|type)\s+([A-Za-z_$][\w$]*)/

function collectFromLines(code, ext) {
  const symbols = []
  const lines = code.split(/\r?\n/)

  if (ext === 'md' || ext === 'markdown') {
    let inFence = false
    lines.forEach((text, index) => {
      if (/^\s*(```|~~~)/.test(text)) inFence = !inFence
      if (inFence) return
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text)
      if (heading) symbols.push({ name: heading[2], kind: 'heading', line: index + 1, column: 1, depth: heading[1].length - 1, container: '' })
    })
    return symbols
  }

  if (ext === 'json' || ext === 'jsonc') {
    // Keys at the two outermost levels, judged by indentation.
    let unit = 0
    lines.forEach((text, index) => {
      const key = /^(\s*)"((?:[^"\\]|\\.)+)"\s*:/.exec(text)
      if (!key) return
      const indent = key[1].replace(/\t/g, '  ').length
      if (!unit && indent > 0) unit = indent
      const depth = unit ? Math.round(indent / unit) - 1 : 0
      if (depth < 0 || depth > 1) return
      symbols.push({ name: key[2], kind: 'key', line: index + 1, column: key[1].length + 1, depth, container: '' })
    })
    return symbols
  }

  for (let index = 0; index < lines.length && symbols.length < MAX_SYMBOLS; index++) {
    const found = GENERIC_DECLARATION.exec(lines[index])
    if (!found) continue
    symbols.push({
      name: found[3],
      kind: KEYWORD_KINDS[found[2]] || 'function',
      line: index + 1,
      column: lines[index].indexOf(found[3], found[1].length) + 1,
      depth: 0,
      container: ''
    })
  }
  return symbols
}

/**
 * @param {string} code
 * @param {string} filePath used only to pick a grammar from the extension
 * @returns {Promise<{ name: string, kind: string, line: number, column: number, depth: number, container: string }[]>}
 */
export async function getDocumentSymbols(code, filePath) {
  const fileName = (filePath || '').split(/[/\\]/).pop() || ''
  const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : ''
  const grammar = GRAMMAR_BY_EXT[ext]

  if (grammar && code.length <= MAX_SOURCE_LENGTH) {
    let tree = null
    try {
      const parser = await initTreeSitter(grammar)
      if (parser) {
        // Parse immediately: the parser is shared and its language can be switched by other callers.
        tree = parser.parse(code)
        return collectFromTree(tree.rootNode)
      }
    } catch (error) {
      console.warn('[quick-open] tree-sitter outline failed, using line scan:', error)
    } finally {
      if (tree && tree.delete) tree.delete()
    }
  }

  return collectFromLines(code, ext)
}
