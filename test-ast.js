const Parser = require('tree-sitter')
const JavaScript = require('tree-sitter-javascript')

const parser = new Parser()
parser.setLanguage(JavaScript)

const code = `
const PredictorDashboard = ({ user }) => { 
  const [inputs, setInputs] = useState({});
  const fetchPredictions = async (e) => {
    e.preventDefault();
  };
  return <div>Hello</div>;
}
`

const tree = parser.parse(code)
function printNode(node, depth = 0) {
  console.log(' '.repeat(depth * 2) + node.type)
  for (let i = 0; i < node.childCount; i++) {
    printNode(node.child(i), depth + 1)
  }
}
printNode(tree.rootNode)
