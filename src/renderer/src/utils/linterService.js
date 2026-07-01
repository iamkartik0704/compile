import * as monaco from 'monaco-editor'

const getSeverity = (eslintSeverity) => {
  switch (eslintSeverity) {
    case 1: return monaco.MarkerSeverity.Warning
    case 2: return monaco.MarkerSeverity.Error
    case 3:
    case 4: return monaco.MarkerSeverity.Info
    default: return monaco.MarkerSeverity.Info
  }
}

/**
 * Shows a toast notification to the user
 */
const showToast = (message, type = 'info') => {
  // Use the existing custom event system
  window.dispatchEvent(new CustomEvent('show-toast', {
    detail: { message, type }
  }))
}

/**
 * Runs ESLint on a file and returns Monaco markers.
 * @param {string} filePath - Full path to the file
 * @param {string} cwd - Working directory for the command
 * @returns {Promise<{markers: Array, error: string | null}>}
 */
export const runEsLint = async (filePath, cwd) => {
  if (!filePath) return { markers: [], error: null }

  // Use npx to prefer local node_modules over global
  const command = `npx eslint --format json "${filePath}" 2>&1`

  let res
  try {
    res = await window.api.runCommand(command, cwd)
  } catch (e) {
    if (e.message?.includes('ENOENT') || e.message?.includes('not found')) {
      showToast('ESLint not found in environment', 'warning')
      return { markers: [], error: 'ESLint not found in environment' }
    }
    showToast('ESLint execution failed', 'error')
    return { markers: [], error: `ESLint execution failed: ${e.message}` }
  }

  if (!res || (!res.stdout && !res.stderr)) {
    showToast('ESLint not found in environment', 'warning')
    return { markers: [], error: 'ESLint not found in environment' }
  }

  let lintResults = []
  try {
    const output = res.stdout || res.stderr || '[]'
    lintResults = JSON.parse(output)
  } catch (err) {
    // If JSON parsing fails, might be ESLint not found or other error
    if (res.stderr && (res.stderr.includes('not found') || res.stderr.includes('could not determine'))) {
      showToast('ESLint not found in environment', 'warning')
      return { markers: [], error: 'ESLint not found in environment' }
    }
    return { markers: [], error: 'Failed to parse ESLint output' }
  }

  if (!Array.isArray(lintResults)) {
    return { markers: [], error: null }
  }

  const markers = []
  for (const fileResult of lintResults) {
    if (fileResult.messages && Array.isArray(fileResult.messages)) {
      for (const msg of fileResult.messages) {
        markers.push({
          severity: getSeverity(msg.severity),
          message: msg.message + (msg.ruleId ? ` (${msg.ruleId})` : ''),
          startLineNumber: msg.line || 1,
          startColumn: msg.column || 1,
          endLineNumber: msg.endLine || msg.line || 1,
          endColumn: msg.endColumn || msg.column || 1,
          source: 'eslint'
        })
      }
    }
  }

  return { markers, error: null }
}

/**
 * Runs Prettier on a file.
 * @param {string} filePath - Full path to the file
 * @param {string} cwd - Working directory for the command
 * @param {boolean} write - If true, formats the file. If false, just checks.
 * @returns {Promise<{success: boolean, error: string | null, needsFormatting?: boolean}>}
 */
export const runPrettier = async (filePath, cwd, write = false) => {
  if (!filePath) return { success: false, error: null }

  const flag = write ? '--write' : '--check'
  const command = `npx prettier ${flag} "${filePath}" 2>&1`

  let res
  try {
    res = await window.api.runCommand(command, cwd)
  } catch (e) {
    if (e.message?.includes('ENOENT') || e.message?.includes('not found')) {
      showToast('Prettier not found in environment', 'warning')
      return { success: false, error: 'Prettier not found in environment' }
    }
    showToast('Prettier execution failed', 'error')
    return { success: false, error: `Prettier execution failed: ${e.message}` }
  }

  // Prettier --check returns exit code 1 if file needs formatting
  // but still outputs to stdout/stderr
  if (res.error) {
    // Check if it's just a formatting issue (not an error)
    if (!write && res.stdout && res.stdout.includes('would be reformatted')) {
      return { success: false, needsFormatting: true, error: null }
    }
    if (res.stderr && (res.stderr.includes('SyntaxError') || res.stderr.includes('Parsing'))) {
      showToast('Prettier: Syntax error in file', 'error')
      return { success: false, error: 'Prettier: Syntax error in file' }
    }
    // If npx couldn't find prettier
    if (res.stderr && (res.stderr.includes('could not determine') || res.error?.includes('ENOENT'))) {
      showToast('Prettier not found in environment', 'warning')
      return { success: false, error: 'Prettier not found in environment' }
    }
    showToast('Prettier formatting failed', 'error')
    return { success: false, error: 'Prettier formatting failed' }
  }

  return { success: true, error: null }
}

/**
 * Format a document using Prettier and return the formatted content.
 * @param {string} filePath - Full path to the file
 * @param {string} cwd - Working directory for the command
 * @returns {Promise<{success: boolean, content?: string, error?: string}>}
 */
export const formatWithPrettier = async (filePath, cwd) => {
  if (!filePath) return { success: false, error: null }

  const command = `npx prettier --write "${filePath}" 2>&1`

  let res
  try {
    res = await window.api.runCommand(command, cwd)
  } catch (e) {
    if (e.message?.includes('ENOENT') || e.message?.includes('not found')) {
      showToast('Prettier not found in environment', 'warning')
      return { success: false, error: 'Prettier not found in environment' }
    }
    showToast('Prettier execution failed', 'error')
    return { success: false, error: `Prettier execution failed: ${e.message}` }
  }

  if (res.error && res.stderr && (res.stderr.includes('could not determine') || res.error.includes('ENOENT'))) {
    showToast('Prettier not found in environment', 'warning')
    return { success: false, error: 'Prettier not found in environment' }
  }

  // Read the formatted file
  try {
    const contentRes = await window.api.getFileContents(filePath)
    if (contentRes.success) {
      return { success: true, content: contentRes.content, error: null }
    }
    return { success: false, error: 'Failed to read formatted file' }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * Check if an extension is enabled.
 * @param {string} extId - Extension ID (e.g., 'ext-fmt-prettier')
 * @param {Array} extensions - The extensions array from app store
 * @returns {boolean}
 */
export const isExtensionEnabled = (extId, extensions) => {
  const ext = extensions.find(e => e.id === extId)
  return ext ? ext.enabled : false
}