const fs = require('fs');
const file = 'src/renderer/src/components/CodeEditor.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Define global variables
const globalMarker = `// Global reference to the current AI config so the provider can access it
let globalAiConfig = null`;

const globalInsert = `// Global reference to the current AI config so the provider can access it
let globalAiConfig = null
let globalOpenFiles = []
let globalFileContents = {}
let globalActiveFile = null`;

content = content.replace(globalMarker, globalInsert);

// 2. Replace the bad Context code in provider
const badContextMarker = `      // 2.5 Extract context from other open files
      let otherFilesContext = ''
      if (openFilesRef.current && openFilesRef.current.length > 1) {
        for (const f of openFilesRef.current) {
          if (f.path !== activeFile) {
            const fileData = fileContentsRef.current[f.path]?.content || ''
            if (fileData) {
              otherFilesContext += \`\\n<context_file path="\${f.path}">\\n\${fileData.substring(0, 2000)}\\n</context_file>\`
            }
          }
        }
      }`;

const goodContextInsert = `      // 2.5 Extract context from other open files
      let otherFilesContext = ''
      if (globalOpenFiles && globalOpenFiles.length > 1) {
        for (const f of globalOpenFiles) {
          if (f.path !== globalActiveFile) {
            const fileData = globalFileContents[f.path]?.content || ''
            if (fileData) {
              otherFilesContext += \`\\n<context_file path="\${f.path}">\\n\${fileData.substring(0, 2000)}\\n</context_file>\`
            }
          }
        }
      }`;

content = content.replace(badContextMarker, goodContextInsert);

// 3. Remove the bad refs inside CodeEditor component
const badRefsMarker = `  const openFilesRef = useRef(openFiles)
  useEffect(() => { openFilesRef.current = openFiles }, [openFiles])
  const fileContentsRef = useRef(fileContents)
  useEffect(() => { fileContentsRef.current = fileContents }, [fileContents])`;

content = content.replace(badRefsMarker, '');

// 4. Add the good global updaters in the useEffect section
const globalUpdateMarker = `  useEffect(() => {
    globalAiConfig = aiConfig
  }, [aiConfig])`;

const globalUpdateInsert = `  useEffect(() => {
    globalAiConfig = aiConfig
  }, [aiConfig])

  useEffect(() => {
    globalOpenFiles = openFiles
  }, [openFiles])

  useEffect(() => {
    globalFileContents = fileContents
  }, [fileContents])

  useEffect(() => {
    globalActiveFile = activeFile
  }, [activeFile])`;

content = content.replace(globalUpdateMarker, globalUpdateInsert);

fs.writeFileSync(file, content);
console.log('CodeEditor.jsx patched successfully');
