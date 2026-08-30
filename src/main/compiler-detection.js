import { execSync, exec } from 'child_process'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { promisify } from 'util'

const execAsync = promisify(exec)

const CONFIG_FILE = path.join(app.getPath('userData'), 'cpp-compiler-config.json')

export function getCompilerConfig() {
  console.log('--- [COMPILER CONFIG] ---')
  console.log(`[LSP] Checking for config file at: ${CONFIG_FILE}`)
  
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
      console.log(`[LSP] Loaded existing config:`, config)
      
      // SHIPPED VERSION SAFEGUARD: 
      // Verify that the saved path still actually exists on the user's hard drive!
      // If it doesn't (e.g., they deleted it or updated the IDE), force a fresh scan.
      if (config.selectedCompiler && config.selectedCompiler.binDir) {
        if (!fs.existsSync(config.selectedCompiler.binDir)) {
          console.log(`[LSP] WARNING: Saved compiler path no longer exists on disk! Forcing fresh scan...`)
          return { manualOverride: config.manualOverride, selectedCompiler: null }
        }
      }
      
      return config
    } catch (e) {
      console.error('[LSP] Failed to read compiler config', e)
    }
  } else {
    console.log(`[LSP] No config file found. Will perform fresh scan.`)
  }
  return { manualOverride: '', selectedCompiler: null }
}

export function saveCompilerConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
    console.log(`[LSP] Successfully saved compiler config to: ${CONFIG_FILE}`)
  } catch (e) {
    console.error('[LSP] Failed to save compiler config', e)
  }
}

// OS-Specific Detection Logic
export async function detectCppCompilers() {
  console.log('\n--- [COMPILER DETECTION SCAN] ---')
  const compilers = new Set()
  try {
    const platform = os.platform()
    let lines = []
    
    if (platform === 'win32') {
      // SHIPPED VERSION LOGIC: 
      // In production (.exe), bundled files live in process.resourcesPath. 
      // In dev, they live in process.cwd()
      const baseDir = app.isPackaged ? process.resourcesPath : process.cwd();
      
      const possibleBundledDirs = [
        path.join(baseDir, 'toolchains', 'mingw64', 'bin'),
        path.join(baseDir, 'toolchains', 'llvm-mingw', 'bin'),
        'C:\\winlibs64\\mingw64\\bin', // Fallback for your local development
        'C:\\MinGW\\bin',
        'C:\\msys64\\mingw64\\bin',
        'C:\\msys64\\ucrt64\\bin'
      ];
      
      console.log('[LSP] Scanning Windows bundled/hardcoded directories...')
      for (const dir of possibleBundledDirs) {
        if (fs.existsSync(path.join(dir, 'g++.exe'))) {
          console.log(`[LSP] Found g++.exe in: ${dir}`)
          lines.push(path.join(dir, 'g++.exe'));
        }
      }
      
      console.log('[LSP] Scanning Windows system PATH...')
      try {
        const output = execSync('where g++ gcc clang clang++ 2>nul', { encoding: 'utf8' })
        const pathMatches = output.split('\n').map(l => l.trim()).filter(Boolean)
        console.log(`[LSP] System PATH scan found:`, pathMatches)
        lines.push(...pathMatches)
      } catch (e) {}
    } else if (platform === 'linux') {
      const standardPaths = ['/usr/bin/g++', '/usr/bin/clang++', '/usr/local/bin/g++', '/usr/local/bin/clang++'];
      for (const p of standardPaths) {
        if (fs.existsSync(p)) lines.push(p);
      }
      try {
        const output = execSync('which g++ gcc clang clang++ 2>/dev/null', { encoding: 'utf8' })
        lines.push(...output.split('\n').map(l => l.trim()).filter(Boolean))
      } catch (e) {}
    } else if (platform === 'darwin') {
      try {
        const output = execSync('which g++ gcc clang clang++ 2>/dev/null', { encoding: 'utf8' })
        lines.push(...output.split('\n').map(l => l.trim()).filter(Boolean))
      } catch (e) {}
    }
    
    // Deduplicate
    lines = [...new Set(lines)];
    console.log(`[LSP] Unique compiler binaries found before validation:`, lines)
    
    for (let line of lines) {
      if (platform === 'linux' || platform === 'darwin') {
        try {
          line = await fs.promises.realpath(line)
        } catch (e) {}
      }

      const name = path.basename(line).toLowerCase()
      const isClang = name.includes('clang')
      
      const label = isClang 
        ? `clang (${path.dirname(line)})` 
        : `gcc/g++ (${path.dirname(line)})`
        
      const binDir = path.dirname(line).replace(/\\/g, '/')
      compilers.add(JSON.stringify({ label, binDir, isClang }))
    }
  } catch (e) {
    console.error('[LSP] Error during compiler detection', e)
  }
  
  const parsedCompilers = Array.from(compilers).map(c => JSON.parse(c))
  console.log(`[LSP] Final available compilers list:`, parsedCompilers)
  return parsedCompilers
}

// macOS SDK resolution with caching
let cachedMacOsSdkPath = null;
const versionCache = new Map();

async function getCompilerVersionAndArch(exePath) {
  if (versionCache.has(exePath)) return versionCache.get(exePath);
  
  let majorVersion = 0;
  let isAppleClang = false;
  let isClang = false;
  let isGcc = false;
  let arch = '';
  
  try {
    const versionOutputFull = await execAsync(`"${exePath}" --version`).catch(() => ({ stdout: '' }));
    const stdoutFull = versionOutputFull.stdout || '';
    
    if (stdoutFull.includes('Apple clang')) {
      isAppleClang = true;
      const match = stdoutFull.match(/Apple clang version (\d+)/i);
      if (match) majorVersion = parseInt(match[1], 10);
    } else {
      const versionOutput = await execAsync(`"${exePath}" -dumpversion`).catch(() => ({ stdout: '' }));
      const stdoutDump = versionOutput.stdout.trim() || '';
      
      const match = stdoutDump.match(/^(\d+)/);
      if (match) majorVersion = parseInt(match[1], 10);
      
      if (stdoutFull.toLowerCase().includes('clang')) {
        isClang = true;
      } else {
        isGcc = true;
      }
    }
    
    const machineOutput = await execAsync(`"${exePath}" -dumpmachine`).catch(() => ({ stdout: '' }));
    arch = machineOutput.stdout.trim();
    
    const result = { majorVersion, isAppleClang, isClang, isGcc, arch };
    versionCache.set(exePath, result);
    
    console.log(`[LSP] Version Check for ${exePath} ->`, result)
    return result;
  } catch (e) {
    console.error(`[LSP] Failed to parse version/arch for ${exePath}`, e)
    return null;
  }
}

export async function getMacOsSdkPath() {
  if (os.platform() !== 'darwin') return null;
  if (cachedMacOsSdkPath) return cachedMacOsSdkPath;
  
  try {
    const { stdout } = await execAsync('xcrun --show-sdk-path');
    cachedMacOsSdkPath = stdout.trim();
    return cachedMacOsSdkPath;
  } catch (e) {
    return null;
  }
}

export function getCachedMacOsSdkPath() {
  return cachedMacOsSdkPath;
}

export function clearToolchainCache() {
  console.log('[LSP] Toolchain Cache Cleared!')
  cachedMacOsSdkPath = null;
  versionCache.clear();
}

export async function validateHostToolchain() {
  console.log('\n--- [PRE-FLIGHT VALIDATION] ---')
  const platform = os.platform();
  
  let exePath = getCompilerPathsForLanguage('cpp');
  console.log(`[LSP] Targeted compiler path to validate: ${exePath}`)

  if (!exePath) {
    console.log(`[LSP] No active compiler found in config. Running detection...`)
    const detected = await detectCppCompilers();
    if (detected.length > 0) {
       const isClang = detected[0].isClang || detected[0].binDir.toLowerCase().includes('clang');
       const exe = isClang ? 'clang++' : 'g++';
       exePath = path.join(detected[0].binDir, exe + (platform === 'win32' ? '.exe' : '')).replace(/\\/g, '/');
       console.log(`[LSP] Auto-selected first detected compiler: ${exePath}`)
    }
  }
  
  if (platform === 'darwin') {
    try {
      execSync('xcode-select -p', { stdio: 'ignore' });
    } catch (e) {
      return { success: false, error: 'Missing Xcode Tools.', remediationCommand: 'xcode-select --install', isMacOs: true };
    }
  } else if (platform === 'linux') {
    try {
      execSync('which g++ clang++ gcc clang 2>/dev/null', { stdio: 'ignore' });
    } catch (e) {
      return { success: false, error: 'Missing Toolchain', remediationCommand: 'sudo apt install build-essential', isLinux: true };
    }
  } else if (platform === 'win32') {
    if (!exePath) {
      return { success: false, error: 'Missing Toolchain.', remediationCommand: 'Install MinGW-w64.', isWindows: true };
    }
  }

  // Version and Architecture Guard
  if (exePath) {
    console.log(`[LSP] Running strict architecture guards on: ${exePath}`)
    const info = await getCompilerVersionAndArch(exePath);
    if (info) {
      let failedGuard = false;
      
      if (info.isAppleClang && info.majorVersion < 12) { console.log('[LSP] Failed Guard: Apple Clang < 12'); failedGuard = true; }
      if (info.isClang && info.majorVersion < 10) { console.log('[LSP] Failed Guard: LLVM Clang < 10'); failedGuard = true; }
      if (info.isGcc && info.majorVersion < 8) { console.log('[LSP] Failed Guard: GCC < 8'); failedGuard = true; }

      if (platform === 'win32') {
        const lowerArch = info.arch.toLowerCase();
        if (lowerArch.startsWith('i686') || lowerArch.startsWith('i386') || lowerArch === 'mingw32') {
          console.log(`[LSP] Failed Guard: Detected 32-bit legacy arch (${lowerArch})`)
          failedGuard = true;
        }
      }

      if (failedGuard) {
        return {
          success: false,
          error: platform === 'win32' ? "Outdated 32-bit compiler." : "Outdated compiler.",
          remediationCommand: platform === 'win32' ? "Please install a 64-bit MinGW-w64 UCRT toolchain." : "Upgrade compiler.",
          reason: 'outdated_compiler',
          isWindows: platform === 'win32',
          isLinux: platform === 'linux',
          isMacOs: platform === 'darwin'
        };
      }
      console.log(`[LSP] Validation PASSED for ${exePath}`)
    }
  }

  return { success: true };
}

export async function getResolvedQueryDriverArg() {
  const config = getCompilerConfig()
  let targetDir = ''
  
  if (config.manualOverride) {
    targetDir = config.manualOverride
  } else if (config.selectedCompiler && config.selectedCompiler.binDir) {
    targetDir = config.selectedCompiler.binDir
  } else {
    const detected = await detectCppCompilers()
    if (detected.length > 0) {
      targetDir = detected[0].binDir
      saveCompilerConfig({ ...config, selectedCompiler: detected[0] })
    }
  }
  
  if (!targetDir) {
    return '--query-driver=**'
  }
  
  if (os.platform() === 'win32' && targetDir.includes(' ')) {
    try {
      const shortPath = execSync(`for %I in ("${targetDir}") do @echo %~sI`, { shell: 'cmd.exe', encoding: 'utf8' }).trim()
      if (shortPath) targetDir = shortPath
    } catch(e) {}
  }
  
  let formattedDir = targetDir.replace(/\\/g, '/')
  if (formattedDir.endsWith('/')) {
    formattedDir = formattedDir.slice(0, -1)
  }
  
  return `--query-driver=${formattedDir}/*`
}

export function getCompilerPathsForLanguage(language) {
  const config = getCompilerConfig()
  let targetDir = ''
  let isClang = false
  if (config.manualOverride) {
    targetDir = config.manualOverride
    isClang = targetDir.toLowerCase().includes('clang')
  } else if (config.selectedCompiler && config.selectedCompiler.binDir) {
    targetDir = config.selectedCompiler.binDir
    isClang = config.selectedCompiler.isClang !== undefined ? config.selectedCompiler.isClang : targetDir.toLowerCase().includes('clang')
  }
  
  if (!targetDir) return null
  
  let exe = ''
  if (language === 'c') {
    exe = isClang ? 'clang' : 'gcc'
  } else {
    exe = isClang ? 'clang++' : 'g++'
  }
  
  if (os.platform() === 'win32') exe += '.exe'
  
  return path.join(targetDir, exe).replace(/\\/g, '/')
}