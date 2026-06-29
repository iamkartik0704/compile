import json
import os

transcript_path = r'C:\Users\iamka\.gemini\antigravity-ide\brain\7714dbe2-8994-494b-bfdd-081045c1f1b0\.system_generated\logs\transcript_full.jsonl'
workspace = r'c:\Users\iamka\Desktop\comiple ide testing 2'

target_files = {
    'astParser.js': os.path.join(workspace, 'src', 'renderer', 'src', 'utils', 'astParser.js'),
    'CodebaseVisualizer.jsx': os.path.join(workspace, 'src', 'renderer', 'src', 'components', 'CodebaseVisualizer.jsx')
}

found_contents = {}

with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            obj = json.loads(line)
            if 'tool_calls' in obj:
                for tc in obj['tool_calls']:
                    # some tool call formats might be nested or named differently, check for substring
                    if 'write_to_file' in tc.get('name', ''):
                        args = tc.get('args', {})
                        target = args.get('TargetFile', '')
                        for k, v in target_files.items():
                            if target.endswith(k) or k in target:
                                found_contents[k] = args.get('CodeContent', '')
        except Exception as e:
            continue

for k, content in found_contents.items():
    if not content:
        continue
    out_path = target_files[k]
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if k == 'astParser.js':
        content = content.replace("import Parser from 'web-tree-sitter'", "import * as TreeSitter from 'web-tree-sitter'\nconst Parser = TreeSitter.default || TreeSitter")
    
    with open(out_path, 'w', encoding='utf-8') as out_f:
        out_f.write(content)
    print(f"Extracted {k}")
