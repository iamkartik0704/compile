import * as TreeSitter from '@vscode/tree-sitter-wasm'
const Parser = TreeSitter.Parser || TreeSitter.default || TreeSitter

let parser = null
let currentLang = null

export async function initTreeSitter(languageName) {
  if (!parser) {
    await Parser.init({
      locateFile(scriptName, scriptDirectory) {
        if (scriptName === 'tree-sitter.wasm' || scriptName === 'web-tree-sitter.wasm') {
          return '/wasm/tree-sitter.wasm'
        }
        return `/wasm/${scriptName}`
      }
    })
    parser = new Parser()
  }
  
  // Normalize language names
  let normLang = (languageName || 'javascript').toLowerCase()
  if (normLang === 'c++') normLang = 'cpp'
  
  if (currentLang === normLang) return parser

  const langMap = {
    'javascript': 'tree-sitter-javascript.wasm',
    'tsx': 'tree-sitter-tsx.wasm',
    'jsx': 'tree-sitter-tsx.wasm',
    'typescript': 'tree-sitter-typescript.wasm',
    'python': 'tree-sitter-python.wasm',
    'cpp': 'tree-sitter-cpp.wasm',
    'c': 'tree-sitter-cpp.wasm',
    'java': 'tree-sitter-java.wasm',
    'go': 'tree-sitter-go.wasm',
    'rust': 'tree-sitter-rust.wasm',
    'csharp': 'tree-sitter-c-sharp.wasm',
    'c-sharp': 'tree-sitter-c-sharp.wasm',
    'php': 'tree-sitter-php.wasm',
    'ruby': 'tree-sitter-ruby.wasm',
    'bash': 'tree-sitter-bash.wasm',
    'shell': 'tree-sitter-bash.wasm',
    'powershell': 'tree-sitter-powershell.wasm',
    'css': 'tree-sitter-css.wasm'
  }

  const wasmFile = langMap[normLang]
  if (!wasmFile) return null

  try {
    const lang = await TreeSitter.Language.load(`/wasm/${wasmFile}`)
    parser.setLanguage(lang)
    currentLang = normLang
    return parser
  } catch (error) {
    console.error('Failed to load language', error)
    throw new Error('Language load failed: ' + error.message)
  }
}

export async function getEnclosingScope(code, cursorLine, language) {
  try {
    const p = await initTreeSitter(language)
    if (!p) return null
    
    const tree = p.parse(code)
    
    let targetNode = null
    const row = cursorLine - 1 // Tree-sitter is 0-indexed
    
    function walk(node) {
      const startRow = node.startPosition.row
      const endRow = node.endPosition.row
      
      if (row >= startRow && row <= endRow) {
         const t = node.type
         if (t.includes('function') || t.includes('method') || t.includes('class') || t === 'arrow_function') {
           targetNode = node
         }
         for (let i = 0; i < node.childCount; i++) {
           walk(node.child(i))
         }
      }
    }
    
    walk(tree.rootNode)
    
    if (targetNode) {
      return {
        text: targetNode.text,
        startLine: targetNode.startPosition.row + 1,
        endLine: targetNode.endPosition.row + 1,
        type: targetNode.type
      }
    }
    
    return null
  } catch (e) {
    console.error('AST parsing failed', e)
    return null
  }
}

export async function skeletonizeCode(code, language) {
  try {
    let p;
    try {
      p = await initTreeSitter(language)
    } catch (err) {
      return { code, error: 'initTreeSitter failed: ' + err.message + '\n' + err.stack }
    }
    
    if (!p) return { code, error: 'initTreeSitter returned null' } // Fallback to original if parsing fails
    
    let tree;
    try {
      tree = p.parse(code)
    } catch (err) {
      return { code, error: 'p.parse failed: ' + err.message }
    }
    
    const replaceRanges = []

    // Body-node types across supported languages (used as a fallback when
    // childForFieldName('body') doesn't return anything for this grammar)
    const blockTypes = new Set(['statement_block', 'block', 'compound_statement', 'function_body'])

    // Heuristic: a node represents a function/method we want to skeletonize when
    // its type contains any of these tokens AND does not contain "type" (which
    // would match TS function-type annotations like `function_type`).
    const funcTypeHints = ['function', 'method', 'lambda', 'arrow']

    function isFunctionLike(type) {
      if (!type) return false
      if (type.includes('type')) return false           // skip `function_type`
      if (type === 'class_declaration') return false    // never skeletonize a whole class body
      if (type === 'class_definition') return false
      return funcTypeHints.some((hint) => type.includes(hint))
    }

    function findBodyBlock(node) {
      // Prefer the canonical `body` field — works across grammar versions.
      try {
        const body = node.childForFieldName && node.childForFieldName('body')
        if (body && blockTypes.has(body.type)) return body
      } catch (_) { /* some grammars don't define the field — fall through */ }

      // Fallback: scan direct children for a known block type.
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && blockTypes.has(child.type)) return child
      }
      return null
    }

    let nodesWalked = 0
    const foundTypes = new Set()
    function walk(node) {
      nodesWalked++
      if (isFunctionLike(node.type)) {
        foundTypes.add(node.type)
        const body = findBodyBlock(node)
        if (body && typeof body.startIndex === 'number' && typeof body.endIndex === 'number' && body.endIndex > body.startIndex) {
          replaceRanges.push({ start: body.startIndex, end: body.endIndex })
          // Still recurse so we can skeletonize nested functions inside this one.
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i))
      }
    }

    walk(tree.rootNode)

    if (replaceRanges.length === 0) {
      return {
        code,
        error: `No skeletonizable function bodies found. Walked ${nodesWalked} nodes. Root: ${tree.rootNode.type}. Matched func types: [${[...foundTypes].join(', ') || 'none'}]. Parse error: ${tree.rootNode.hasError}`
      }
    }

    // Sort descending and drop ranges fully contained inside another range so
    // outer-body replacement wins (we don't try to skeletonize nested function
    // bodies inside an already-replaced outer body).
    replaceRanges.sort((a, b) => b.start - a.start)
    const finalRanges = []
    for (const r of replaceRanges) {
      const containedInLater = finalRanges.some((kept) => r.start >= kept.start && r.end <= kept.end)
      if (!containedInLater) finalRanges.push(r)
    }

    const placeholder = language === 'python' ? '...' : '{ /* ... */ }'
    let skeletonized = code
    for (const range of finalRanges) {
      skeletonized = skeletonized.substring(0, range.start) + placeholder + skeletonized.substring(range.end)
    }

    return { code: skeletonized, error: null }
  } catch (e) {
    console.error('Skeletonization failed', e)
    return { code, error: 'Outer catch: ' + e.message }
  }
}

