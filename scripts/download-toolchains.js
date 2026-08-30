const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const child_process = require('child_process');
const extractZip = require('extract-zip'); // We will add this to package.json

const TARGETS = {
  'win32': {
    archives: [
      {
        url: 'https://github.com/mstorsjo/llvm-mingw/releases/download/20260616/llvm-mingw-20260616-ucrt-x86_64.zip',
        hash: 'b9b68a4d276e16fa25802aaba458e4638f64b3884c290aaccdc2d87083b6ca35', 
        type: 'zip',
        dest: 'llvm-win-x64'
      },
      {
        url: 'https://github.com/llvm/llvm-project/releases/download/llvmorg-22.1.8/clang+llvm-22.1.8-x86_64-pc-windows-msvc.tar.xz',
        hash: 'd96c2cc1736f4eb7fa43cb9bbdf56d93551a9ae0a9aadb9c99c3c3b2b712a234',
        type: 'tar.xz',
        dest: 'llvm-win-x64_clangd',
        extractOnly: 'clangd.exe' // Special handling to only move clangd.exe
      }
    ]
  },
  'darwin': {
    archives: [
      {
        url: 'https://github.com/llvm/llvm-project/releases/download/llvmorg-22.1.8/LLVM-22.1.8-macOS-ARM64.tar.xz',
        hash: 'f260f4f7c0d430828a81ae8a3826a1d63fc0963ec2459489308cc23b1f7eab4f',
        type: 'tar.xz',
        dest: 'llvm-mac-arm64'
      }
    ]
  }
};

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}...`);
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirects (GitHub releases redirect to AWS S3)
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download: ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => reject(err));
    });
  });
}

function verifyHash(filePath, expectedHash) {
  return new Promise((resolve, reject) => {
    // If hash is a placeholder, skip (just for dev convenience, remove in prod!)
    if (expectedHash.startsWith('INSERT_')) {
      console.warn(`[WARNING] Skipping hash verification for ${filePath} (placeholder hash).`);
      return resolve();
    }

    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => {
      const actualHash = hash.digest('hex');
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        reject(new Error(`Hash mismatch for ${filePath}!\nExpected: ${expectedHash}\nActual:   ${actualHash}`));
      } else {
        console.log(`Hash verified for ${filePath}`);
        resolve();
      }
    });
    stream.on('error', reject);
  });
}

async function extractArchive(filePath, destDir, type, extractOnly) {
  console.log(`Extracting ${filePath} to ${destDir}...`);
  fs.mkdirSync(destDir, { recursive: true });

  if (type === 'zip') {
    await extractZip(filePath, { dir: path.resolve(destDir) });
    
    // llvm-mingw usually extracts into a subfolder like 'llvm-mingw-20260616-ucrt-x86_64'
    // We should move its contents up one level so bin/ is directly under resources/llvm-win-x64/
    const extractedFolders = fs.readdirSync(destDir);
    if (extractedFolders.length === 1 && fs.statSync(path.join(destDir, extractedFolders[0])).isDirectory()) {
       const innerFolder = path.join(destDir, extractedFolders[0]);
       const innerFiles = fs.readdirSync(innerFolder);
       for (const file of innerFiles) {
         fs.renameSync(path.join(innerFolder, file), path.join(destDir, file));
       }
       fs.rmdirSync(innerFolder);
    }
  } else if (type === 'tar.xz') {
    // Use native tar
    try {
      child_process.execFileSync('tar', ['-xf', filePath, '-C', destDir], { stdio: 'inherit' });
      
      // If we only need clangd.exe for Windows
      if (extractOnly === 'clangd.exe') {
         // Search the extracted folder for bin/clangd.exe
         let clangdPath = null;
         const rootItems = fs.readdirSync(destDir);
         // Standard LLVM archive has a single root folder
         if (rootItems.length === 1) {
            clangdPath = path.join(destDir, rootItems[0], 'bin', 'clangd.exe');
         }
         
         const finalBinDest = path.resolve(__dirname, '../resources/llvm-win-x64/bin');
         fs.mkdirSync(finalBinDest, { recursive: true });
         
         if (clangdPath && fs.existsSync(clangdPath)) {
            fs.copyFileSync(clangdPath, path.join(finalBinDest, 'clangd.exe'));
            console.log('Successfully copied clangd.exe');
         } else {
            console.error('Could not find clangd.exe in extracted tarball!');
         }
      } else {
         // Standard mac extraction
         const rootItems = fs.readdirSync(destDir);
         if (rootItems.length === 1 && fs.statSync(path.join(destDir, rootItems[0])).isDirectory()) {
           const innerFolder = path.join(destDir, rootItems[0]);
           const innerFiles = fs.readdirSync(innerFolder);
           for (const file of innerFiles) {
             fs.renameSync(path.join(innerFolder, file), path.join(destDir, file));
           }
           fs.rmdirSync(innerFolder);
         }
      }
    } catch (e) {
      throw new Error(`Failed to extract tar.xz: ${e.message}`);
    }
  }
}

async function main() {
  const platform = process.platform;
  
  if (platform === 'darwin' && process.arch !== 'arm64') {
    throw new Error("comπle's bundled C++ toolchain currently supports Apple Silicon Macs only. Cannot download toolchain for Intel Mac.");
  }

  const targetInfo = TARGETS[platform];
  if (!targetInfo) {
    console.log(`No toolchain download configured for platform: ${platform}. Skipping.`);
    return;
  }

  const resourcesDir = path.resolve(__dirname, '../resources');
  if (!fs.existsSync(resourcesDir)) {
    fs.mkdirSync(resourcesDir, { recursive: true });
  }

  for (const archive of targetInfo.archives) {
    const finalDest = path.join(resourcesDir, archive.dest);
    if (fs.existsSync(finalDest) && !archive.extractOnly) {
      console.log(`${finalDest} already exists, skipping download.`);
      continue;
    }
    
    // If it's a specific extract target, check if the specific file exists
    if (archive.extractOnly === 'clangd.exe' && fs.existsSync(path.join(resourcesDir, 'llvm-win-x64', 'bin', 'clangd.exe'))) {
       console.log(`clangd.exe already exists, skipping download.`);
       continue;
    }

    const tempFilePath = path.join(resourcesDir, path.basename(archive.url));
    const tempExtractDir = path.join(resourcesDir, archive.dest + '_temp');
    
    try {
      if (!fs.existsSync(tempFilePath)) {
         await downloadFile(archive.url, tempFilePath);
      } else {
         console.log(`Found cached archive at ${tempFilePath}`);
      }
      await verifyHash(tempFilePath, archive.hash);
      
      const destDir = archive.extractOnly ? tempExtractDir : finalDest;
      await extractArchive(tempFilePath, destDir, archive.type, archive.extractOnly);
      
      // Cleanup temp extraction dir if used
      if (archive.extractOnly && fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
    } finally {
      // Do not delete archive to allow github actions cache to cache the downloaded archive file,
      // or we can cache the extracted folder. Let's delete the archive to save disk space if it's extracted?
      // Actually, github actions cache will cache the entire 'resources' dir if we tell it to.
      // We will delete the archive since caching the extracted folder is much faster than re-extracting every time!
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }
  
  console.log('Toolchain download and setup complete!');
}

main().catch(err => {
  console.error("Toolchain setup failed:", err);
  process.exit(1);
});
