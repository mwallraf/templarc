import { useState, useCallback, useRef, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { sandboxRender, sandboxLint } from '../api/sandbox'
import type { SandboxLintResult } from '../api/sandbox'

// ── Filter toolbox data ───────────────────────────────────────────────────────

interface ToolItem {
  label: string
  insert: string
  desc: string
}

interface ToolSection {
  title: string
  color: string
  items: ToolItem[]
}

const TOOLBOX: ToolSection[] = [
  {
    title: 'Templarc filters',
    color: '#818cf8',
    items: [
      { label: 'mb_to_kbps', insert: '{{ value | mb_to_kbps }}', desc: 'Mbit/s → Kbit/s' },
      { label: 'mb_to_bps', insert: '{{ value | mb_to_bps }}', desc: 'Mbit/s → bit/s' },
      { label: 'b64encode', insert: '{{ value | b64encode }}', desc: 'Base64-encode a string' },
      { label: 'ipaddr(addr)', insert: "{{ cidr | ipaddr('address') }}", desc: 'Extract IP from CIDR' },
      { label: 'ipaddr(mask)', insert: "{{ cidr | ipaddr('netmask') }}", desc: 'Extract netmask' },
      { label: 'ipaddr(N)', insert: "{{ cidr | ipaddr('2') }}", desc: 'Nth host with prefix' },
      { label: 'cidr_to_wildcard', insert: '{{ cidr | cidr_to_wildcard }}', desc: 'CIDR → wildcard mask' },
      { label: 'ip_to_int', insert: '{{ ip | ip_to_int }}', desc: 'IP → integer' },
      { label: 'int_to_ip', insert: '{{ num | int_to_ip }}', desc: 'Integer → IP string' },
    ],
  },
  {
    title: 'String filters',
    color: '#34d399',
    items: [
      { label: 'upper', insert: '{{ value | upper }}', desc: 'Uppercase' },
      { label: 'lower', insert: '{{ value | lower }}', desc: 'Lowercase' },
      { label: 'title', insert: '{{ value | title }}', desc: 'Title Case' },
      { label: 'trim', insert: '{{ value | trim }}', desc: 'Strip whitespace' },
      { label: 'replace', insert: "{{ value | replace('old', 'new') }}", desc: 'Find & replace' },
      { label: 'truncate', insert: '{{ value | truncate(20) }}', desc: 'Truncate to N chars' },
      { label: 'wordwrap', insert: '{{ value | wordwrap(40) }}', desc: 'Wrap at N chars' },
      { label: 'center', insert: '{{ value | center(40) }}', desc: 'Center in N chars' },
      { label: 'indent', insert: '{{ text | indent(4) }}', desc: 'Indent lines by N spaces' },
    ],
  },
  {
    title: 'List & number filters',
    color: '#fbbf24',
    items: [
      { label: 'join', insert: "{{ list | join(', ') }}", desc: 'Join list with separator' },
      { label: 'sort', insert: '{{ list | sort }}', desc: 'Sort a list' },
      { label: 'unique', insert: '{{ list | unique }}', desc: 'Remove duplicates' },
      { label: 'reverse', insert: '{{ list | reverse }}', desc: 'Reverse a list' },
      { label: 'length', insert: '{{ list | length }}', desc: 'Count items' },
      { label: 'first / last', insert: '{{ list | first }}', desc: 'First or last item' },
      { label: 'int', insert: '{{ value | int }}', desc: 'Convert to integer' },
      { label: 'float', insert: '{{ value | float }}', desc: 'Convert to float' },
      { label: 'abs', insert: '{{ value | abs }}', desc: 'Absolute value' },
      { label: 'round', insert: '{{ value | round(2) }}', desc: 'Round to N decimals' },
    ],
  },
  {
    title: 'Control flow',
    color: '#a78bfa',
    items: [
      { label: 'if / elif / else', insert: '{% if condition %}\n\n{% elif other %}\n\n{% else %}\n\n{% endif %}', desc: 'Conditional block' },
      { label: 'for loop', insert: '{% for item in items %}\n{{ item }}\n{% endfor %}', desc: 'Iterate a list' },
      { label: 'for + loop.index', insert: '{% for item in items %}\n{{ loop.index }}. {{ item }}\n{% endfor %}', desc: 'Loop with counter' },
      { label: 'for + else', insert: '{% for item in items %}\n{{ item }}\n{% else %}\n(empty)\n{% endfor %}', desc: 'Loop with empty fallback' },
      { label: 'set variable', insert: '{% set name = value %}', desc: 'Assign a variable' },
      { label: 'namespace', insert: '{% set ns = namespace(count=0) %}\n{% for item in items %}\n{% set ns.count = ns.count + 1 %}\n{% endfor %}\nTotal: {{ ns.count }}', desc: 'Mutable state in loops' },
      { label: 'include', insert: "{% include 'path/to/snippet.j2' %}", desc: 'Include another template' },
      { label: 'macro', insert: '{% macro render_item(name, value) %}\n{{ name }}: {{ value }}\n{% endmacro %}\n{{ render_item("x", 1) }}', desc: 'Define & call a macro' },
      { label: 'block comment', insert: '{# This is a comment #}', desc: 'Jinja2 comment (not rendered)' },
      { label: 'raw block', insert: '{% raw %}\n{{ not rendered }}\n{% endraw %}', desc: 'Escape Jinja2 tags' },
    ],
  },
  {
    title: 'Tests & defaults',
    color: '#f87171',
    items: [
      { label: 'default', insert: "{{ value | default('fallback') }}", desc: 'Fallback if undefined/falsy' },
      { label: 'default (strict)', insert: "{{ value | default('fallback', true) }}", desc: 'Fallback if undefined only' },
      { label: 'is defined', insert: '{% if value is defined %}…{% endif %}', desc: 'Check if variable exists' },
      { label: 'is none', insert: '{% if value is none %}…{% endif %}', desc: 'Null check' },
      { label: 'is number', insert: '{% if value is number %}…{% endif %}', desc: 'Numeric check' },
      { label: 'is string', insert: '{% if value is string %}…{% endif %}', desc: 'String check' },
      { label: 'is iterable', insert: '{% if value is iterable %}…{% endif %}', desc: 'Iterable check' },
    ],
  },
]

const STARTER_TEMPLATE = `{# Jinja2 Sandbox — edit below and press Ctrl+Enter to render #}

{% set interfaces = [
  {"name": "Gi0/0", "ip": "192.168.1.1/24", "desc": "WAN uplink"},
  {"name": "Gi0/1", "ip": "10.0.0.1/30",   "desc": "LAN segment"},
] %}

hostname {{ hostname | default("router-01") }}
!
{% for iface in interfaces %}
interface {{ iface.name }}
  description {{ iface.desc }}
  ip address {{ iface.ip | ipaddr('address') }} {{ iface.ip | ipaddr('netmask') }}
  no shutdown
!
{% endfor %}
`

const STARTER_CONTEXT = `{
  "hostname": "rtr-lon-core-01",
  "site": "London"
}`

// ── Shared style helpers ──────────────────────────────────────────────────────

const inputClass = 'w-full rounded-lg px-3 py-2 text-sm text-slate-100 border transition-colors focus:outline-none'
const inputStyle = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }

// ── Toolbox sidebar ───────────────────────────────────────────────────────────

function Toolbox({ onInsert }: { onInsert: (snippet: string) => void }) {
  const [open, setOpen] = useState<string | null>('Templarc filters')
  const [search, setSearch] = useState('')

  const filtered: ToolSection[] = search.trim()
    ? TOOLBOX.map((sec) => ({
        ...sec,
        items: sec.items.filter(
          (it) =>
            it.label.toLowerCase().includes(search.toLowerCase()) ||
            it.desc.toLowerCase().includes(search.toLowerCase()),
        ),
      })).filter((sec) => sec.items.length > 0)
    : TOOLBOX

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ borderLeft: '1px solid var(--c-border)' }}>
      {/* Toolbox header */}
      <div className="px-3 py-3 border-b shrink-0" style={{ borderColor: 'var(--c-border)' }}>
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-dim)' }}>
          Toolbox
        </p>
        <input
          className={inputClass}
          style={{ ...inputStyle, padding: '4px 10px', fontSize: '11px' }}
          placeholder="Search filters…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((sec) => (
          <div key={sec.title}>
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors"
              style={{ borderBottom: '1px solid var(--c-border)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              onClick={() => setOpen(open === sec.title ? null : sec.title)}
            >
              <span className="text-xs font-semibold" style={{ color: sec.color }}>{sec.title}</span>
              <svg
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className="w-3 h-3 transition-transform"
                style={{ color: 'var(--c-muted-4)', transform: open === sec.title ? 'rotate(180deg)' : 'none' }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {(open === sec.title || search.trim()) && (
              <div className="pb-1">
                {sec.items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => onInsert(item.insert)}
                    className="w-full flex flex-col px-3 py-2 text-left transition-colors"
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <span className="font-mono text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>
                      {item.label}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>{item.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Lint badge ────────────────────────────────────────────────────────────────

function LintBadge({ result }: { result: SandboxLintResult | null }) {
  if (!result) return null
  if (result.ok) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: '#34d399' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Valid
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: '#f87171' }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      {result.error}{result.line ? ` (line ${result.line})` : ''}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Sandbox() {
  const [template, setTemplate] = useState(STARTER_TEMPLATE)
  const [contextRaw, setContextRaw] = useState(STARTER_CONTEXT)
  const [output, setOutput] = useState('')
  const [renderError, setRenderError] = useState<string | null>(null)
  const [lintResult, setLintResult] = useState<SandboxLintResult | null>(null)
  const [rendering, setRendering] = useState(false)
  const [showContext, setShowContext] = useState(true)
  const [showToolbox, setShowToolbox] = useState(true)
  const templateEditorRef = useRef<any>(null)

  // Auto-lint on template change (debounced)
  const lintTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (lintTimeout.current) clearTimeout(lintTimeout.current)
    if (!template.trim()) { setLintResult(null); return }
    lintTimeout.current = setTimeout(async () => {
      try {
        const result = await sandboxLint(template)
        setLintResult(result)
      } catch {
        setLintResult(null)
      }
    }, 600)
    return () => { if (lintTimeout.current) clearTimeout(lintTimeout.current) }
  }, [template])

  const handleRender = useCallback(async () => {
    if (!template.trim() || rendering) return
    setRendering(true)
    setRenderError(null)
    try {
      let ctx: Record<string, unknown> | null = null
      if (contextRaw.trim()) {
        try { ctx = JSON.parse(contextRaw) } catch {
          setRenderError('Context is not valid JSON')
          return
        }
      }
      const result = await sandboxRender({ template, context: ctx })
      if (result.error) {
        setRenderError(result.error)
        setOutput('')
      } else {
        setOutput(result.output)
        setRenderError(null)
      }
    } catch (err: any) {
      setRenderError(err?.response?.data?.detail ?? 'Request failed')
    } finally {
      setRendering(false)
    }
  }, [template, contextRaw, rendering])

  // Ctrl+Enter to render
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleRender()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleRender])

  // Insert snippet at cursor position in Monaco
  const handleInsert = useCallback((snippet: string) => {
    const editor = templateEditorRef.current
    if (!editor) {
      // Fallback: append
      setTemplate((prev) => prev + '\n' + snippet)
      return
    }
    const selection = editor.getSelection()
    editor.executeEdits('toolbox-insert', [{
      range: selection,
      text: snippet,
      forceMoveMarkers: true,
    }])
    editor.focus()
  }, [])

  const handleClearOutput = () => { setOutput(''); setRenderError(null) }

  return (
    <div className="-mx-6 -mt-6" style={{ height: 'calc(100vh - 48px)' }}>
      {/* ── Toolbar ── */}
      <div
        className="flex items-center justify-between px-5 py-2.5 border-b shrink-0"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        <div className="flex items-center gap-4">
          <div>
            <span className="text-sm font-bold text-white font-display">Jinja2 Sandbox</span>
            <span className="ml-2 text-xs" style={{ color: 'var(--c-muted-4)' }}>
              Ctrl+Enter to render
            </span>
          </div>
          <LintBadge result={lintResult} />
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle context */}
          <button
            onClick={() => setShowContext((v) => !v)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
            style={showContext
              ? { backgroundColor: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }
              : { backgroundColor: 'var(--c-elevated)', color: 'var(--c-muted-3)', border: '1px solid var(--c-border)' }
            }
          >
            Context
          </button>
          {/* Toggle toolbox */}
          <button
            onClick={() => setShowToolbox((v) => !v)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
            style={showToolbox
              ? { backgroundColor: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }
              : { backgroundColor: 'var(--c-elevated)', color: 'var(--c-muted-3)', border: '1px solid var(--c-border)' }
            }
          >
            Toolbox
          </button>
          {/* Clear */}
          {(output || renderError) && (
            <button
              onClick={handleClearOutput}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              style={{ backgroundColor: 'var(--c-elevated)', color: 'var(--c-muted-3)', border: '1px solid var(--c-border)' }}
            >
              Clear
            </button>
          )}
          {/* Render button */}
          <button
            onClick={handleRender}
            disabled={rendering}
            className="flex items-center gap-2 px-4 py-1.5 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
          >
            {rendering ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                Rendering…
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Render
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Main workspace ── */}
      <div className="flex overflow-hidden" style={{ height: 'calc(100% - 45px)' }}>

        {/* Left: template editor + context */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Template editor */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {/* Editor label */}
            <div className="flex items-center justify-between px-4 py-1.5 border-b shrink-0"
              style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}>
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--c-muted-4)' }}>
                Template
              </span>
              <span className="text-xs font-mono" style={{ color: 'var(--c-muted-4)' }}>
                {template.split('\n').length} lines
              </span>
            </div>
            <Editor
              height="100%"
              defaultLanguage="html"
              value={template}
              onChange={(v) => setTemplate(v ?? '')}
              theme="vs-dark"
              onMount={(editor) => { templateEditorRef.current = editor }}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'off',
                tabSize: 2,
                folding: true,
                renderLineHighlight: 'gutter',
                automaticLayout: true,
              }}
            />
          </div>

          {/* Context editor (collapsible) */}
          {showContext && (
            <div className="shrink-0 border-t" style={{ borderColor: 'var(--c-border)', height: '180px' }}>
              <div className="flex items-center justify-between px-4 py-1.5 border-b"
                style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}>
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--c-muted-4)' }}>
                  Context <span className="font-normal normal-case ml-1" style={{ color: 'var(--c-muted-4)' }}>· JSON variables injected into the template</span>
                </span>
              </div>
              <Editor
                height="143px"
                defaultLanguage="json"
                value={contextRaw}
                onChange={(v) => setContextRaw(v ?? '')}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: 'off',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  tabSize: 2,
                  automaticLayout: true,
                }}
              />
            </div>
          )}
        </div>

        {/* Center divider + output */}
        <div className="flex flex-col border-l overflow-hidden" style={{ width: '45%', minWidth: 320, borderColor: 'var(--c-border)' }}>
          {/* Output label */}
          <div className="flex items-center justify-between px-4 py-1.5 border-b shrink-0"
            style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--c-muted-4)' }}>
              Output
            </span>
            {output && !renderError && (
              <button
                onClick={() => navigator.clipboard.writeText(output)}
                className="flex items-center gap-1 text-xs transition-colors hover:opacity-80"
                style={{ color: 'var(--c-muted-4)' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                Copy
              </button>
            )}
          </div>

          {/* Output content */}
          <div className="flex-1 overflow-auto p-0">
            {renderError ? (
              <div className="m-3 rounded-lg p-3 border"
                style={{ backgroundColor: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.2)' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: '#f87171' }}>Render error</p>
                <pre className="text-xs font-mono whitespace-pre-wrap" style={{ color: '#fca5a5' }}>{renderError}</pre>
              </div>
            ) : output ? (
              <pre
                className="text-xs font-mono p-4 whitespace-pre leading-relaxed h-full overflow-auto"
                style={{ color: 'var(--c-muted-2)', backgroundColor: 'var(--c-base)' }}
              >
                {output}
              </pre>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 pb-8"
                style={{ color: 'var(--c-muted-4)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-10 h-10 opacity-30">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <p className="text-xs">Press <kbd className="px-1.5 py-0.5 rounded text-xs font-mono"
                  style={{ backgroundColor: 'var(--c-elevated)', border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-3)' }}>
                  Ctrl+Enter
                </kbd> to render</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: toolbox */}
        {showToolbox && (
          <div className="shrink-0 overflow-hidden" style={{ width: '220px', backgroundColor: 'var(--c-surface)' }}>
            <Toolbox onInsert={handleInsert} />
          </div>
        )}
      </div>
    </div>
  )
}
