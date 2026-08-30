import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { PlayCircle, Zap, AlertTriangle, Loader2 } from 'lucide-react'
import { CodePane } from './dsa/CodePane'
import { VisualizationCanvas } from './dsa/VisualizationCanvas'
import { ExplanationPanel } from './dsa/ExplanationPanel'
import { PlaybackControls } from './dsa/PlaybackControls'
import { SampleInputPanel } from './dsa/SampleInputPanel'
import {
  JS_INSTRUMENTATION_PROMPT,
  PY_INSTRUMENTATION_PROMPT,
  CPP_INSTRUMENTATION_PROMPT,
  JAVA_INSTRUMENTATION_PROMPT,
  CPP_INSTRUMENT_SOLUTION_PROMPT,
  JAVA_INSTRUMENT_SOLUTION_PROMPT,
  EXPLANATION_PROMPT,
  SAMPLE_INPUT_PROMPT,
  COMPLEXITY_ANALYSIS_PROMPT,
  detectStructure,
  extractJson
} from './dsa/dsaUtils'
import { buildCppHarness } from './dsa/cppHarness'
import { buildJavaHarness } from './dsa/javaHarness'
import { ArgFields, parseSignatureFor, parseFieldValues } from './dsa/ArgFields'

// ============================================================
// DSA Explainer — full-screen overlay, mirrors the Codebase
// Visualizer's shell exactly (same toolbar variables, button
// treatments, and density). Never introduces new hex colors.
// Pipeline:
//   1. AI instruments the user's snippet (JS / Python / C++ / Java).
//   2. Instrumented code runs in a sandboxed child process (main).
//   3. Captured trace drives the Monaco line highlight + viz canvas.
//   4. A separate AI call turns the trace into per-step narration.
// ============================================================
const MAX_STEPS = 200

export function DSAExplainer({ initialCode, initialLanguage, aiConfig, onClose }) {
  const [language, setLanguage] = useState(initialLanguage || 'javascript')
  const [code, setCode] = useState(initialCode || '')
  // Per-parameter input state (Part 4). Signature-driven UI writes into
  // `argValues` (paramName → raw string). If the signature can't be
  // parsed (JS, or unrecognized shape), fall back to `fallbackJson`,
  // a single raw-JSON textarea. `useFallback` is set by ArgFields.
  const [argValues, setArgValues] = useState({})
  const [fallbackJson, setFallbackJson] = useState('')
  const [useFallback, setUseFallback] = useState(false)
  const [assumedInput, setAssumedInput] = useState(false)

  const [trace, setTrace] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [runStatus, setRunStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const [currentStep, setCurrentStep] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  // ── Run-button lock ───────────────────────────────────────
  // Two-tier lock so re-entry is STRUCTURALLY impossible:
  //   • runningRef.current is a synchronous flag — set true
  //     immediately on click, before any await. Guards against
  //     rapid double-clicks in the same tick before React
  //     re-renders and disables the button.
  //   • isRunning is state — drives disabled attribute, label
  //     swap, spinner, and cursor. Kept in sync with runningRef.
  const runningRef = useRef(false)
  const [isRunning, setIsRunning] = useState(false)

  // Sample-Input bottom dock — open by default on first entry so first-time
  // users see it, collapsible to a slim tab like the integrated terminal.
  const [inputPanelOpen, setInputPanelOpen] = useState(true)
  const [inputPanelHeight, setInputPanelHeight] = useState(160)

  const [explanationSteps, setExplanationSteps] = useState([])
  const [explanationLoading, setExplanationLoading] = useState(false)
  const [runOutput, setRunOutput] = useState('')
  const [complexityData, setComplexityData] = useState(null)

  useEffect(() => { setCurrentStep(0); setIsPlaying(false) }, [trace])

  // ── Language switch ────────────────────────────────────────
  // A trace from one language is meaningless once the compile
  // target changes. Reset everything the previous run produced,
  // BUT keep the code buffer — the user may be about to paste a
  // different-language snippet.
  const prevLanguageRef = useRef(language)
  useEffect(() => {
    if (prevLanguageRef.current === language) return
    prevLanguageRef.current = language
    setTrace([])
    setExplanationSteps([])
    setComplexityData(null)
    setErrorMsg('')
    setRunOutput('')
    setRunStatus('idle')
    setCurrentStep(0)
    setIsPlaying(false)
    setTruncated(false)
    setAssumedInput(false)
    // The old language's signature no longer maps to this pane's code,
    // so wipe per-field state too. Fallback JSON stays useful across
    // languages so we leave it alone.
    setArgValues({})
  }, [language])

  // If the code changes to a new signature, drop stale arg values whose
  // parameter names disappeared — this keeps ArgFields honest.
  useEffect(() => {
    const sig = parseSignatureFor(code, language)
    if (!sig || !sig.params) return
    const names = new Set(sig.params.map(p => p.name))
    setArgValues(prev => {
      const next = {}
      let changed = false
      for (const [k, v] of Object.entries(prev)) {
        if (names.has(k)) next[k] = v
        else changed = true
      }
      return changed ? next : prev
    })
  }, [code, language])

  const activeFrame = trace[currentStep] || null
  const activeLine = activeFrame?.line || 0
  const structure = useMemo(() => detectStructure(code, trace), [code, trace])

  // Subscribes to the inline-ai stream channel for one Promise-shaped call.
  const runAiOnce = useCallback((prompt) => new Promise((resolve, reject) => {
    let buf = ''
    const removeListener = window.api.on('inline-ai-stream-chunk', (chunk) => {
      if (typeof chunk === 'string') buf += chunk
    })
    window.api.sendInlineAiPrompt(prompt, {
      model: aiConfig?.model || 'auto',
      customConfig: aiConfig?.customConfig
    }).then((res) => {
      removeListener?.()
      if (res && res.status === 'error') return reject(new Error(res.error || 'AI error'))
      if (buf.includes('❌ Error:')) {
        const match = buf.match(/❌ Error:\s*(.*)/)
        return reject(new Error(match ? match[1] : 'AI Provider Error'))
      }
      resolve(buf)
    }).catch((err) => {
      removeListener?.()
      reject(err)
    })
  }), [aiConfig])

  const stripFences = (raw) => {
    if (!raw) return ''
    let s = raw.trim()
    const m = s.match(/^```(?:[a-zA-Z0-9+#-]*)?\n([\s\S]*?)\n```$/)
    if (m) s = m[1].trim()
    return s
  }

  // ── Resolve the args array from whichever input mode is active.
  //   Structured mode: use ArgFields signature + argValues (Part 4).
  //   Fallback mode:   parse the raw JSON textarea.
  //   Empty:           return null → caller falls back to AI-inferred.
  const resolveInputArgs = () => {
    if (!useFallback) {
      const sig = parseSignatureFor(code, language)
      if (sig && sig.params && sig.params.length > 0) {
        // If any field is blank, treat the whole thing as "empty" so the
        // AI-inferred-input fallback fires. Users often want to just
        // click Run without filling anything.
        const anyBlank = sig.params.some(p => !(argValues[p.name] || '').trim())
        if (anyBlank) return { ok: 'empty' }
        const parsed = parseFieldValues(sig, argValues, language)
        if (!parsed.ok) return { ok: 'error', error: parsed.error }
        return { ok: 'args', args: parsed.args }
      }
      // No signature → treat as empty and fall back to AI inference.
      return { ok: 'empty' }
    }
    // Fallback textarea path — raw JSON exactly like before.
    const raw = fallbackJson
    if (!raw || !raw.trim()) return { ok: 'empty' }
    try {
      const v = JSON.parse(raw)
      return { ok: 'args', args: Array.isArray(v) ? v : [v] }
    } catch (e) {
      return { ok: 'error', error: 'Fallback JSON parse: ' + e.message }
    }
  }

  const runGenerationRef = useRef(0)

  const handleRun = async () => {
    // ── STRUCTURAL re-entry block. runningRef is set synchronously
    // BEFORE any await, so two clicks that land in the same tick
    // (before React re-renders and disables the button) can never
    // both start a run. This is the primary guard; the disabled
    // attribute is the visible confirmation, not the actual lock.
    if (runningRef.current) return
    runningRef.current = true
    setIsRunning(true)
    const currentGen = ++runGenerationRef.current

    try {
      if (!code.trim()) {
        setErrorMsg('Paste some code first.')
        setRunStatus('error')
        return
      }

      setErrorMsg('')
      setTrace([])
      setExplanationSteps([])
      setComplexityData(null)
      setTruncated(false)
      setAssumedInput(false)

      const resolved = resolveInputArgs()
      let inputArgs
      if (resolved.ok === 'error') {
        setErrorMsg(resolved.error)
        setRunStatus('error')
        return
      }
      if (resolved.ok === 'args') {
        inputArgs = resolved.args
      } else {
        // 'empty' → ask the AI to infer a sample input from the code.
        try {
          setRunStatus('instrumenting')
          const raw = await runAiOnce(SAMPLE_INPUT_PROMPT(code, language))
          if (runGenerationRef.current !== currentGen) return
          const parsed = extractJson(stripFences(raw))
          if (parsed !== null && parsed !== undefined) {
            inputArgs = Array.isArray(parsed) ? parsed : [parsed]
            setAssumedInput(true)
            // Reflect the assumed input into the fields (or the fallback
            // textarea) so the user can see what got used and edit it.
            const sig = parseSignatureFor(code, language)
            if (sig && sig.params && sig.params.length === inputArgs.length && !useFallback) {
              const next = {}
              sig.params.forEach((p, i) => { next[p.name] = JSON.stringify(inputArgs[i]) })
              setArgValues(next)
            } else {
              setFallbackJson(JSON.stringify(inputArgs))
            }
          } else {
            inputArgs = []
            setAssumedInput(true)
          }
        } catch (err) {
          inputArgs = []
          setAssumedInput(true)
          setErrorMsg('Sample input inference failed: ' + err.message)
        }
      }

      setRunStatus('instrumenting')
      let instrumented
      const numberedCode = code.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n')
      try {
        // ── C++ / Java: try deterministic harness generator first ──
        // The harness handles all struct injection + JSON→literal
        // marshaling + main() so the AI's ONLY job is inserting
        // __DSA__ snapshot emissions into the Solution class body.
        let prebuilt = null
        if (language === 'cpp') {
          prebuilt = buildCppHarness(code, inputArgs)
        } else if (language === 'java') {
          prebuilt = buildJavaHarness(code, inputArgs)
        }

        if (prebuilt && prebuilt.ok) {
          // Send ONLY the user's Solution class body to the AI. Splice
          // its reply between our deterministic preamble/suffix so the
          const promptFn = language === 'cpp' ? CPP_INSTRUMENT_SOLUTION_PROMPT : JAVA_INSTRUMENT_SOLUTION_PROMPT
          const rawInstr = await runAiOnce(promptFn(numberedCode))
          if (runGenerationRef.current !== currentGen) return
          const methodBodies = stripFences(rawInstr)
          
          let instrumentedSolution = methodBodies
          if (language === 'cpp') {
            if (!/class\s+Solution\s*\{/.test(instrumentedSolution)) {
              instrumentedSolution = `class Solution {\npublic:\n${instrumentedSolution}\n};`
            }
          } else if (language === 'java') {
            if (!/class\s+Solution\s*\{/.test(instrumentedSolution)) {
              instrumentedSolution = `class Solution {\n${instrumentedSolution}\n}`
            }
          }

          if (language === 'java' && typeof prebuilt.wrapSolution === 'function') {
            // Java splice: wrap the Solution class as an indented static
            // inner class of DsaTrace (strip `public` and indent).
            instrumented = prebuilt.preamble + prebuilt.wrapSolution(instrumentedSolution) + prebuilt.suffix
          } else {
            instrumented = prebuilt.preamble + instrumentedSolution + prebuilt.suffix
          }
        } else if (prebuilt && prebuilt.error) {
          // Deterministic parse said "yes, this is a class Solution but
          // I can't marshal the signature." Fail loud instead of asking
          // the AI to guess a harness for an unsupported type.
          throw new Error(prebuilt.error)
        } else {
          // Plain function (no class Solution) or JS/Python — legacy path:
          // let the AI generate everything including main().
          const prompt = language === 'python' ? PY_INSTRUMENTATION_PROMPT(numberedCode, inputArgs)
            : language === 'cpp' ? CPP_INSTRUMENTATION_PROMPT(numberedCode, inputArgs)
            : language === 'java' ? JAVA_INSTRUMENTATION_PROMPT(numberedCode, inputArgs)
            : JS_INSTRUMENTATION_PROMPT(numberedCode, inputArgs)
          const rawInstr = await runAiOnce(prompt)
          if (runGenerationRef.current !== currentGen) return
          instrumented = stripFences(rawInstr)
        }

        if (!instrumented) throw new Error('AI returned an empty instrumented script')

        // ── Pre-compile safety guard ─────────────────────────────
        // Refuse to send C++/Java to the compiler if the entry point
        // isn't present. This catches: (a) fallback-path AI reply that
        // forgot to include main(), and (b) any future regression where
        // the splice logic silently drops the suffix. Blocking here
        // gives a clean error instead of "undefined reference to WinMain".
        if (language === 'cpp') {
          if (!/\bint\s+main\s*\(/.test(instrumented)) {
            throw new Error("Instrumented C++ source is missing main(). The AI reply likely dropped it. This shouldn't happen — please report if it persists.")
          }
          const solMatches = instrumented.match(/\bclass\s+Solution\b/g)
          if (!solMatches || solMatches.length !== 1) {
            throw new Error("Instrumented C++ source must contain exactly one 'class Solution' declaration. Assembly failed.")
          }
        }
        if (language === 'java' && !/\bpublic\s+static\s+void\s+main\s*\(/.test(instrumented)) {
          throw new Error("Instrumented Java source is missing main(). The AI reply likely dropped it. This shouldn't happen — please report if it persists.")
        }
      } catch (err) {
        setErrorMsg('Instrumentation failed: ' + err.message)
        setRunStatus('error')
        return
      }

      setRunStatus('executing')
      let execResult
      try {
        execResult = await window.api.runInstrumentedCode({ language, code: instrumented })
        if (runGenerationRef.current !== currentGen) return
      } catch (err) {
        setErrorMsg('Sandbox execution failed: ' + err.message)
        setRunStatus('error')
        return
      }

      if (!execResult || !execResult.success) {
        const stage = execResult?.stage
        if (stage === 'compile') {
          const stderr = (execResult.stderr || '').slice(0, 800)
          setErrorMsg(`Compilation failed (${language}). The AI-instrumented source didn't compile:\n${stderr}`)
          setCode(instrumented || 'No instrumented code available')
        } else {
          setErrorMsg('Execution error: ' + (execResult?.error || 'unknown'))
        }
        setRunStatus('error')
        return
      }

      const capturedTrace = (execResult.trace || []).slice(0, MAX_STEPS)
      setTrace(capturedTrace)
      setRunOutput(execResult.stdout || '')
      setTruncated(!!execResult.truncated || (execResult.trace || []).length > MAX_STEPS)

      if (capturedTrace.length === 0) {
        setErrorMsg(execResult.stderr
          ? 'No trace frames captured. Stderr: ' + execResult.stderr.slice(0, 400)
          : 'No trace frames captured. The instrumented script emitted nothing.')
        setRunStatus('error')
        return
      }

      setRunStatus('explaining')
      setExplanationLoading(true)
      try {
        const rawExp = await runAiOnce(EXPLANATION_PROMPT(code, capturedTrace))
        if (runGenerationRef.current !== currentGen) return
        
        const parsedExp = extractJson(stripFences(rawExp))
        if (Array.isArray(parsedExp)) {
          setExplanationSteps(parsedExp.map(s => String(s)))
        } else {
          setExplanationSteps(capturedTrace.map((_, i) => `Step ${i + 1}: (explanation unavailable)`))
        }

        try {
          const rawComp = await runAiOnce(COMPLEXITY_ANALYSIS_PROMPT(code, language))
          if (runGenerationRef.current === currentGen && rawComp) {
            const parsedComp = extractJson(stripFences(rawComp))
            if (parsedComp && parsedComp.timeComplexity) setComplexityData(parsedComp)
          }
        } catch (compErr) {
          // Ignore complexity analysis failure so it doesn't break the run
        }
      } catch (err) {
        setExplanationSteps(capturedTrace.map((_, i) => `Step ${i + 1}: (explanation unavailable)`))
        setErrorMsg('Explanation generation failed: ' + err.message)
      } finally {
        setExplanationLoading(false)
        setRunStatus('done')
      }
    } finally {
      // Lock cleared on EVERY exit path — success, thrown error,
      // early-return validation failure — so the button always
      // returns to its normal state immediately after this Promise
      // settles. Never delayed, never stuck.
      runningRef.current = false
      setIsRunning(false)
    }
  }

  const isBusy = isRunning

  return (
    <div
      className="dsa-explainer-overlay"
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        background: 'var(--bg-deep)', zIndex: 100, display: 'flex', flexDirection: 'column',
        fontFamily: 'Inter, sans-serif',
        cursor: isRunning ? 'progress' : 'auto'
      }}
    >
      <style>{`
        @keyframes dsa-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .dsa-spin { animation: dsa-spin 0.8s linear infinite; }
      `}</style>
      {/* ── Toolbar — same padding + gradient title treatment as Codebase Visualizer ── */}
      <div style={{
        padding: '16px 24px',
        background: 'var(--bg-activity)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border-base)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <PlayCircle color="var(--accent-color)" size={22} />
          <h2 style={{
            margin: 0, fontSize: '18px', fontWeight: '600',
            background: 'linear-gradient(90deg, var(--text-bright), var(--text-muted))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>DSA Explainer</h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Language selector — same input treatment as CV's search bar */}
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={isRunning}
            style={{ ...inputStyle, WebkitAppRegion: 'no-drag' }}
          >
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="cpp">C++</option>
            <option value="java">Java</option>
          </select>

          {/* Primary action — locked strictly by isRunning. onClick
              also early-returns via runningRef so a click firing in
              the same tick as another click can't get through even
              if the disabled attribute hasn't repainted yet. */}
          <button
            onClick={handleRun}
            disabled={isRunning}
            aria-busy={isRunning}
            style={{
              background: 'var(--accent-color)', color: 'var(--accent-text)',
              border: 'none', padding: '6px 14px', borderRadius: '6px',
              cursor: isRunning ? 'wait' : 'pointer',
              fontSize: '12px', fontWeight: '500',
              display: 'flex', alignItems: 'center', gap: '6px',
              opacity: isRunning ? 0.7 : 1, transition: 'opacity 0.2s',
              pointerEvents: isRunning ? 'none' : 'auto',
              WebkitAppRegion: 'no-drag'
            }}
          >
            {isRunning ? (
              <>
                <Loader2 size={13} className="dsa-spin" />
                Running…
              </>
            ) : (
              <>
                <Zap size={13} />
                Run &amp; Explain
              </>
            )}
          </button>

          <PlaybackControls
            currentStep={currentStep}
            totalSteps={trace.length}
            isPlaying={isPlaying}
            onSetStep={(v) => setCurrentStep(typeof v === 'function' ? v(currentStep) : v)}
            onPlayPause={setIsPlaying}
            disabled={runStatus !== 'done' && trace.length === 0}
          />

          {/* Close — identical to CV's "Close Diagram" */}
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-primary)',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
              transition: 'background 0.2s',
              WebkitAppRegion: 'no-drag'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
          >
            Close Explainer
          </button>
        </div>
      </div>

      {/* Small muted hint strip — disclaimer + status all in one row */}
      <div style={{
        padding: '6px 24px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-base)',
        display: 'flex', alignItems: 'center', gap: '16px',
        fontSize: '11px', color: 'var(--text-muted)', flexWrap: 'wrap',
        minHeight: '26px'
      }}>
        <span style={{ opacity: 0.75 }}>
          AI-generated explanation — verify against your own understanding.
        </span>
        {runStatus === 'instrumenting' && <span>· Instrumenting code…</span>}
        {runStatus === 'executing' && <span>· Executing in sandbox…</span>}
        {runStatus === 'explaining' && <span>· Generating explanation…</span>}
        {truncated && (
          <span>· Trace truncated at {MAX_STEPS} steps — try a smaller input to see the full run.</span>
        )}
        {runStatus === 'error' && errorMsg && (
          <span style={{ color: 'var(--accent-rose, #ef4444)', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'pre-wrap' }}>
            <AlertTriangle size={12} /> {errorMsg}
          </span>
        )}
      </div>

      {/* Main split — takes all remaining space above the dock */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--border-base)' }}>
          <CodePane
            code={code}
            language={language}
            activeLine={activeLine}
            onCodeChange={(v) => setCode(v || '')}
            editable={!isBusy}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, background: 'var(--bg-surface)' }}>
            <VisualizationCanvas structure={structure} frame={activeFrame} allFrames={trace} />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ExplanationPanel
              steps={explanationSteps}
              currentStep={currentStep}
              loading={explanationLoading}
              runOutput={runOutput}
              complexityData={complexityData}
            />
          </div>
        </div>
      </div>

      {/* Bottom Sample-Input dock — same chrome as the integrated terminal.
          Body is now per-parameter fields (ArgFields) when we can parse the
          signature; otherwise a fallback JSON textarea. */}
      <SampleInputPanel
        hint={useFallback ? 'Raw JSON — no signature detected' : `Signature: ${language.toUpperCase()}`}
        assumedNote={assumedInput ? 'Assumed input (AI-generated)' : null}
        isOpen={inputPanelOpen}
        onToggle={setInputPanelOpen}
        height={inputPanelHeight}
        onResize={setInputPanelHeight}
        collapsedPreview={
          useFallback
            ? fallbackJson
            : Object.entries(argValues).map(([k, v]) => `${k}=${v}`).join(', ')
        }
      >
        <ArgFields
          language={language}
          code={code}
          values={argValues}
          runOutput={runOutput}
          onChange={(name, v) => { setArgValues(prev => ({ ...prev, [name]: v })); setAssumedInput(false) }}
          onFallback={setUseFallback}
          fallbackText={fallbackJson}
          onFallbackTextChange={(v) => { setFallbackJson(v); setAssumedInput(false) }}
        />
      </SampleInputPanel>
    </div>
  )
}

// Same shape as CV's "Find file..." input.
const inputStyle = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border-base)',
  color: 'var(--text-primary)',
  padding: '6px 12px',
  borderRadius: '6px',
  fontSize: '13px',
  outline: 'none'
}
