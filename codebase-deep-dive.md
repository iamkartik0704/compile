// integrated api key

# comπle IDE: Codebase Deep Dive

This document provides a highly detailed, file-by-file breakdown of the comπle IDE codebase. It is designed to help new developers understand the architecture, security model, and data flow of the application.

---

## 1. High-Level Architecture

The application is built on **Electron**, which uses a multi-process architecture:
- **Main Process (`Node.js`)**: Manages the application lifecycle, interacts with the operating system, handles file storage, and makes network requests to AI APIs.
- **Renderer Process (`React`)**: Renders the user interface. It runs inside a sandboxed Chromium instance.
- **Preload Script**: Acts as a secure bridge between the Renderer and the Main process, ensuring the UI cannot directly access Node.js APIs.

---

## 2. Directory Structure Overview

```text
comiple ide testing 2/
├── package.json               # Project dependencies and scripts
├── electron.vite.config.mjs   # Vite configuration for building Electron
└── src/
    ├── main/
    │   └── index.js           # The Backend (Node.js)
    ├── preload/
    │   └── index.js           # The Security Bridge
    └── renderer/
        ├── index.html         # HTML entry point
        └── src/
            ├── App.jsx        # The Frontend UI (React)
            ├── main.jsx       # React DOM rendering
            └── assets/
                └── main.css   # Styling and Animations
```

---

## 3. Deep Dive: The Backend (`src/main/index.js`)

This file is the brain of the application. It runs in full Node.js and is responsible for security, file storage, and communicating with external AI providers.

### 3.1. API Key Security & Storage
API keys are highly sensitive. The Main process handles them using Electron's `safeStorage`, which encrypts data using the operating system's native credential manager (e.g., Windows Credential Manager).

- **`apiKeyCache`**: An in-memory object `{ provider: decryptedKey }` that stores the active keys. It is explicitly cleared when the app is closed to prevent memory leaks.
- **`getKeyFilePath()`**: Returns the path to the hidden file `.compile-api-keys` in the user's AppData directory.
- **`writeKeyFile()`**: Writes the encrypted keys to disk. It uses `chmodSync` to set restrictive `0o600` permissions (owner read/write only).
- **`validateApiKey()`**: Ensures the key meets length and character requirements before processing.

### 3.2. Provider Routing (`routeToProvider`)
When the user sends a prompt, the request hits the `send-ai-prompt` IPC handler. 
1. It looks up the model in `MODEL_CONFIG` to determine the provider (Google, Anthropic, DeepSeek, etc.).
2. It fetches the decrypted API key from `apiKeyCache`.
3. It instantiates the correct SDK (`@google/generative-ai`, `@anthropic-ai/sdk`, or `openai`).
4. It calls the streaming API endpoint (e.g., `streamGemini`) and pipes the incoming text chunks back to the Renderer using `sender.send('ai-stream-chunk', text)`.

### 3.3. IPC Handlers
These are the listeners that wait for the frontend to ask for something:
- `handle('save-api-key')`: Validates, encrypts, saves to disk, and caches the key.
- `handle('get-all-keys')`: Reads disk, decrypts, and returns masked hints (e.g., `••••abcd`).
- `handle('delete-api-key')`: Removes the key from disk and memory.

---

## 4. Deep Dive: The Security Bridge (`src/preload/index.js`)

Because the Renderer is sandboxed, it cannot require `fs` or `safeStorage`. The Preload script runs before the Renderer and injects a controlled API into the browser's `window` object via `contextBridge`.

### Exposing the `api` object
The script exposes `window.api` with exactly six functions:
1. `getFileContents(filePath)`
2. `sendAIPrompt(prompt, config)`
3. `onAIStream(callback)`
4. `onModelResolved(callback)`
5. `saveApiKey(provider, key)`
6. `getAllKeys()`
7. `deleteApiKey(provider)`

This guarantees that a malicious script injected into the React frontend cannot read arbitrary files on the user's hard drive—it can only call these specific endpoints.

---

## 5. Deep Dive: The Frontend (`src/renderer/src/App.jsx`)

The entire user interface is a single-page React application contained within `App.jsx`.

### 5.1. Provider Registry & Detection
At the top of the file, `PROVIDERS` is defined. This object dictates the visual theme (colors, emojis) for each API provider.
- **`detectProviderFromKey(key)`**: A utility function that analyzes the prefix of a pasted API key. If it sees `sk-ant-`, it knows it's Anthropic. If it sees `AIza`, it knows it's Google. This powers the "Auto-detect" UI badge.

### 5.2. React State Management
- `messages`: Array of chat objects `{ text, isUser, timestamp }`.
- `providerKeys`: A state object mirroring the backend's key status. It stores whether a provider has a key and its masked hint.
- `selectedModel`: The currently active AI model chosen from the dropdown.

### 5.3. The Render Loop
The UI is divided into two main views, toggled by state:
1. **Chat View**: Displays the message history and the prompt input bar. The input bar includes dynamic badging (showing `✓` or `⚠` depending on whether the selected model has an active API key).
2. **Settings Panel**: A slide-over interface. It loops through `providerKeys` to render "Configured Keys" as visual cards. It also renders the "Add API Key" form, which includes the dropdown, the input field, and the inline delete confirmation workflows.

---

## 6. Deep Dive: Styling & Aesthetics (`src/renderer/src/assets/main.css`)

The CSS file is massive (~1200 lines) because it completely eschews external UI libraries in favor of custom, highly optimized styling.

### 6.1. CSS Variables (Design Tokens)
The `:root` defines all colors, fonts, and animation timings. This makes the UI cohesive. For example, `--provider-color` is dynamically set in React and read by CSS to color the left accent border of the key cards.

### 6.2. Keyframe Animations
- `@keyframes slide-down`: Used for the inline delete confirmation to make it smoothly appear.
- `@keyframes detect-pulse`: Creates the glowing cyan effect on the "Auto-detect" badge.
- `@keyframes card-enter`: A subtle fade-and-slide up effect when a new API key is added to the grid.

### 6.3. Responsive Design
The `@media (max-width: 640px)` query at the bottom ensures the app remains usable if the Electron window is resized to a narrow width, stacking the provider selector and inputs vertically.

---

## 7. Data Flow Example: Sending a Prompt

To fully understand the architecture, follow the data when a user types "Hello" and hits Enter:

1. **Renderer (`App.jsx`)**: Updates `messages` state to show the user's bubble. Calls `window.api.sendAIPrompt("Hello", { model: 'gemini-pro' })`.
2. **Preload (`index.js`)**: intercepts the call and executes `ipcRenderer.invoke('send-ai-prompt', ...)` passing it across the security boundary.
3. **Main (`index.js`)**: 
   - Receives the IPC call.
   - Looks up `gemini-pro` in `MODEL_CONFIG` → identifies it as `gemini-2.5-pro` (Google).
   - Looks up `apiKeyCache['google']`.
   - Calls the actual Google Gemini SDK.
   - Listens to the SDK stream. For every chunk of text received, it calls `sender.send('ai-stream-chunk', text)`.
4. **Preload (`index.js`)**: The listener `ipcRenderer.on('ai-stream-chunk')` fires and triggers the callback provided by React.
5. **Renderer (`App.jsx`)**: The `useEffect` listener receives the text chunk and updates the `streamRef.current` and React state to visually type out the AI's response on the screen.
