const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  const { appOutDir } = context;
  
  // Recursively find spawn-helper inside appOutDir
  function findSpawnHelper(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        const result = findSpawnHelper(fullPath);
        if (result) return result;
      } else if (file === 'spawn-helper' && fullPath.includes('node-pty')) {
        return fullPath;
      }
    }
    return null;
  }

  console.log('Searching for spawn-helper in: ' + appOutDir);
  const spawnHelperPath = findSpawnHelper(appOutDir);
  
  if (spawnHelperPath) {
    console.log(`Fixing permissions for ${spawnHelperPath}`);
    fs.chmodSync(spawnHelperPath, '755');
  } else {
    console.warn('Could not find spawn-helper to fix permissions!');
  }
};
