import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getRenderHistory, reRender } from '../api/render'
import { getTemplate, listTemplates, getInheritanceChain } from '../api/templates'
import type { RenderOut } from '../api/types'
import ApiCodePanel, { getApiBase } from '../components/ApiCodePanel'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'long',
    timeStyle: 'medium',
  })
}

function inferScope(name: string): 'Global' | 'Project' | 'Template' {
  if (name.startsWith('glob.')) return 'Global'
  if (name.startsWith('proj.')) return 'Project'
  return 'Template'
}

const SCOPE_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  Global: { bg: 'rgba(251,191,36,0.1)', text: '#fbbf24', border: 'rgba(251,191,36,0.2)' },
  Project: { bg: 'rgba(96,165,250,0.1)', text: '#60a5fa', border: 'rgba(96,165,250,0.2)' },
  Template: { bg: 'rgba(148,163,184,0.08)', text: '#64748b', border: 'rgba(148,163,184,0.15)' },
}

function sortParams(entries: [string, unknown][]): [string, unknown][] {
  const order = { Global: 0, Project: 1, Template: 2 }
  return [...entries].sort((a, b) => {
    const sa = order[inferScope(a[0])]
    const sb = order[inferScope(b[0])]
    if (sa !== sb) return sa - sb
    return a[0].localeCompare(b[0])
  })
}

// ── Collapsible section ────────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string
  badge?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors"
        style={{ backgroundColor: open ? 'var(--c-surface-alt)' : undefined }}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-slate-200">{title}</span>
          {badge && (
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--c-card)', color: 'var(--c-muted-3)', border: '1px solid var(--c-border-bright)' }}
            >
              {badge}
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>{open ? '▲ collapse' : '▼ expand'}</span>
      </button>
      {open && <div className="border-t" style={{ borderColor: 'var(--c-border)' }}>{children}</div>}
    </div>
  )
}

// ── Output block ──────────────────────────────────────────────────────────────

function OutputBlock({ output, label = 'Output' }: { output: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <CollapsibleSection title={label} defaultOpen>
      <div className="flex justify-end px-4 py-2 border-b" style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface-alt)' }}>
        <button
          onClick={copy}
          className="text-xs px-3 py-1 rounded-lg border transition-all"
          style={{ color: 'var(--c-muted-3)', borderColor: 'var(--c-border-bright)' }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre
        className="p-4 text-xs code-block overflow-x-auto whitespace-pre leading-relaxed overflow-y-auto"
        style={{ backgroundColor: 'var(--c-base)', color: '#a5f3c8', maxHeight: '500px' }}
      >
        {output}
      </pre>
    </CollapsibleSection>
  )
}

// ── Parameters table ──────────────────────────────────────────────────────────

function ParametersTable({ params }: { params: Record<string, unknown> }) {
  const entries = sortParams(Object.entries(params))

  return (
    <CollapsibleSection title="Parameters Used" badge={`${entries.length}`}>
      <table className="w-full text-xs">
        <thead style={{ backgroundColor: 'var(--c-surface-alt)', borderBottom: '1px solid var(--c-border)' }}>
          <tr>
            <th className="text-left px-4 py-2.5 font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Name</th>
            <th className="text-left px-4 py-2.5 font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Scope</th>
            <th className="text-left px-4 py-2.5 font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, value], idx) => {
            const scope = inferScope(name)
            const s = SCOPE_STYLE[scope]
            return (
              <tr
                key={name}
                style={{ borderBottom: idx < entries.length - 1 ? '1px solid var(--c-border)' : 'none' }}
              >
                <td className="px-4 py-2 font-mono" style={{ color: 'var(--c-muted-2)' }}>{name}</td>
                <td className="px-4 py-2">
                  <span
                    className="text-xs px-2 py-0.5 rounded-full border font-medium"
                    style={{ backgroundColor: s.bg, color: s.text, borderColor: s.border }}
                  >
                    {scope}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono max-w-sm truncate" style={{ color: 'var(--c-text)' }}>
                  {Array.isArray(value)
                    ? value.join(', ')
                    : value === null || value === undefined
                    ? <span className="italic" style={{ color: 'var(--c-muted-4)' }}>null</span>
                    : String(value)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </CollapsibleSection>
  )
}

// ── Re-render result block ────────────────────────────────────────────────────

function ReRenderResult({ result, label }: { result: RenderOut; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(99,102,241,0.3)' }}>
      <div
        className="flex items-center justify-between px-5 py-3 border-b"
        style={{ backgroundColor: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.2)' }}
      >
        <div className="flex items-center gap-3">
          <span className="font-medium text-sm" style={{ color: '#818cf8' }}>{label}</span>
          <span
            className="font-mono text-xs px-2 py-0.5 rounded border"
            style={{ color: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.08)', borderColor: 'rgba(34,211,238,0.2)' }}
          >
            {result.git_sha.slice(0, 8)}
          </span>
          {result.render_id && (
            <Link
              to={`/history/${result.render_id}`}
              className="text-xs hover:text-indigo-300 transition-colors"
              style={{ color: '#6366f1' }}
            >
              #{result.render_id}
            </Link>
          )}
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(result.output)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="text-xs px-3 py-1 rounded-lg border transition-all"
          style={{ color: '#818cf8', borderColor: 'rgba(99,102,241,0.3)' }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre
        className="p-4 text-xs code-block overflow-x-auto whitespace-pre leading-relaxed overflow-y-auto"
        style={{ backgroundColor: 'var(--c-base)', color: '#a5f3c8', maxHeight: '500px' }}
      >
        {result.output}
      </pre>
    </div>
  )
}

// ── API example builder ───────────────────────────────────────────────────────

function buildHistoryExamples(renderId: number, _resolvedParams: Record<string, unknown>) {
  const base = getApiBase()

  const curl = `# Fetch stored render
curl -s "${base}/render-history/${renderId}" \
  -H "Authorization: Bearer $TOKEN"

# Re-render with same parameters
curl -s -X POST "${base}/render-history/${renderId}/re-render" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{\persist\: false}'`

  const python = `import requests

# Fetch stored render
r = requests.get(
    f"${base}/render-history/${renderId}",
    headers={"Authorization": "Bearer $TOKEN"},
)
print(r.json()["raw_output"])`

  return [
    { lang: 'curl' as const, code: curl },
    { lang: 'python' as const, code: python },
  ]
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HistoryDetail() {
  const { renderId } = useParams<{ renderId: string }>()
  const navigate = useNavigate()
  const id = renderId ?? ''

  const [reRenderResult, setReRenderResult] = useState<RenderOut | null>(null)
  const [altTemplateId, setAltTemplateId] = useState<string>('')
  const [altReRenderResult, setAltReRenderResult] = useState<RenderOut | null>(null)

  const { data: history, isLoading, error } = useQuery({
    queryKey: ['render-history', id],
    queryFn: () => getRenderHistory(id),
    enabled: !!id,
  })

  const { data: template } = useQuery({
    queryKey: ['template', history?.template_id],
    queryFn: () => getTemplate(history!.template_id!),
    enabled: !!history?.template_id,
  })

  const { data: chain } = useQuery({
    queryKey: ['inheritance-chain', history?.template_id],
    queryFn: () => getInheritanceChain(history!.template_id!),
    enabled: !!history?.template_id,
  })

  const { data: siblingTemplates } = useQuery({
    queryKey: ['templates', template?.project_id],
    queryFn: () => listTemplates({ project_id: template!.project_id, active_only: true }),
    enabled: !!template?.project_id,
  })

  const reRenderMut = useMutation({
    mutationFn: () => reRender(id, { persist: true }),
    onSuccess: setReRenderResult,
  })

  const altReRenderMut = useMutation({
    mutationFn: () => reRender(id, { template_id: altTemplateId, persist: true }),
    onSuccess: setAltReRenderResult,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2.5 text-sm py-12" style={{ color: 'var(--c-muted-3)' }}>
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading render…
      </div>
    )
  }

  if (error || !history) {
    return (
      <div
        className="rounded-xl border px-4 py-3 text-sm text-red-400"
        style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }}
      >
        Failed to load render #{id}.
      </div>
    )
  }

  const breadcrumb = chain?.map((c) => c.display_name) ?? []
  const currentTemplateName = template?.display_name ?? `Template #${history.template_id}`
  const alternatives = (siblingTemplates ?? []).filter((t) => t.id !== history.template_id)

  return (
    <div className="max-w-4xl space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        {breadcrumb.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs mb-2 flex-wrap" style={{ color: 'var(--c-muted-4)' }}>
            {breadcrumb.map((name, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span style={{ color: 'var(--c-border-bright)' }}>›</span>}
                <span>{name}</span>
              </span>
            ))}
            {breadcrumb.length > 0 && (
              <>
                <span style={{ color: 'var(--c-border-bright)' }}>›</span>
                <span style={{ color: 'var(--c-muted-3)' }}>{currentTemplateName}</span>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-white font-display">{currentTemplateName}</h1>
          {history.display_label && (
            <span
              className="text-sm px-2.5 py-0.5 rounded-full border font-mono"
              style={{ color: '#34d399', backgroundColor: 'rgba(52,211,153,0.08)', borderColor: 'rgba(52,211,153,0.25)' }}
            >
              {history.display_label}
            </span>
          )}
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3 mt-2.5">
          <span className="text-xs" style={{ color: 'var(--c-muted-3)' }}>{formatDate(history.rendered_at)}</span>
          <span style={{ color: 'var(--c-border-bright)' }}>·</span>
          <span
            className="font-mono text-xs px-2 py-0.5 rounded border"
            style={{ color: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.06)', borderColor: 'rgba(34,211,238,0.15)' }}
          >
            {history.template_git_sha.slice(0, 12)}
          </span>
          {(history.rendered_by_username || history.rendered_by) && (
            <>
              <span style={{ color: 'var(--c-border-bright)' }}>·</span>
              <span className="text-xs" style={{ color: 'var(--c-muted-3)' }}>
                {history.rendered_by_username ?? `user #${history.rendered_by}`}
              </span>
            </>
          )}
          <span style={{ color: 'var(--c-border-bright)' }}>·</span>
          <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>render #{history.id}</span>
        </div>

        {history.notes && (
          <div
            className="mt-3 text-sm rounded-lg px-4 py-2.5 border"
            style={{
              backgroundColor: 'rgba(251,191,36,0.06)',
              borderColor: 'rgba(251,191,36,0.2)',
              color: '#fbbf24',
            }}
          >
            {history.notes}
          </div>
        )}
      </div>

      {/* ── Actions row ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {history.template_id && (
          <button
            onClick={() =>
              navigate(`/render/${history.template_id}`, {
                state: { prefill: history.resolved_parameters },
              })
            }
            className="px-4 py-2 text-sm rounded-lg border transition-colors font-medium"
            style={{ color: 'var(--c-muted-2)', borderColor: 'var(--c-border-bright)', backgroundColor: 'var(--c-card)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--c-muted-4)'; e.currentTarget.style.color = 'var(--c-text)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--c-border-bright)'; e.currentTarget.style.color = 'var(--c-muted-2)' }}
          >
            Re-open form
          </button>
        )}

        <button
          onClick={() => reRenderMut.mutate()}
          disabled={reRenderMut.isPending}
          className="px-4 py-2 text-sm font-semibold text-white rounded-lg transition-all disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, #6366f1, #818cf8)',
            boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
          }}
        >
          {reRenderMut.isPending ? (
            <span className="flex items-center gap-1.5">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Re-rendering…
            </span>
          ) : (
            'Re-render'
          )}
        </button>

        {alternatives.length > 0 && (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2 border"
            style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }}
          >
            <span className="text-xs shrink-0" style={{ color: 'var(--c-muted-3)' }}>Re-render on:</span>
            <select
              value={altTemplateId}
              onChange={(e) => setAltTemplateId(e.target.value)}
              className="bg-transparent text-sm focus:outline-none border-0"
              style={{ color: 'var(--c-text)' }}
            >
              <option value="" style={{ backgroundColor: 'var(--c-card)' }}>Select template…</option>
              {alternatives.map((t) => (
                <option key={t.id} value={String(t.id)} style={{ backgroundColor: 'var(--c-card)' }}>
                  {t.display_name}
                </option>
              ))}
            </select>
            <button
              onClick={() => altReRenderMut.mutate()}
              disabled={!altTemplateId || altReRenderMut.isPending}
              className="px-3 py-1 text-xs rounded-lg transition-colors disabled:opacity-40 shrink-0"
              style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#818cf8' }}
            >
              {altReRenderMut.isPending ? 'Rendering…' : 'Go'}
            </button>
          </div>
        )}
        <div className="ml-auto shrink-0">
          <ApiCodePanel examples={buildHistoryExamples(id, history.resolved_parameters)} />
        </div>
      </div>

      {/* ── Sections ─────────────────────────────────────────────────────── */}

      <ParametersTable params={history.resolved_parameters} />
      <OutputBlock output={history.raw_output} />

      {reRenderResult && <ReRenderResult result={reRenderResult} label="Re-render output" />}
      {altReRenderResult && (
        <ReRenderResult result={altReRenderResult} label={`Re-render on template #${altTemplateId}`} />
      )}
    </div>
  )
}
