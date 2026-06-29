const TreeSitter = require('web-tree-sitter');
const fs = require('fs');

async function main() {
  await TreeSitter.init();
  const parser = new TreeSitter();
  const lang = await TreeSitter.Language.load('./public/wasm/tree-sitter-javascript.wasm');
  parser.setLanguage(lang);

  const code = fs.readFileSync('./src/renderer/src/components/PredictorDashboard.jsx', 'utf8');
  const tree = parser.parse(code);

  console.log("Has error?", tree.rootNode.hasError());
  
  const blockTypes = new Set(['statement_block', 'block', 'compound_statement']);
  const funcTypes = new Set([
    'function_declaration', 'method_definition', 'arrow_function',
    'function_definition', 'method_declaration', 'function_item'
  ]);

  let replaced = 0;
  function walk(node) {
    if (node.hasError()) {
      // console.log("Error at", node.type, node.text.substring(0, 20));
    }
    if (funcTypes.has(node.type)) {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (blockTypes.has(child.type)) {
          replaced++;
          return;
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(tree.rootNode);
  console.log("Replaced instances:", replaced);
  
  // Let's also print the root node children to see if JSX caused error
  console.log("Root node children:");
  for (let i = 0; i < tree.rootNode.childCount; i++) {
     console.log(tree.rootNode.child(i).type);
  }
}

main().catch(console.error);
