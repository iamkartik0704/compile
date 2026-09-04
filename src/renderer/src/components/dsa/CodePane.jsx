import React, { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'

// Read-only Monaco pane that highlights the CURRENT step's line via a
// decoration collection. The decoration is refreshed on every activeLine
// change so the highlight tracks playback frame-by-frame.
export function CodePane({ code, language, activeLine, onCodeChange, editable }) {
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const decorationsRef = useRef(null)
  const [contextMenu, setContextMenu] = useState(null)

  const monacoLang =
    language === 'python' ? 'python' :
    language === 'cpp' ? 'cpp' :
    language === 'java' ? 'java' :
    'javascript'

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    decorationsRef.current = editor.createDecorationsCollection([])
    applyDecoration(activeLine)

    // ── Clipboard workaround ────────────────────────────────
    // Electron's native paste is broken in this app's Chromium/
    // context config (see CodeEditor.jsx:1377 for the same
    // fallback). Register custom Monaco actions with Ctrl+V/C/X
    // that manually go through navigator.clipboard. Monaco's
    // keybinding registry captures the shortcut on its inputarea
    // BEFORE Chromium's default paste path runs, so this fires
    // whether or not the Electron menu accelerator is wired up.
    const KM = monaco.KeyMod
    const KC = monaco.KeyCode

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, async () => {
      if (!editable) return
      try {
        let text = ''
        if (window.api && window.api.readClipboardText) {
          const res = await window.api.readClipboardText()
          text = res?.success ? res.text : (typeof res === 'string' ? res : '')
        } else {
          text = await navigator.clipboard.readText()
        }
        if (!text) return
        const sel = editorRef.current.getSelection()
        editorRef.current.executeEdits('dsa-paste', [{ range: sel, text, forceMoveMarkers: true }])
      } catch (err) {
        console.error('[DSA] paste failed:', err)
      }
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, async () => {
      const sel = editorRef.current.getSelection()
      const text = editorRef.current.getModel().getValueInRange(sel)
      if (text) {
        if (window.api && window.api.writeClipboardText) {
          await window.api.writeClipboardText(text)
        } else {
          navigator.clipboard.writeText(text).catch(() => {})
        }
      }
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, async () => {
      if (!editable) return
      const sel = editorRef.current.getSelection()
      const text = editorRef.current.getModel().getValueInRange(sel)
      if (text) {
        if (window.api && window.api.writeClipboardText) {
          await window.api.writeClipboardText(text)
        } else {
          navigator.clipboard.writeText(text).catch(() => {})
        }
        editorRef.current.executeEdits('dsa-cut', [{ range: sel, text: '', forceMoveMarkers: true }])
      }
    })

    // Ctrl+A — Monaco's own selectAll usually works, but Electron
    // menu absence has been known to break it too. Cheap to register.
    editor.addAction({
      id: 'dsa.selectAll',
      label: 'Select All (DSA)',
      keybindings: [KM.CtrlCmd | KC.KeyA],
      run: (ed) => {
        const model = ed.getModel()
        if (!model) return
        const lineCount = model.getLineCount()
        const lastCol = model.getLineMaxColumn(lineCount)
        ed.setSelection(new monaco.Range(1, 1, lineCount, lastCol))
      }
    })

    // When mounted editable AND empty, pull focus into the pane so the
    // user can immediately paste (Ctrl+V) or type without a click.
    if (editable && (!code || code.trim().length === 0)) {
      setTimeout(() => editor.focus(), 0)
    }

    editor.onContextMenu((e) => {
      if (!editable) return
      e.event.preventDefault()
      setContextMenu({
        x: e.event.posx,
        y: e.event.posy,
        editor: editor
      })
    })
  }

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null)
    window.addEventListener('click', closeContextMenu)
    return () => window.removeEventListener('click', closeContextMenu)
  }, [])

  const applyDecoration = (line) => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const decorations = decorationsRef.current
    if (!editor || !monaco || !decorations) return

    if (!line || line < 1) {
      decorations.set([])
      return
    }

    decorations.set([
      {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'dsa-active-line',
          glyphMarginClassName: 'dsa-active-glyph',
          overviewRuler: {
            color: 'var(--accent-color)',
            position: monaco.editor.OverviewRulerLane.Full
          }
        }
      }
    ])

    // Keep the active line visible without stealing focus
    editor.revealLineInCenterIfOutsideViewport(line)
  }

  useEffect(() => {
    applyDecoration(activeLine)
  }, [activeLine])

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)' }}>
      <style>{`
        .dsa-active-line {
          background: var(--bg-elevated);
          box-shadow: inset 3px 0 0 var(--accent-color);
        }
        .dsa-active-glyph {
          background: var(--accent-color);
          width: 3px !important;
          margin-left: 3px;
        }
      `}</style>
      <Editor
        height="100%"
        language={monacoLang}
        value={code}
        theme="vs-dark"
        onChange={editable ? onCodeChange : undefined}
        onMount={handleMount}
        options={{
          readOnly: !editable,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          renderLineHighlight: 'none',
          glyphMargin: true,
          wordWrap: 'on',
          automaticLayout: true,
          // Monaco's own right-click menu is disabled because we use our own overlay
          // to fix Electron clipboard issues.
          contextmenu: false
        }}
      />
      
      {contextMenu && (
        <div 
          className="editor-context-menu" 
          style={{ left: contextMenu.x, top: contextMenu.y, position: 'fixed', zIndex: 1000 }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <div className="editor-context-menu-item" onClick={() => {
            const ed = contextMenu.editor
            const selection = ed.getSelection()
            if (selection && !selection.isEmpty()) {
              const text = ed.getModel().getValueInRange(selection)
              if (window.api && window.api.writeClipboardText) {
                window.api.writeClipboardText(text).then(() => {
                  ed.executeEdits("context-menu", [{ range: selection, text: "", forceMoveMarkers: true }])
                })
              } else {
                navigator.clipboard.writeText(text).then(() => {
                  ed.executeEdits("context-menu", [{ range: selection, text: "", forceMoveMarkers: true }])
                })
              }
            }
            setContextMenu(null)
          }}>Cut</div>
          <div className="editor-context-menu-item" onClick={() => {
            const ed = contextMenu.editor
            const selection = ed.getSelection()
            if (selection && !selection.isEmpty()) {
              const text = ed.getModel().getValueInRange(selection)
              if (window.api && window.api.writeClipboardText) {
                window.api.writeClipboardText(text)
              } else {
                navigator.clipboard.writeText(text)
              }
            }
            setContextMenu(null)
          }}>Copy</div>
          <div className="editor-context-menu-item" onClick={async () => {
            const ed = contextMenu.editor
            try {
              let text = ''
              if (window.api && window.api.readClipboardText) {
                const res = await window.api.readClipboardText()
                text = res?.success ? res.text : (typeof res === 'string' ? res : '')
              } else {
                text = await navigator.clipboard.readText()
              }
              if (text) {
                const position = ed.getPosition()
                ed.executeEdits("context-menu", [{
                  range: new monacoRef.current.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                  text: text,
                  forceMoveMarkers: true
                }])
              }
            } catch (err) {
              console.error('Failed to read clipboard contents: ', err)
            }
            setContextMenu(null)
          }}>Paste</div>
          <div className="editor-context-menu-separator"></div>
          <div className="editor-context-menu-item" onClick={() => {
            contextMenu.editor.getAction('editor.action.formatDocument').run()
            setContextMenu(null)
          }}>Format Document</div>
          <div className="editor-context-menu-item" onClick={() => {
            contextMenu.editor.focus()
            contextMenu.editor.trigger('anyString', 'editor.action.quickCommand')
            setContextMenu(null)
          }}>Command Palette</div>
        </div>
      )}
    </div>
  )
}
