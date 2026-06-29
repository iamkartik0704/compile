const fs = require('fs');

// Patch App.jsx
let app = fs.readFileSync('src/renderer/src/App.jsx', 'utf8');

if (!app.includes('import { ErrorBoundary }')) {
  app = app.replace(
    'import { CodeEditor } from \'./components/CodeEditor\'',
    'import { ErrorBoundary } from \'./components/ErrorBoundary\'\nimport { CodeEditor } from \'./components/CodeEditor\''
  );
}

const startTarget = '<CodeEditor';
const startIdx = app.indexOf(startTarget, app.indexOf('flex: 1, minHeight: 0, overflow: \'hidden\''));
if (startIdx > -1) {
  let endIdx = app.indexOf('/>', startIdx);
  if (endIdx !== -1) {
    let part1 = app.substring(0, startIdx);
    let part2 = app.substring(startIdx, endIdx + 2);
    let part3 = app.substring(endIdx + 2);
    app = part1 + '<ErrorBoundary>\n' + part2 + '\n</ErrorBoundary>' + part3;
  }
}

app = app.replace(
  /<Sidebar\s+projectRoot=\{projectRoot\}\s+setProjectRoot=\{setProjectRoot\}\s+onOpenFile=\{handleOpenFile\}\s+width=\{sidebarWidth\}\s*\/>/g,
  '<Sidebar\n            projectRoot={projectRoot}\n            setProjectRoot={setProjectRoot}\n            onOpenFile={handleOpenFile}\n            width={sidebarWidth}\n            setShowVisualizer={setShowVisualizer}\n          />'
);
fs.writeFileSync('src/renderer/src/App.jsx', app);


// Patch Sidebar.jsx
let sidebar = fs.readFileSync('src/renderer/src/components/Sidebar.jsx', 'utf8');

sidebar = sidebar.replace(
  'from \'lucide-react\'',
  ', Database } from \'lucide-react\''
);

sidebar = sidebar.replace(
  'export function Sidebar({ projectRoot, setProjectRoot, onOpenFile, width }) {',
  'export function Sidebar({ projectRoot, setProjectRoot, onOpenFile, width, setShowVisualizer }) {'
);

const newFileBtn = '<button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleCreateNew(\'file\') }} title="New File">';
const dbBtn = '<button className="icon-btn" onClick={(e) => { e.stopPropagation(); setShowVisualizer && setShowVisualizer(true) }} title="Visualize Codebase">\n                  <Database size={16} />\n                </button>\n                ';
sidebar = sidebar.replace(newFileBtn, dbBtn + newFileBtn);

fs.writeFileSync('src/renderer/src/components/Sidebar.jsx', sidebar);
console.log('App.jsx and Sidebar.jsx patched successfully.');
