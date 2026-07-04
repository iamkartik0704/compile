# Fix File Lifecycle Timing for LSP Initialization

## Problem Summary
Currently, `clangd` diagnostics and toolchain validation appear to only trigger when a user clicks or edits a file. This is caused by a race condition in `CodeEditor.jsx`:
1. The `activeFile` changes, triggering `bootLsp()`.
2. `bootLsp()` runs immediately, before the actual file content finishes loading (so it reads `content = 'Loading...'`).
3. `bootLsp()` calls `startLanguageServer()` and then sends `didOpen()` with the "Loading..." string.
4. When the file finishes loading from disk, the editor updates, but `bootLsp()` does NOT run again, so `didOpen()` with the real code is never sent.
5. The only way the LSP receives the real code is when the user types or clicks (which triggers Monaco's `onDidChangeModelContent` or other listeners), finally sending `didChange()` and returning diagnostics.

## Proposed Changes

### 1. Frontend Editor Lifecycle Re-wiring (`src/renderer/src/components/CodeEditor.jsx`)
- **Remove `bootLsp()` from the raw `activeFile` dependency**: We will modify the `useEffect` so that `bootLsp()` and `startLanguageServer()` are only triggered **after** `fileContents[activeFile]` finishes loading (`isLoading: false`) and `currentValue` is the real code (not "Loading...").
- **Alternatively, decouple initialization**:
  - We can trigger `window.api.startLanguageServer()` instantly on `activeFile` change to ensure the toolchain validation runs instantly and blocks the UI immediately.
  - However, we will delay the `client.didOpen()` payload until `currentValue` is fully populated, or we will hook it to Monaco's `onMount` / `handleEditorChange` properly.
  - To ensure instant blocking: I will extract the `startLanguageServer` call to an independent effect that runs on `[activeFile]`. Then I will create a second effect or callback that sends `didOpen` as soon as the real file content is loaded.

### 2. Backend Pre-Flight Guard Alignment (`src/main/lsp-manager.js`)
- Ensure that the IPC handlers process the initialization instantly. 
- The current `startLanguageServer` function already awaits `validateHostToolchain()` and emits `show-missing-toolchain-modal` before spawning the child process. Because we are decoupling the frontend validation trigger from the file content loading delay, this payload will reach the frontend instantly upon tab activation, blocking the UI before the user interacts with the canvas.

## Verification Plan
1. Launch the IDE and open a C++ file with an invalid toolchain setup.
2. Verify the `Outdated Compiler Detected` or `Toolchain Missing` modal pops up **instantly** without requiring a click or keypress.
3. Open a valid C++ file with a syntax error.
4. Verify the red squiggles appear **instantly** upon load without requiring the user to edit the file.
