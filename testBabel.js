const babel = require('@babel/core');

const code = `
const App = () => {
  return (
    <div>
      {true && (
        <span>hi</span>
    </div>
  )
}
export default App
`;

try {
  babel.parseSync(code, {
    parserOpts: { plugins: ['jsx'] }
  });
} catch (e) {
  console.log("Missing ) }:");
  console.log(e.message);
}

const code2 = `
const App = () => {
  return (
    <div>
      {true && 
        <span>hi</span>
    </div>
  )
}
export default App
`;
try {
  babel.parseSync(code2, {
    parserOpts: { plugins: ['jsx'] }
  });
} catch (e) {
  console.log("Missing }:");
  console.log(e.message);
}
