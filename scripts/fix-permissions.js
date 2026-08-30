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

  // Fix permissions for LLVM bundled binaries (Mac only)
  if (context.electronPlatformName === 'mac') {
    // Find the .app bundle dynamically
    const appDirName = fs.readdirSync(appOutDir).find(file => file.endsWith('.app'));
    if (appDirName) {
      const llvmBinDir = path.join(appOutDir, appDirName, 'Contents', 'Resources', 'llvm', 'bin');
      if (fs.existsSync(llvmBinDir)) {
        const binaries = ['clang', 'clang++', 'clangd'];
        for (const bin of binaries) {
          const binPath = path.join(llvmBinDir, bin);
          if (fs.existsSync(binPath)) {
            console.log(`Fixing permissions for ${binPath}`);
            fs.chmodSync(binPath, '755');
          }
        }
      } else {
        console.warn(`Could not find llvm bin dir at ${llvmBinDir}`);
      }
    } else {
      console.warn('Could not find .app bundle in appOutDir');
    }
  }
};
