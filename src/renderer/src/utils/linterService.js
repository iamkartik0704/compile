import * as monaco from 'monaco-editor'

// Convert ESLint severity to Monaco severity
const getSeverity = (eslintSeverity) => {
  switch (eslintSeverity) {
    case 1:
      return monaco.MarkerSeverity.Warning
    case 2:
      return monaco.MarkerSeverity.Error
    default:
      return monaco.MarkerSeverity.Info
  }
}

/**
 * Runs ESLint on a file and returns Monaco markers.
 */
export const runEsLint = async (filePath, cwd) => {
  if (!filePath) return { markers: [], error: null }
  
  // Use npx to prefer local node_modules over global
  const command = `npx eslint --format json "${filePath}"`
  
  const res = await window.api.runCommand(command, cwd)
  
  if (res.error && !res.stdout) {
    if (res.error.includes('ENOENT') || res.error.includes('command not found') || res.error.includes('could not determine executable to run')) {
       return { markers: [], error: 'ESLint not found in environment.' }
    }
    return { markers: [], error: `ESLint execution failed: ${res.error}` }
  }

  let lintResults = []
  try {
    if (res.stdout) {
      lintResults = JSON.parse(res.stdout)
    }
  } catch (err) {
    return { markers: [], error: 'Failed to parse ESLint output.' }
  }

  const markers = []
  if (lintResults.length > 0) {
    const fileResult = lintResults[0]
    if (fileResult.messages) {
      fileResult.messages.forEach(msg => {
        markers.push({
          severity: getSeverity(msg.severity),
          message: msg.message + (msg.ruleId ? ` (${msg.ruleId})` : ''),
          startLineNumber: msg.line || 1,
          startColumn: msg.column || 1,
          endLineNumber: msg.endLine || msg.line || 1,
          endColumn: msg.endColumn || msg.column || 1,
          source: 'eslint'
        })
      })
    }
  }

  return { markers, error: null }
}

/**
 * Runs Prettier on a file.
 * @param {string} filePath 
 * @param {string} cwd 
 * @param {boolean} write - If true, formats the file. If false, just checks.
 */
export const runPrettier = async (filePath, cwd, write = false) => {
  if (!filePath) return { success: false, error: null }

  const flag = write ? '--write' : '--check'
  const command = `npx prettier ${flag} "${filePath}"`
  
  const res = await window.api.runCommand(command, cwd)
  
  if (res.error && !res.stdout && !res.stderr) {
    if (res.error.includes('ENOENT') || res.error.includes('command not found') || res.error.includes('could not determine executable to run')) {
      return { success: false, error: 'Prettier not found in environment.' }
    }
    return { success: false, error: `Prettier execution failed: ${res.error}` }
  }

  if (res.error) {
    if (res.stderr && res.stderr.includes('SyntaxError')) {
       return { success: false, error: 'Prettier: Syntax error in file.' }
    }
    if (!write) {
      return { success: false, needsFormatting: true, error: null }
    }
    return { success: false, error: 'Prettier formatting failed.' }
  }

  return { success: true, needsFormatting: false, error: null }
}
