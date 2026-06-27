
const fs = require('fs');
const file = 'src/renderer/src/App.jsx';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes("import { X } from 'lucide-react'")) {
  content = content.replace(
    "import { applyDiff, unescapeXml } from './diffUtils'",
    "import { applyDiff, unescapeXml } from './diffUtils'\\nimport { X } from 'lucide-react'"
  );
}

// 1. Add terminal ref and logic
const terminalRefInsert = `  const terminalPanelRef = useRef(null)
  
  const [aiDebugger, setAiDebugger] = useState({ visible: false, explanation: '', codeFix: '', loading: false })

  const handleRunFile = () => {
    if (!activeFile) return
    let cmd = ''
    if (activeFile.endsWith('.js')) cmd = \`node "\${activeFile}"\`
    else if (activeFile.endsWith('.py')) cmd = \`python "\${activeFile}"\`
    else if (activeFile.endsWith('.cpp') || activeFile.endsWith('.c++') || activeFile.endsWith('.c')) {
      cmd = \`g++ "\${activeFile}" -o out && ./out\`
    } else {
      console.log('Unsupported file type for running')
      return
    }
    
    setShowTerminal(true)
    setTimeout(() => {
      if (terminalPanelRef.current) {
        terminalPanelRef.current.executeCommand(cmd)
      }
    }, 100)
  }

  const handleFixWithAi = async () => {
    if (!terminalPanelRef.current || !activeFile) return
    const bufferText = terminalPanelRef.current.getBuffer()
    const activeFileContent = fileContents?.[activeFile]?.content || ''
    
    setAiDebugger({ visible: true, explanation: '', codeFix: '', loading: true })
    
    const prompt = \`The user encountered a terminal error.
Terminal Output:
\${bufferText.substring(Math.max(0, bufferText.length - 2000))}

Active File (\${activeFile}):
\${activeFileContent.substring(0, 3000)}

Analyze the error and provide a fix. Return your response in exactly this format:
EXPLANATION: <brief explanation of the error>
FIX:
\\\`\\\`\\\`
<full corrected code for the file>
\\\`\\\`\\\`\`
    
    const res = await window.api.getAiCompletion(prompt, { model: selectedModel, customConfig: { baseURL: customBaseUrl, modelId: customModelId } })
    
    if (res && res.success && res.text) {
      const parts = res.text.split('FIX:')
      const explanation = parts[0].replace('EXPLANATION:', '').trim()
      const codeMatch = parts[1] ? parts[1].match(/\\\`\\\`\\\`[a-z]*\\n([\\s\\S]*?)\\\`\\\`\\\`/) : null
      const codeFix = codeMatch ? codeMatch[1] : (parts[1] || '').trim()
      
      setAiDebugger({ visible: true, explanation, codeFix, loading: false })
    } else {
      setAiDebugger({ visible: true, explanation: 'Failed to generate a fix.', codeFix: '', loading: false })
    }
  }

  const applyAiDebuggerFix = async () => {
    if (!activeFile || !aiDebugger.codeFix) return
    
    setFileContents(prev => ({
      ...prev,
      [activeFile]: { ...prev[activeFile], content: aiDebugger.codeFix }
    }))
    markFileDirty(activeFile)
    
    setAiDebugger({ visible: false, explanation: '', codeFix: '', loading: false })
  }
`;

if (!content.includes('const terminalPanelRef = useRef(null)')) {
  content = content.replace("  // ─── Layout State ───", terminalRefInsert + "\\n  // ─── Layout State ───");
}

// 2. Pass ref to TerminalPanel and add "Fix with AI" button
if (!content.includes('ref={terminalPanelRef}')) {
  const terminalReplace = `<TerminalPanel key={projectRoot || 'default'} height={terminalHeight} cwd={projectRoot} />`;
  const terminalNew = `<div style={{ position: 'absolute', right: 20, zIndex: 10, marginTop: '8px' }}>
                    <button onClick={handleFixWithAi} style={{ background: 'var(--accent-color)', color: 'var(--bg-main)', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                      ✨ Fix with AI
                    </button>
                  </div>
                  <TerminalPanel ref={terminalPanelRef} key={projectRoot || 'default'} height={terminalHeight} cwd={projectRoot} />`;
  content = content.replace(terminalReplace, terminalNew);
}

// 3. Render AI Debugger Modal
if (!content.includes('AI Terminal Debugger')) {
  const modalCode = `
      {aiDebugger.visible && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: '800px', maxWidth: '90vw' }}>
            <div className="modal-header">
              <h3>✨ AI Terminal Debugger</h3>
              <button className="icon-btn" onClick={() => setAiDebugger({ visible: false, explanation: '', codeFix: '', loading: false })}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {aiDebugger.loading ? (
                <div style={{ padding: '20px', textAlign: 'center' }}>Analyzing terminal error...</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ background: 'var(--bg-dark)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                    <strong>Explanation:</strong>
                    <p style={{ marginTop: '8px', whiteSpace: 'pre-wrap' }}>{aiDebugger.explanation}</p>
                  </div>
                  {aiDebugger.codeFix && (
                    <div style={{ flex: 1, minHeight: '300px' }}>
                      <strong>Proposed Fix:</strong>
                      <div style={{ marginTop: '8px', height: '300px', overflow: 'auto', border: '1px solid var(--border-light)', borderRadius: '6px' }}>
                        <SyntaxHighlighter language="javascript" style={vscDarkPlus} customStyle={{ margin: 0, height: '100%' }}>
                          {aiDebugger.codeFix}
                        </SyntaxHighlighter>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {!aiDebugger.loading && aiDebugger.codeFix && (
              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                <button className="btn btn-secondary" onClick={() => setAiDebugger({ visible: false, explanation: '', codeFix: '', loading: false })}>Cancel</button>
                <button className="btn btn-primary" onClick={applyAiDebuggerFix}>Apply Fix</button>
              </div>
            )}
          </div>
        </div>
      )}
`;

  content = content.replace("{/* ── Context Menu Overlay ── */}", modalCode + "\\n      {/* ── Context Menu Overlay ── */}");
}

// 4. Pass onRun to CodeEditor
if (!content.includes('onRun={handleRunFile}')) {
  content = content.replace(
    'aiConfig={{ model: selectedModel, customConfig: { baseURL: customBaseUrl, modelId: customModelId }, autoCompleteEnabled, autoCompleteDelay }} />',
    'aiConfig={{ model: selectedModel, customConfig: { baseURL: customBaseUrl, modelId: customModelId }, autoCompleteEnabled, autoCompleteDelay }} onRun={handleRunFile} />'
  );
}

fs.writeFileSync(file, content);
console.log('App.jsx repatched');
