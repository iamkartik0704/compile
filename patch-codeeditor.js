const fs = require('fs');
const file = 'src/renderer/src/components/CodeEditor.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add Refs
const refMarker = `  const [currentValue, setCurrentValue] = useState('')
  const [draggedTabIdx, setDraggedTabIdx] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const editorRef = useRef(null)`;

const refInsert = `
  const openFilesRef = useRef(openFiles)
  useEffect(() => { openFilesRef.current = openFiles }, [openFiles])
  const fileContentsRef = useRef(fileContents)
  useEffect(() => { fileContentsRef.current = fileContents }, [fileContents])
`;
content = content.replace(refMarker, refMarker + refInsert);

// 2. Delay
const delayMarker = `await new Promise(resolve => setTimeout(resolve, 800))`;
const delayInsert = `await new Promise(resolve => setTimeout(resolve, globalAiConfig.autoCompleteDelay || 800))`;
content = content.replace(delayMarker, delayInsert);

// 3. Additional Context
const promptMarker = `      // 3. Prompt Construction
      const prompt = \`You are a strict code completion engine.`;

const promptInsert = `      // 2.5 Extract context from other open files
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
      }

      // 3. Prompt Construction
      const prompt = \`You are a strict code completion engine.`;

content = content.replace(promptMarker, promptInsert);

const promptEndMarker = `PREFIX:
\${prefix}

SUFFIX:
\${suffix}

COMPLETION:\``;

const promptEndInsert = `ADDITIONAL CONTEXT:
\${otherFilesContext || 'None'}

PREFIX:
\${prefix}

SUFFIX:
\${suffix}

COMPLETION:\``;

content = content.replace(promptEndMarker, promptEndInsert);

fs.writeFileSync(file, content);
console.log('CodeEditor.jsx patched successfully');
