/**
 * ApiCodePanel — a subtle </> icon button that expands into an inline
 * code panel showing curl and Python API examples.
 *
 * Usage:
 *   <ApiCodePanel examples={[
 *     { lang: 'curl', code: curlString },
 *     { lang: 'python', code: pythonString },
 *   ]} />
 */

import { useState } from 'react'

// ---------------------------------------------------------------------------
// Resolve the API base URL for example commands. Uses VITE_API_URL if set,
// otherwise falls back to the current origin + /api (the Vite dev proxy path).
// ---------------------------------------------------------------------------
export function getApiBase(): string {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined
  if (envUrl) return envUrl
  return `${window.location.origin}/api`
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApiCodeLang = 'curl' | 'python'

export interface ApiCodeExample {
  lang: ApiCodeLang
  code: string
}

interface ApiCodePanelProps {
  examples: ApiCodeExample[]
}

const LANG_LABEL: Record<ApiCodeLang, string> = {
  curl: 'curl',
  python: 'Python',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ApiCodePanel({ examples }: ApiCodePanelProps) {
  const [open, setOpen] = useState(false)
  const [activeLang, setActiveLang] = useState<ApiCodeLang>(examples[0]?.lang ?? 'curl')
  const [copied, setCopied] = useState(false)

  const active = examples.find((e) => e.lang === activeLang) ?? examples[0]

  function copy() {
    if (!active) return
    navigator.clipboard.writeText(active.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="inline-block">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="API usage example"
        className="flex items-center gap-1 px-2 py-1 rounded-md font-mono text-xs transition-colors"
        style={{
          color: open ? '#818cf8' : 'var(--c-muted-4)',
          backgroundColor: open ? 'rgba(99,102,241,0.1)' : 'transparent',
          border: `1px solid ${open ? 'rgba(99,102,241,0.3)' : 'var(--c-border)'}`,
        }}
        onMouseEnter={(e) => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-3)'
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border-bright)'
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-4)'
            ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)'
          }
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
        <span>API</span>
      </button>

      {/* Inline panel */}
      {open && (
        <div
          className="mt-2 rounded-xl border overflow-hidden"
          style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}
        >
          {/* Tab bar + copy */}
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface)' }}
          >
            <div className="flex gap-1">
              {examples.map((ex) => (
                <button
                  key={ex.lang}
                  onClick={() => setActiveLang(ex.lang)}
                  className="px-2.5 py-1 rounded text-xs font-mono transition-colors"
                  style={
                    activeLang === ex.lang
                      ? { backgroundColor: 'rgba(99,102,241,0.2)', color: '#818cf8' }
                      : { color: 'var(--c-muted-4)' }
                  }
                >
                  {LANG_LABEL[ex.lang]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--c-border-bright)' }}>
                Replace <code className="font-mono" style={{ color: 'var(--c-muted-4)' }}>$TOKEN</code> with your JWT
              </span>
              <button
                onClick={copy}
                className="text-xs px-2.5 py-1 rounded-md border transition-colors"
                style={
                  copied
                    ? { color: '#34d399', borderColor: 'rgba(52,211,153,0.3)' }
                    : { color: 'var(--c-muted-3)', borderColor: 'var(--c-border-bright)' }
                }
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Code */}
          {active && (
            <pre
              className="text-xs font-mono p-4 overflow-x-auto leading-relaxed"
              style={{ color: 'var(--c-muted-1)', backgroundColor: 'var(--c-base)', maxHeight: '320px' }}
            >
              {active.code}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
