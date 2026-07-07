import { getResolvedQueryDriverArg } from './compiler-detection.js'

import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

function resolveNodeLsp(pkgName, scriptPath, fallbackBin) {
  const localScript = join(app.getAppPath(), 'node_modules', pkgName, scriptPath)
  if (existsSync(localScript)) {
    return {
      command: app.isPackaged ? process.execPath : 'node',
      args: [localScript],
      isNode: true
    }
  }
  return {
    command: process.platform === 'win32' ? fallbackBin + '.cmd' : fallbackBin,
    args: [],
    isNode: false
  }
}

export const LSP_REGISTRY = {
  javascript: {
    extensionId: 'ext-lsp-typescript',
    get command() { return resolveNodeLsp('typescript-language-server', 'lib/cli.mjs', 'typescript-language-server').command },
    get args() { return [...resolveNodeLsp('typescript-language-server', 'lib/cli.mjs', 'typescript-language-server').args, '--stdio'] },
    get isNode() { return resolveNodeLsp('typescript-language-server', 'lib/cli.mjs', 'typescript-language-server').isNode },
    transport: 'stdio'
  },
  typescript: {
    extensionId: 'ext-lsp-typescript',
    get command() { return resolveNodeLsp('typescript-language-server', 'lib/cli.mjs', 'typescript-language-server').command },
    get args() { return [...resolveNodeLsp('typescript-language-server', 'lib/cli.mjs', 'typescript-language-server').args, '--stdio'] },
    get isNode() { return resolveNodeLsp('typescript-language-server', 'lib/cli.mjs', 'typescript-language-server').isNode },
    transport: 'stdio'
  },
  python: {
    extensionId: 'ext-lsp-python',
    get command() { return resolveNodeLsp('pyright', 'dist/pyright-langserver.js', 'pyright-langserver').command },
    get args() { return [...resolveNodeLsp('pyright', 'dist/pyright-langserver.js', 'pyright-langserver').args, '--stdio'] },
    get isNode() { return resolveNodeLsp('pyright', 'dist/pyright-langserver.js', 'pyright-langserver').isNode },
    transport: 'stdio'
  },
  cpp: {
    extensionId: 'ext-lsp-cpp',
    command: 'clangd',
    get args() { return [getResolvedQueryDriverArg()] },
    transport: 'stdio'
  },
  c: {
    extensionId: 'ext-lsp-cpp',
    command: 'clangd',
    get args() { return [getResolvedQueryDriverArg()] },
    transport: 'stdio'
  },
  go: {
    extensionId: 'ext-lsp-go',
    command: 'gopls',
    args: [],
    transport: 'stdio'
  },
  rust: {
    extensionId: 'ext-lsp-rust',
    command: 'rust-analyzer',
    args: [],
    transport: 'stdio'
  },
  java: {
    extensionId: 'ext-lsp-java',
    command: 'jdtls',
    args: [],
    transport: 'stdio'
  }
}
