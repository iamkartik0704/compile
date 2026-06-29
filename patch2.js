const fs = require('fs');
let activityBar = fs.readFileSync('src/renderer/src/components/ActivityBar.jsx', 'utf8');
if (!activityBar.includes('onVisualizeClick')) {
  activityBar = activityBar.replace(
    'import { Files, Search, GitBranch, Blocks, Settings } from \'lucide-react\'',
    'import { Files, Search, GitBranch, Blocks, Settings, Database } from \'lucide-react\''
  );
  
  // We need to pass onVisualizeClick
  activityBar = activityBar.replace(
    'export function ActivityBar() {',
    'export function ActivityBar({ onVisualizeClick }) {'
  );

  const bottomPart = '<div className="activity-bar-bottom">';
  const visBtn = 
        <div 
          className="activity-item"
          title="Visualize Codebase"
          onClick={() => onVisualizeClick && onVisualizeClick()}
        >
          <Database size={24} strokeWidth={1.5} />
        </div>
;
  activityBar = activityBar.replace(bottomPart, bottomPart + visBtn);
  fs.writeFileSync('src/renderer/src/components/ActivityBar.jsx', activityBar);
}

let app = fs.readFileSync('src/renderer/src/App.jsx', 'utf8');
if (!app.includes('<ActivityBar onVisualizeClick=')) {
  app = app.replace(
    '<ActivityBar />',
    '<ActivityBar onVisualizeClick={() => setShowVisualizer(true)} />'
  );
  fs.writeFileSync('src/renderer/src/App.jsx', app);
}
console.log('Added Visualize button to ActivityBar.');
