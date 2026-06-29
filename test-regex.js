const code = `const scraper = require('./scraper'); import x from 'db';`;
const importMatches = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g), ...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)];
importMatches.forEach(m => console.log(m[1]));
