import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import child_process from 'child_process';
import { promisify } from 'util';
import os from 'os';
import extractZip from 'extract-zip';

const execAsync = promisify(child_process.exec);
const execFileAsync = promisify(child_process.execFile);

// Pinned URLs for the pruned toolchains (Requires v1.1.17 GitHub Release)
export const TOOLCHAIN_CONFIG = {
  version: '1.0.0',
  win32: {
    url: 'https://github.com/iamkartik0704/compile/releases/download/v1.1.17/llvm-win-x64-pruned.zip',
    hashUrl: 'https://github.com/iamkartik0704/compile/releases/download/v1.1.17/llvm-win-x64-pruned.sha256',
    folderName: 'llvm-win-x64'
  },
  darwin: {
    url: 'https://github.com/iamkartik0704/compile/releases/download/v1.1.17/llvm-mac-arm64-pruned.tar.xz',
    hashUrl: 'https://github.com/iamkartik0704/compile/releases/download/v1.1.17/llvm-mac-arm64-pruned.sha256',
    folderName: 'llvm-mac-arm64'
  }
};

let activeDownload = null;
let downloadController = null;

function checkDiskSpace(destDir, requiredBytes) {
  try {
    if (fs.statfsSync) {
      const stats = fs.statfsSync(destDir);
      const freeSpace = stats.bavail * stats.bsize;
      return freeSpace > requiredBytes;
    }
  } catch (e) {
    console.warn('[Downloader] statfs failed, skipping disk space check', e);
  }
  return true;
}

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, options).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch ${url}, status: ${res.statusCode}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        req.destroy(new Error('AbortError'));
      });
    }
  });
}

function downloadFileWithProgress(url, destPath, options, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetchUrl(url, options);
      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      
      const fileStream = fs.createWriteStream(destPath);
      
      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (onProgress) onProgress(downloadedBytes, totalBytes);
      });
      
      res.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(destPath);
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => reject(err));
      });

      res.on('error', (err) => {
        fileStream.close();
        fs.unlink(destPath, () => reject(err));
      });

    } catch (err) {
      reject(err);
    }
  });
}

async function verifyFileHash(filePath, expectedHash) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => {
      const actualHash = hash.digest('hex');
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        reject(new Error(`Hash mismatch!\nExpected: ${expectedHash}\nActual:   ${actualHash}`));
      } else {
        resolve(true);
      }
    });
    stream.on('error', reject);
  });
}

export async function cancelToolchainDownload() {
  if (downloadController) {
    downloadController.abort();
    downloadController = null;
  }
  activeDownload = null;
  return { success: true };
}

export async function downloadToolchain(sender) {
  if (activeDownload) {
    return activeDownload;
  }

  const promise = (async () => {
    const platform = os.platform();
    const config = TOOLCHAIN_CONFIG[platform];
    
    if (!config) {
      throw new Error(`Platform ${platform} is not supported for runtime toolchain download.`);
    }

    const userDataDir = app.getPath('userData');
    const toolchainsRoot = path.join(userDataDir, 'toolchains', TOOLCHAIN_CONFIG.version);
    const finalDir = path.join(toolchainsRoot, config.folderName);
    
    if (fs.existsSync(finalDir)) {
       sender.send('toolchain-download-progress', { stage: 'complete', progress: 100 });
       return { success: true, path: finalDir };
    }

    fs.mkdirSync(toolchainsRoot, { recursive: true });
    
    // Disk space check (roughly 2GB required for extracted toolchain)
    if (!checkDiskSpace(toolchainsRoot, 2 * 1024 * 1024 * 1024)) {
      throw new Error('Insufficient disk space. At least 2GB is required.');
    }

    const archivePath = path.join(toolchainsRoot, path.basename(config.url));
    let attempt = 0;
    const maxAttempts = 2;
    let expectedHash = '';
    
    downloadController = new AbortController();

    try {
      // 1. Fetch Hash
      if (config.hashUrl) {
        sender.send('toolchain-download-progress', { stage: 'fetching-hash', progress: 0 });
        try {
          const hashRes = await fetchUrl(config.hashUrl, { signal: downloadController.signal });
          let hashData = '';
          for await (const chunk of hashRes) hashData += chunk;
          expectedHash = hashData.trim().split(' ')[0]; // Standard sha256sum output
        } catch (err) {
          if (err.message === 'AbortError') throw err;
          console.warn('Could not fetch hash URL. Skipping strict verification.', err);
        }
      }

      // 2. Download Archive
      while (attempt < maxAttempts) {
        attempt++;
        try {
          sender.send('toolchain-download-progress', { stage: 'downloading', progress: 0, attempt });
          await downloadFileWithProgress(config.url, archivePath, { signal: downloadController.signal }, (downloaded, total) => {
            const percentage = total ? Math.round((downloaded / total) * 100) : 0;
            sender.send('toolchain-download-progress', { stage: 'downloading', progress: percentage, downloaded, total });
          });
          
          if (expectedHash) {
            sender.send('toolchain-download-progress', { stage: 'verifying', progress: 100 });
            await verifyFileHash(archivePath, expectedHash);
          }
          break; // Success
        } catch (err) {
          if (err.message === 'AbortError') throw err;
          console.error(`Attempt ${attempt} failed:`, err);
          if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
          if (attempt >= maxAttempts) throw new Error(`Download failed after ${maxAttempts} attempts: ${err.message}`);
          // Wait 2 seconds before retry
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // 3. Extract Archive
      sender.send('toolchain-download-progress', { stage: 'extracting', progress: 0 });
      
      const tempExtractDir = path.join(toolchainsRoot, config.folderName + '_temp');
      fs.mkdirSync(tempExtractDir, { recursive: true });

      if (archivePath.endsWith('.zip')) {
        await extractZip(archivePath, { dir: tempExtractDir });
      } else if (archivePath.endsWith('.tar.xz')) {
        await execFileAsync('tar', ['-xf', archivePath, '-C', tempExtractDir]);
      } else {
        throw new Error('Unsupported archive format.');
      }

      // Move contents up if it's nested
      const extractedFolders = fs.readdirSync(tempExtractDir);
      if (extractedFolders.length === 1 && fs.statSync(path.join(tempExtractDir, extractedFolders[0])).isDirectory()) {
         const innerFolder = path.join(tempExtractDir, extractedFolders[0]);
         fs.renameSync(innerFolder, finalDir);
         fs.rmdirSync(tempExtractDir);
      } else {
         fs.renameSync(tempExtractDir, finalDir);
      }

      // 4. macOS Quarantine Clearing
      if (platform === 'darwin') {
        sender.send('toolchain-download-progress', { stage: 'setting-permissions', progress: 95 });
        try {
          await execFileAsync('xattr', ['-d', '-r', 'com.apple.quarantine', finalDir]);
          console.log('[Downloader] Successfully cleared quarantine attributes');
        } catch (err) {
          console.warn('[Downloader] Failed to clear quarantine (might not be quarantined):', err);
        }
      }

      // Cleanup
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }

      sender.send('toolchain-download-progress', { stage: 'complete', progress: 100 });
      return { success: true, path: finalDir };
    } catch (err) {
      if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
      if (err.message !== 'AbortError') {
        sender.send('toolchain-download-error', { error: err.message });
      } else {
        sender.send('toolchain-download-error', { error: 'Download canceled' });
      }
      return { success: false, error: err.message };
    } finally {
      activeDownload = null;
      downloadController = null;
    }
  })();

  activeDownload = promise;
  return promise;
}

export function setupToolchainDownloaderHandlers() {
  ipcMain.handle('start-toolchain-download', async (event) => {
    return downloadToolchain(event.sender);
  });
  
  ipcMain.handle('cancel-toolchain-download', async () => {
    return cancelToolchainDownload();
  });
}
