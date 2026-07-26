import { useState, useEffect } from 'react';

function App() {
  const [stream, setStream] = useState("");
  const [isStreaming, setIsStreaming] = useState(false); // Add a loading state

  // ... useEffect stays the same ...

  const handleTestBridge = async () => {
     // 1. Lock the button to prevent overlapping clicks
     setIsStreaming(true);
     
     // 2. Clear the old text from the screen
     setStream(""); 

    //  setStream((prev) => prev + "Testing ");
    //  setTimeout(() => setStream((prev) => prev + "React "), 500);
    //  setTimeout(() => setStream((prev) => prev + "State..."), 1000);
     const result = await window.api.getFileContents('/test/file.js');
     console.log("Backend replied:", result);
     
     await window.api.sendAIPrompt("Write a variable");
     
     // Unlock the button after 1.5 seconds (when our mock backend finishes)
     setTimeout(() => setIsStreaming(false), 1500);
  };

  return (
    <div style={{ padding: '20px', backgroundColor: '#1e1e1e', color: '#fff', height: '100vh', fontFamily: 'sans-serif' }}>
      <h1>comπle Code Editor</h1>
      <p>Phase 1 & 3: JS Shell and Bridge Active.</p>
      
      <button 
        onClick={handleTestBridge} 
        disabled={isStreaming}
        style={{ 
          padding: '10px', 
          marginTop: '20px', 
          cursor: isStreaming ? 'not-allowed' : 'pointer',
          opacity: isStreaming ? 0.5 : 1
        }}
      >
        {isStreaming ? "Streaming..." : "Test IPC Bridge & AI Stream"}
      </button>
      {/* button disabled while already streaming */}
      
      <div style={{ marginTop: '20px', fontFamily: 'monospace', color: '#00ff00', fontSize: '18px' }}>
        {stream}
      </div>
    </div>
  )
}

export default App