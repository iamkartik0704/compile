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
    'rust': 'tree-sitter-rust.wasm'
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

    // Types of nodes that typically represent the body of a function/method
    const blockTypes = new Set(['statement_block', 'block', 'compound_statement'])
    
    // Types of nodes that represent a function or method
    const funcTypes = new Set([
      'function_declaration', 'method_definition', 'arrow_function',
      'function_definition', 'method_declaration', 'function_item'
    ])

    let nodesWalked = 0;
    function walk(node) {
      nodesWalked++;
      if (funcTypes.has(node.type)) {
        // Find the block child
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (blockTypes.has(child.type)) {
            replaceRanges.push({
              start: child.startIndex !== undefined ? child.startIndex : (child.startPosition ? child.startPosition.column : 0), // fallback
              end: child.endIndex !== undefined ? child.endIndex : (child.endPosition ? child.endPosition.column : 0),
              startNode: child.startIndex, // debug
              type: child.type,
              replacement: '{ /* ... */ }'
            })
            return 
          }
        }
      }
      
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i))
      }
    }

    walk(tree.rootNode)

    if (replaceRanges.length === 0) {
       return { code, error: `No functions replaced. Walked ${nodesWalked} nodes. Root type: ${tree.rootNode.type}. Has error: ${tree.rootNode.hasError()}` }
    }
    
    if (replaceRanges[0].startNode === undefined) {
       return { code, error: `startIndex is undefined! Node keys: ${Object.keys(tree.rootNode).join(', ')}` }
    }

    // Sort ranges descending by startIndex to replace from back to front safely
    replaceRanges.sort((a, b) => b.start - a.start)

    let skeletonized = code
    for (const range of replaceRanges) {
      // Small adjustment for Python since it uses indentation, but {} works as a visual placeholder for now
      let replacement = range.replacement
      if (language === 'python') replacement = '...\n'
      skeletonized = skeletonized.substring(0, range.start) + replacement + skeletonized.substring(range.end)
    }

    return { code: skeletonized, error: null }
  } catch (e) {
    console.error('Skeletonization failed', e)
    return { code, error: 'Outer catch: ' + e.message }
  }
}

