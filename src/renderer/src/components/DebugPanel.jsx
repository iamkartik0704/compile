import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Play,
  Square,
  RotateCcw,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Pause,
  Bug,
  Plus,
  Trash2,
  XCircle
} from 'lucide-react'
import { useAppStore } from '../store/appStore'

export default function DebugPanel() {
  const { activeTheme } = useAppStore()
  const isLight = activeTheme === 'light-modern'

  const [isDebugging, setIsDebugging] = useState(false)
  const [activeSection, setActiveSection] = useState({
    variables: true,
    watch: true,
    callStack: true,
    breakpoints: true
  })

  const toggleSection = (section) => {
    setActiveSection(prev => ({ ...prev, [section]: !prev[section] }))
  }

  // Mock Data
  const variables = [
    { name: 'locals', type: 'object', value: '{...}', expandable: true },
    { name: '  i', type: 'number', value: '42' },
    { name: '  user', type: 'object', value: '{ name: "kartik", auth: true }' },
    { name: 'globals', type: 'object', value: 'Window', expandable: true }
  ]

  const callStack = [
    { function: 'renderUser', file: 'App.jsx', line: 42, active: true },
    { function: 'main', file: 'index.js', line: 12 },
    { function: 'anonymous', file: 'bundle.js', line: 1045 }
  ]

  const breakpoints = [
    { file: 'App.jsx', line: 42, enabled: true },
    { file: 'utils.js', line: 15, enabled: false }
  ]

  const themeClasses = isLight
    ? 'bg-[#f3f3f3] text-[#333333] border-[#cccccc]'
    : 'bg-[#1e1e1e] text-[#cccccc] border-[#333333]'

  const headerClass = isLight
    ? 'bg-[#e5e5e5] hover:bg-[#d4d4d4] text-[#333333]'
    : 'bg-[#252526] hover:bg-[#2a2d2e] text-[#cccccc]'

  const buttonClass = isLight
    ? 'hover:bg-[#e0e0e0] text-[#424242]'
    : 'hover:bg-[#333333] text-[#cccccc]'

  return (
    <div className={`flex flex-col h-full w-full select-none ${themeClasses} overflow-hidden font-sans text-sm`}>
      <div className="px-4 py-2 uppercase text-xs font-semibold tracking-wider flex justify-between items-center shrink-0">
        <span>Run and Debug</span>
      </div>

      {!isDebugging ? (
        <div className="p-4 flex flex-col items-center justify-center h-full text-center opacity-70">
          <Bug size={48} className="mb-4 opacity-50" />
          <p className="mb-4 text-xs">Open a file and click below to start a mock debugging session.</p>
          <button
            onClick={() => setIsDebugging(true)}
            className="px-4 py-1.5 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-xs font-medium flex items-center gap-2 transition-colors"
          >
            <Play size={14} fill="currentColor" />
            Run and Debug
          </button>
        </div>
      ) : (
        <div className="flex flex-col h-full overflow-y-auto">
          {/* Debug Toolbar Mock */}
          <div className="flex items-center justify-center gap-1 p-1 mb-2 mx-4 rounded-md shadow-sm border border-[#333] bg-[#2d2d2d]">
            <button className={`p-1 rounded ${buttonClass}`} title="Pause"><Pause size={16} fill="currentColor" className="text-[#cccccc]"/></button>
            <button className={`p-1 rounded ${buttonClass}`} title="Step Over"><ArrowRight size={16} className="text-[#0e639c]" /></button>
            <button className={`p-1 rounded ${buttonClass}`} title="Step Into"><ArrowDown size={16} className="text-[#0e639c]" /></button>
            <button className={`p-1 rounded ${buttonClass}`} title="Step Out"><ArrowUp size={16} className="text-[#0e639c]" /></button>
            <button className={`p-1 rounded ${buttonClass}`} title="Restart"><RotateCcw size={16} className="text-[#4caf50]" /></button>
            <button onClick={() => setIsDebugging(false)} className={`p-1 rounded ${buttonClass}`} title="Stop"><Square size={16} fill="currentColor" className="text-[#f44336]" /></button>
          </div>

          {/* Variables Section */}
          <div className="flex flex-col border-t border-inherit">
            <div
              className={`flex items-center px-1 py-1 cursor-pointer font-medium text-xs font-semibold ${headerClass}`}
              onClick={() => toggleSection('variables')}
            >
              {activeSection.variables ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="ml-1 uppercase">Variables</span>
            </div>
            {activeSection.variables && (
              <div className="flex flex-col py-1 text-[13px] font-mono">
                {variables.map((v, i) => (
                  <div key={i} className="flex items-center px-6 py-0.5 hover:bg-[#2a2d2e] cursor-pointer">
                    {v.expandable && <ChevronRight size={12} className="mr-1 -ml-3" />}
                    <span className="text-[#9cdcfe]">{v.name}</span>
                    <span className="mx-1 text-[#d4d4d4]">:</span>
                    <span className={v.type === 'number' ? 'text-[#b5cea8]' : 'text-[#ce9178]'}>{v.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Watch Section */}
          <div className="flex flex-col border-t border-inherit">
            <div
              className={`flex items-center justify-between px-1 py-1 cursor-pointer font-medium text-xs font-semibold ${headerClass}`}
              onClick={() => toggleSection('watch')}
            >
              <div className="flex items-center">
                {activeSection.watch ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className="ml-1 uppercase">Watch</span>
              </div>
              <Plus size={14} className="mr-2 opacity-60 hover:opacity-100" />
            </div>
            {activeSection.watch && (
              <div className="px-6 py-2 text-xs italic opacity-50">
                No expressions to watch
              </div>
            )}
          </div>

          {/* Call Stack Section */}
          <div className="flex flex-col border-t border-inherit">
            <div
              className={`flex items-center px-1 py-1 cursor-pointer font-medium text-xs font-semibold ${headerClass}`}
              onClick={() => toggleSection('callStack')}
            >
              {activeSection.callStack ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="ml-1 uppercase">Call Stack</span>
            </div>
            {activeSection.callStack && (
              <div className="flex flex-col py-1 text-[13px]">
                <div className="px-4 py-0.5 opacity-60 uppercase text-[10px] font-semibold tracking-wide">
                  Thread 1 (Paused on Breakpoint)
                </div>
                {callStack.map((frame, i) => (
                  <div key={i} className={`flex items-center px-4 py-1 cursor-pointer ${frame.active ? 'bg-[#37373d]' : 'hover:bg-[#2a2d2e]'}`}>
                    <div className="flex flex-col">
                      <span className="text-[#dcdcaa] font-mono">{frame.function}</span>
                      <span className="text-[11px] opacity-60">{frame.file}:{frame.line}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Breakpoints Section */}
          <div className="flex flex-col border-t border-b border-inherit">
            <div
              className={`flex items-center justify-between px-1 py-1 cursor-pointer font-medium text-xs font-semibold ${headerClass}`}
              onClick={() => toggleSection('breakpoints')}
            >
              <div className="flex items-center">
                {activeSection.breakpoints ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className="ml-1 uppercase">Breakpoints</span>
              </div>
              <div className="flex gap-1 mr-2">
                <Trash2 size={14} className="opacity-60 hover:opacity-100" />
              </div>
            </div>
            {activeSection.breakpoints && (
              <div className="flex flex-col py-1 text-[13px]">
                {breakpoints.map((bp, i) => (
                  <div key={i} className="flex items-center px-4 py-1 hover:bg-[#2a2d2e] cursor-pointer">
                    <input type="checkbox" checked={bp.enabled} readOnly className="mr-2 accent-[#0e639c]" />
                    <XCircle size={14} className="text-[#f44336] mr-2" fill="currentColor"/>
                    <span className="font-mono flex-1">{bp.file}</span>
                    <span className="opacity-60 text-xs">line {bp.line}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
