const babel = require('@babel/core');

const code = `
import {
  foo
`;

try {
  babel.parseSync(code, {
    parserOpts: { plugins: ['jsx'] }
  });
} catch (e) {
  console.log(e.message);
}

const code2 = `
const a = {
  b: 1
`;
try { babel.parseSync(code2); } catch (e) { console.log("Obj: " + e.message); }

const code3 = `
function foo(a, b
`;
try { babel.parseSync(code3); } catch (e) { console.log("Func: " + e.message); }

const code4 = `
const a = [1, 2
`;
try { babel.parseSync(code4); } catch (e) { console.log("Arr: " + e.message); }

