# Language Server Protocol (LSP) Setup Guide

Your IDE has built-in LSP support for multiple languages. This guide shows how to set up each language server.

## Supported Languages

### ✅ Python
**Status**: Built-in (via Pyright)
- No additional setup needed
- Pyright is bundled with the IDE

### C / C++
**Status**: Requires `clangd`
- **Windows**: Install via WinGet or LLVM installer
  ```bash
  winget install LLVM.LLVM
  # or download from https://releases.llvm.org/
  ```
- **macOS**: `brew install llvm`
- **Linux**: `sudo apt install clang-tools` (Ubuntu) or `sudo pacman -S clang` (Arch)

### Go
**Status**: Requires `gopls`
- **All platforms**:
  ```bash
  go install github.com/golang/tools/gopls@latest
  ```
- Ensure `$GOPATH/bin` is in your PATH

### Rust
**Status**: Requires `rust-analyzer`
- **Installation**:
  ```bash
  rustup component add rust-analyzer
  ```
- Or install via cargo:
  ```bash
  cargo install rust-analyzer
  ```

### TypeScript / JavaScript
**Status**: Requires `typescript-language-server` (optional)
- **Installation**:
  ```bash
  npm install -g typescript-language-server typescript
  ```
- Without it, Monaco Editor provides basic syntax highlighting and error checking

### Shell / Bash
**Status**: Requires `bash-language-server`
- **Installation**:
  ```bash
  npm install -g bash-language-server
  ```

### Java
**Status**: Requires Eclipse JDTLS
- **Installation**: Download from https://github.com/eclipse-jdtls/eclipse.jdt.ls/wiki/Running-the-JAVA-LS-server-from-the-command-line
- Add to your PATH

### C# / .NET
**Status**: Requires OmniSharp
- **Installation**:
  ```bash
  dotnet tool install -g omnisharp
  ```
- Or download from https://github.com/OmniSharp/omnisharp-roslyn

## How to Check What's Installed

The IDE will log which language servers are available at startup. Check the Developer Console (F12 in dev mode) for messages like:
```
LSP [python] initialized.
LSP [cpp] stderr: (not found)
```

## Automatic Installation Scripts

### Windows PowerShell
```powershell
# Install LLVM for C/C++
winget install LLVM.LLVM

# Install TypeScript Language Server
npm install -g typescript-language-server typescript

# Install Bash Language Server
npm install -g bash-language-server
```

### macOS
```bash
# Install Homebrew first if not installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install LLVM for C/C++
brew install llvm

# Install TypeScript Language Server
npm install -g typescript-language-server typescript

# Install Bash Language Server
npm install -g bash-language-server
```

### Linux (Ubuntu/Debian)
```bash
# Install LLVM for C/C++
sudo apt update
sudo apt install clang-tools

# Install TypeScript Language Server
npm install -g typescript-language-server typescript

# Install Bash Language Server
npm install -g bash-language-server
```

## Troubleshooting

### Language server not starting?
1. Check if the binary is in your PATH
   - Run `where clangd` (Windows) or `which clangd` (macOS/Linux)
2. Check IDE logs in Developer Tools (F12)
3. Try reinstalling the language server

### IntelliSense not working?
1. Make sure the file is saved
2. Make sure the language is correctly detected (check file extension)
3. Restart the IDE

### Performance issues?
Some language servers can be resource-intensive. You can:
- Close unused editor tabs
- Disable language servers for languages you're not using
- Increase IDE memory if available

## Adding More Language Servers

To add support for a new language:

1. **Backend** (`src/main/index.js`):
   - Add a case in `getLspCommand()` function
   - Return `[command, args]` for the LSP binary or Node.js script

2. **Frontend** (`src/renderer/src/components/CodeEditor.jsx`):
   - Add file extension to `getLanguageFromPath()`
   - Add language mapping to `lspLanguageKey()`
   - Add trigger characters for completion in `registerProvidersForLanguage()`

3. **Install** the language server binary or npm package

## Language Servers Used

| Language | LSP Server | Installation |
|----------|-----------|--------------|
| Python | Pyright | Bundled |
| C/C++ | clangd | LLVM package |
| Go | gopls | `go install` |
| Rust | rust-analyzer | `rustup component add` |
| TypeScript | typescript-language-server | `npm install -g` |
| JavaScript | typescript-language-server | `npm install -g` |
| Bash | bash-language-server | `npm install -g` |
| Java | Eclipse JDTLS | Manual download |
| C# | OmniSharp | `dotnet tool install -g` |

---

Need help? Check the IDE logs or open an issue in the repository.
