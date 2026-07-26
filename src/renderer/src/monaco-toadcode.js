export function registerToadCode(monaco) {
  if (!monaco) return;

  // Only register if it hasn't been registered yet
  if (!monaco.languages.getLanguages().some(l => l.id === 'toadcode')) {
    monaco.languages.register({ id: 'toadcode', extensions: ['.toad'] });

    // Syntax highlighting rules (Monarch)
    monaco.languages.setMonarchTokensProvider('toadcode', {
      keywords: [
        'if', 'else', 'while', 'for', 'return', 'let', 'const', 'fn'
      ],
      constants: [
        'true', 'false', 'null'
      ],
      tokenizer: {
        root: [
          // Comments
          [/\/\/.*$/, 'comment'],
          
          // Strings
          [/"([^"\\]|\\.)*$/, 'string.invalid' ],  // non-teminated string
          [/"/,  { token: 'string.quote', bracket: '@open', next: '@string' } ],

          // Numbers
          [/\b\d+(\.\d+)?\b/, 'number'],

          // Identifiers & Keywords
          [/[a-zA-Z_]\w*/, {
            cases: {
              '@keywords': 'keyword',
              '@constants': 'constant',
              '@default': 'identifier'
            }
          }],

          // Whitespace
          { include: '@whitespace' },
        ],
        string: [
          [/[^\\"]+/,  'string'],
          [/\\./, 'string.escape.invalid'],
          [/"/,        { token: 'string.quote', bracket: '@close', next: '@pop' } ]
        ],
        whitespace: [
          [/[ \t\r\n]+/, 'white']
        ]
      }
    });

    // Snippets & Autocomplete
    monaco.languages.registerCompletionItemProvider('toadcode', {
      provideCompletionItems: (model, position) => {
        const suggestions = [
          {
            label: 'fn',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'fn ${1:name}(${2:args}) {\n\t$0\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Create a new function',
            detail: 'Function Declaration'
          },
          {
            label: 'if',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'if (${1:condition}) {\n\t$0\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'If statement',
            detail: 'If Statement'
          },
          {
            label: 'ifelse',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'If-Else statement',
            detail: 'If Else Statement'
          },
          {
            label: 'for',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'for (let ${1:i} = 0; ${1:i} < ${2:count}; ${1:i} = ${1:i} + 1) {\n\t$0\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'For loop',
            detail: 'For Loop'
          },
          {
            label: 'while',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'while (${1:condition}) {\n\t$0\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'While loop',
            detail: 'While Loop'
          },
          {
            label: 'toad',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'toad($1);',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Print using toad()',
            detail: 'Print to Console'
          },
          {
            label: 'afn',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: '(${1:args}) => {\n\t$0\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Create an arrow function',
            detail: 'Arrow Function'
          }
        ];
        return { suggestions };
      }
    });
  }
}
