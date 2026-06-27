const fs = require('fs');
const file = 'src/renderer/src/App.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Rename Settings
content = content.replace('API Key Management', 'Settings');

// 2. Add Editor Settings section
const marker = `                <p className="settings-description">
                  Add API keys for each provider you use. Keys are encrypted using your operating system's
                  credential manager (Windows DPAPI / macOS Keychain / Linux Secret Service) and stored
                  securely on disk. The raw key never leaves the Node.js process.
                </p>`;

const insert = `
                {/* Editor Settings */}
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Editor Configuration</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.8rem' }}>AI Auto-Complete Debounce ({autoCompleteDelay}ms)</label>
                    <input 
                      type="range" 
                      min="200" 
                      max="3000" 
                      step="100" 
                      value={autoCompleteDelay}
                      onChange={(e) => setAutoCompleteDelay(Number(e.target.value))}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Wait time before AI suggests code after typing stops.</span>
                  </div>
                </div>

                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>API Keys</h3>`;

content = content.replace(marker, marker + insert);
fs.writeFileSync(file, content);
console.log('App.jsx patched successfully');
