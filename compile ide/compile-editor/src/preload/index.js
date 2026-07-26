import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // Request file contents from the backend
  getFileContents: (filePath) => ipcRenderer.invoke('get-file-contents', filePath),
  
  // Send prompt to AI
  sendAIPrompt: (prompt) => ipcRenderer.invoke('send-ai-prompt', prompt),

  // Listen for streaming chunks
  onAIStream: (callback) => {
      ipcRenderer.removeAllListeners('ai-stream-chunk');
      ipcRenderer.on('ai-stream-chunk', (_event, chunk) => callback(chunk));
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}