import { ipcMain, app } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getCompilerPathsForLanguage, getMacOsSdkPath } from './compiler-detection.js'

function getWorkspaceHash(workspaceRoot) {
  return crypto.createHash('md5').update(workspaceRoot).digest('hex')
}

function getOwnerFilePath(workspaceRoot) {
  const hash = getWorkspaceHash(workspaceRoot)
  const dir = path.join(app.getPath('userData'), 'compilation-dbs')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${hash}-owner.json`)
}

function isDbOwnedByUs(workspaceRoot, dbPath) {
  const ownerPath = getOwnerFilePath(workspaceRoot)
  if (fs.existsSync(ownerPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(ownerPath, 'utf8'))
      if (data.owned) return true
    } catch(e) {}
  }
  // If no owner file exists, but compile_commands.json exists, it's externally managed
  return !fs.existsSync(dbPath)
}

function markDbAsOwned(workspaceRoot) {
  const ownerPath = getOwnerFilePath(workspaceRoot)
  fs.writeFileSync(ownerPath, JSON.stringify({ owned: true, timestamp: Date.now() }))
}

function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.tmp.${Date.now()}`
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2))
  fs.renameSync(tmpPath, filePath)
}

export function setupCompilationDbHandlers() {
  ipcMain.handle('lsp:ensure-compilation-db', async (_event, { filepath, workspaceRoot }) => {
    if (!filepath || !workspaceRoot) return { success: false, error: 'Missing arguments' }
    
    // Only process .c and .cpp / header files
    const ext = path.extname(filepath).toLowerCase()
    // NOTE: `.h` is intentionally treated as C++ here even though the
    // renderer's language map reports it as C. Most real-world projects
    // use `.h` for both C and C++ headers, and clangd will happily
    // downgrade to C mode when a `.h` header is included from a `.c`
    // TU. Emitting a C++-flavoured command lets it parse things like
    // `class`, `namespace`, and templates that show up in mixed
    // codebases without lighting up the entire file in red.
    let language = ''
    if (ext === '.c') language = 'c'
    else if (['.cpp', '.cc', '.cxx', '.c++', '.h', '.hpp', '.hxx', '.hh', '.inl', '.ipp'].includes(ext)) language = 'cpp'
    else return { success: true, ignored: true }

    const isHeader = ['.h', '.hpp', '.hxx', '.hh', '.inl', '.ipp'].includes(ext)
    
    const dbPath = path.join(workspaceRoot, 'compile_commands.json')
    
    // Hands off if externally managed
    if (!isDbOwnedByUs(workspaceRoot, dbPath)) {
      return { success: true, externallyManaged: true }
    }
    
    // Get the correct compiler path for the language (e.g. gcc for C, g++ for C++)
    const compilerPath = getCompilerPathsForLanguage(language)
    if (!compilerPath) {
      return { success: false, error: 'No compiler detected' }
    }
    
    let db = []
    if (fs.existsSync(dbPath)) {
      try {
        db = JSON.parse(fs.readFileSync(dbPath, 'utf8'))
      } catch (e) {
        db = []
      }
    }
    
    // Ensure absolute forward-slash paths
    const formattedFilePath = filepath.replace(/\\/g, '/')
    const formattedWorkspaceRoot = workspaceRoot.replace(/\\/g, '/')
    
    // Sane defaults. Header files get the *-header input kind so
    // clangd doesn't complain about missing `main()` or one-definition
    // rules the way it would for a source translation unit.
    let langFlag
    if (language === 'cpp') {
      langFlag = isHeader ? '-xc++-header' : '-xc++'
    } else {
      langFlag = isHeader ? '-xc-header' : '-xc'
    }

    // Pinning a language standard is important: without it clangd
    // silently falls back to gnu++14 / gnu17 and rejects perfectly
    // valid modern syntax (structured bindings, `if constexpr`,
    // designated initializers, etc.) as an "unknown token".
    const stdFlag = language === 'cpp' ? '-std=c++17' : '-std=c11'

    let flags = `${langFlag} ${stdFlag}`

    // Detect MinGW / MSYS2 toolchains that ship with clangd on
    // Windows. `getCompilerPathsForLanguage` normalizes to forward
    // slashes so the substring check is cheap and reliable.
    const cpLower = compilerPath.toLowerCase()
    const looksLikeMingw = cpLower.includes('mingw') ||
      cpLower.includes('msys') ||
      cpLower.includes('/w64/') ||
      cpLower.includes('/x86_64-w64-') ||
      cpLower.includes('/i686-w64-')

    if (looksLikeMingw) {
      // Give clangd everything it needs to resolve the MinGW
      // libstdc++ headers. Without --target it will pick the host
      // triple (typically an MSVC one) and fail to find <cstdio>,
      // <windows.h>, and friends — the exact symptom that produces
      // red squiggles under correct code.
      flags += ' --target=x86_64-w64-mingw32'
      flags += ' -D__MSVCRT__=1 -D__MINGW32__=1 -D__MINGW64__=1'
      flags += ' -D_WIN32=1 -D__GNUC__=13'
    } else if (process.platform === 'win32' && cpLower.includes('clang')) {
      // Bare clang on Windows still needs the MSVC target hint.
      flags += ' --target=x86_64-pc-windows-msvc'
    } else if (process.platform === 'darwin') {
      const sdkPath = await getMacOsSdkPath()
      if (sdkPath) {
        flags += ` -isysroot "${sdkPath}"`
      }
    }

    // Tell clangd to search the project root for headers — otherwise
    // "#include \"foo.h\"" fails to resolve when foo.h lives next
    // to the file being edited.
    flags += ` -I"${formattedWorkspaceRoot}"`
    const fileDir = path.dirname(formattedFilePath)
    if (fileDir && fileDir !== formattedWorkspaceRoot) {
      flags += ` -I"${fileDir}"`
    }

    const command = `"${compilerPath}" ${flags} -c "${formattedFilePath}"`
    
    const existingIndex = db.findIndex(entry => entry.file === formattedFilePath)
    const newEntry = {
      directory: formattedWorkspaceRoot,
      command,
      file: formattedFilePath
    }
    
    let changed = false
    if (existingIndex >= 0) {
      if (db[existingIndex].command !== command) {
        db[existingIndex] = newEntry
        changed = true
      }
    } else {
      db.push(newEntry)
      changed = true
    }
    
    if (changed) {
      atomicWriteJson(dbPath, db)
      markDbAsOwned(workspaceRoot)
    }
    
    return { success: true, changed }
  })
}
