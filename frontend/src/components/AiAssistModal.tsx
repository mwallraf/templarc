/**
 * AiAssistModal — AI-powered Jinja2 template body generator.
 *
 * Props:
 *   registeredParams  — parameter names already registered for the context
 *   customFilters     — custom filter names available in the project
 *   existingBody      — current editor content (for "improve this" mode)
 *   onAccept(text, mode) — called when user clicks Insert / Replace / Append
 *   onClose           — called on Cancel or ESC
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { streamAIGenerate } from '../api/ai'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract {{ variable }} references from Jinja2 text. */
function extractParams(body: string): string[] {
  const seen = new Set<string>()
  const re = /\{\{\s*([\w.]+)\s*(?:\|[^}]*)?\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const name = m[1].trim()
    if (!['loop', 'range', 'true', 'false', 'none', 'namespace', 'joiner', 'cycler'].includes(name)) {
      seen.add(name)
    }
  }
  return Array.from(seen)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type InsertMode = 'cursor' | 'replace' | 'append'

interface AiAssistModalProps {
  registeredParams?: string[]
  customFilters?: string[]
  existingBody?: string
  onAccept: (text: string, mode: InsertMode) => void
  onClose: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AiAssistModal({
  registeredParams = [],
  customFilters = [],
  existingBody,
  onAccept,
  onClose,
}: AiAssistModalProps) {
  const [prompt, setPrompt] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLPreElement>(null)

  // ESC to close (only when not streaming)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && status !== 'streaming') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, status])

  // Auto-scroll output as tokens arrive
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || status === 'streaming') return
    setOutput('')
    setErrorMsg('')
    setStatus('streaming')

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      for await (const chunk of streamAIGenerate(
        {
          prompt: prompt.trim(),
          registered_params: registeredParams,
          custom_filters: customFilters,
          existing_body: existingBody || undefined,
        },
        ctrl.signal,
      )) {
        setOutput((prev) => prev + chunk)
      }
      setStatus('done')
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus('done') // user cancelled — keep partial output
      } else {
        setErrorMsg((err as Error).message ?? 'Generation failed')
        setStatus('error')
      }
    }
  }, [prompt, status, registeredParams, customFilters, existingBody])

  function handleStop() {
    abortRef.current?.abort()
  }

  // Detect params in generated output that aren't yet registered
  const newParams =
    status === 'done'
      ? extractParams(output).filter((p) => !registeredParams.includes(p))
      : []

  const hasOutput = output.length > 0
  const isImproveMode = !!existingBody?.trim()

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget && status !== 'streaming') onClose() }}
    >
      <div
        className="w-full max-w-2xl flex flex-col rounded-2xl border overflow-hidden"
        style={{
          backgroundColor: 'var(--c-surface)',
          borderColor: 'var(--c-border)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
          maxHeight: 'calc(100vh - 2rem)',
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3 px-5 py-3.5 border-b shrink-0"
          style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}
        >
          {/* Spark icon */}
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 0 14px rgba(99,102,241,0.4)' }}
          >
            <svg viewBox="0 0 24 24" fill="white" className="w-3.5 h-3.5">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>
              AI Template Assistant
            </h2>
            <p className="text-xs" style={{ color: 'var(--c-muted-4)' }}>
              {isImproveMode ? 'Improve or extend the current template body' : 'Describe what you need — get Jinja2 back'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={status === 'streaming'}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-lg leading-none disabled:opacity-40 transition-colors"
            style={{ color: 'var(--c-muted-3)' }}
            onMouseEnter={(e) => { if (status !== 'streaming') (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-1)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-3)' }}
          >
            ×
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">

          {/* Context pills */}
          {(registeredParams.length > 0 || customFilters.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {registeredParams.slice(0, 8).map((p) => (
                <span
                  key={p}
                  className="text-xs font-mono px-2 py-0.5 rounded-full border"
                  style={{ backgroundColor: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.2)', color: '#a5b4fc' }}
                >
                  {p}
                </span>
              ))}
              {registeredParams.length > 8 && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: 'var(--c-muted-4)' }}>
                  +{registeredParams.length - 8} more params
                </span>
              )}
            </div>
          )}

          {/* Prompt input */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-3)' }}>
              {isImproveMode ? 'What should change or be added?' : 'What should this template do?'}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate() }}
              placeholder={
                isImproveMode
                  ? 'e.g. "Add BFD timers to the OSPF section" or "Replace the static community with snmp.community parameter"'
                  : 'e.g. "Configure OSPF area 0 with MD5 authentication and BFD timers. Use a loop for multiple neighbors."'
              }
              rows={3}
              disabled={status === 'streaming'}
              className="w-full rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 border resize-none disabled:opacity-60"
              style={{ backgroundColor: 'var(--c-base)', borderColor: 'var(--c-border-bright)', color: 'var(--c-text)' }}
              autoFocus
            />
            <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
              Tip: the AI already knows your registered parameters and custom filters. ⌘↵ to generate.
            </p>
          </div>

          {/* Output area */}
          {(hasOutput || status === 'streaming') && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium" style={{ color: 'var(--c-muted-3)' }}>
                  Generated output
                  {status === 'streaming' && (
                    <span className="ml-2 inline-flex items-center gap-1" style={{ color: '#818cf8' }}>
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ backgroundColor: '#818cf8' }}
                      />
                      streaming…
                    </span>
                  )}
                </label>
                {hasOutput && (
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(output)}
                    className="text-xs transition-colors"
                    style={{ color: 'var(--c-muted-4)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-2)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-4)' }}
                  >
                    Copy
                  </button>
                )}
              </div>
              <pre
                ref={outputRef}
                className="w-full rounded-xl px-4 py-3 text-xs font-mono overflow-auto border"
                style={{
                  backgroundColor: 'var(--c-base)',
                  borderColor: 'var(--c-border)',
                  color: 'var(--c-muted-1)',
                  maxHeight: '280px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {output}
                {status === 'streaming' && (
                  <span
                    className="inline-block w-0.5 h-3.5 ml-0.5 align-text-bottom animate-pulse"
                    style={{ backgroundColor: '#818cf8' }}
                  />
                )}
              </pre>
            </div>
          )}

          {/* New params warning */}
          {newParams.length > 0 && (
            <div
              className="rounded-xl px-4 py-3 text-xs border"
              style={{ backgroundColor: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.2)' }}
            >
              <p className="font-semibold mb-1.5" style={{ color: '#fbbf24' }}>
                {newParams.length} new parameter{newParams.length > 1 ? 's' : ''} introduced
              </p>
              <div className="flex flex-wrap gap-1.5">
                {newParams.map((p) => (
                  <span
                    key={p}
                    className="font-mono px-2 py-0.5 rounded-full border"
                    style={{ backgroundColor: 'rgba(251,191,36,0.08)', borderColor: 'rgba(251,191,36,0.25)', color: '#fde68a' }}
                  >
                    {p}
                  </span>
                ))}
              </div>
              <p className="mt-1.5" style={{ color: 'var(--c-muted-4)' }}>
                Register these in the Parameters tab after inserting so the render form shows input fields for them.
              </p>
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div
              className="rounded-xl px-4 py-3 text-xs border"
              style={{ backgroundColor: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.2)', color: '#fca5a5' }}
            >
              {errorMsg}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div
          className="shrink-0 flex items-center justify-between gap-3 px-5 py-3.5 border-t"
          style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}
        >
          {/* Left: cancel / stop */}
          <div className="flex gap-2">
            {status === 'streaming' ? (
              <button
                onClick={handleStop}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                style={{ borderColor: '#f87171', color: '#f87171', backgroundColor: 'rgba(239,68,68,0.08)' }}
              >
                Stop
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-3)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-1)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-3)' }}
              >
                Cancel
              </button>
            )}
          </div>

          {/* Right: generate + insert actions */}
          <div className="flex gap-2">
            {/* Generate / Regenerate */}
            {status !== 'streaming' && (
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-all"
                style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7)', boxShadow: hasOutput ? 'none' : '0 4px 14px rgba(99,102,241,0.35)' }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                {hasOutput ? 'Regenerate' : 'Generate'}
              </button>
            )}

            {/* Insert actions — shown only when there's output and not streaming */}
            {hasOutput && status !== 'streaming' && (
              <>
                {existingBody && (
                  <button
                    onClick={() => onAccept(output, 'cursor')}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{ backgroundColor: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(99,102,241,0.2)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(99,102,241,0.12)' }}
                  >
                    Insert at cursor
                  </button>
                )}
                <button
                  onClick={() => onAccept(output, 'replace')}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-all"
                  style={{ backgroundColor: '#6366f1', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#4f46e5' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#6366f1' }}
                >
                  {existingBody ? 'Replace body' : 'Use this'}
                </button>
                {existingBody && (
                  <button
                    onClick={() => onAccept(output, 'append')}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{ backgroundColor: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(99,102,241,0.2)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(99,102,241,0.12)' }}
                  >
                    Append
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
