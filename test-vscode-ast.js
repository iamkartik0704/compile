const ts = require('@vscode/tree-sitter-wasm');
async function main() {
  try {
    await ts.Parser.init({
      locateFile(scriptName) {
        return './node_modules/@vscode/tree-sitter-wasm/wasm/' + scriptName;
      }
    });
    console.log("Parser initialized!");
    
    const parser = new ts.Parser();
    const lang = await ts.Parser.Language.load('./public/wasm/tree-sitter-tsx.wasm');
    parser.setLanguage(lang);
    console.log("Language loaded!");
    
    const tree = parser.parse("const x = 1;");
    console.log("Parsed!", tree.rootNode.type);
  } catch (err) {
    console.error("Error:", err);
  }
}
main();
