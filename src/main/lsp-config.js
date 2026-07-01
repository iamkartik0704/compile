export const LSP_REGISTRY = {
  javascript: {
    extensionId: 'ext-lsp-typescript',
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['typescript-language-server', '--stdio'],
    transport: 'stdio'
  },
  typescript: {
    extensionId: 'ext-lsp-typescript',
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['typescript-language-server', '--stdio'],
    transport: 'stdio'
  },
  python: {
    extensionId: 'ext-lsp-python',
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['pyright-langserver', '--stdio'],
    transport: 'stdio'
  },
  cpp: {
    extensionId: 'ext-lsp-cpp',
    command: 'clangd',
    args: [],
    transport: 'stdio'
  },
  c: {
    extensionId: 'ext-lsp-cpp',
    command: 'clangd',
    args: [],
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
