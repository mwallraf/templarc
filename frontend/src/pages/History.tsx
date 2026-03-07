import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { listRenderHistory } from '../api/render'
import { listProjects } from '../api/catalog'
import { listTemplates } from '../api/templates'
import type { TemplateOut } from '../api/types'

const PAGE_SIZE = 25

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

// ── Shared input/select style ─────────────────────────────────────────────────

const filterInputClass =
  'rounded-lg px-2.5 py-1.5 text-sm border transition-colors duration-150 focus:outline-none'
const filterInputStyle = {
  backgroundColor: 'var(--c-card)',
  borderColor: 'var(--c-border-bright)',
  color: 'var(--c-text)',
}

// ── Filters bar ───────────────────────────────────────────────────────────────

interface FiltersProps {
  projectId: string
  templateId: string
  dateFrom: string
  dateTo: string
  templates: TemplateOut[]
  onProjectChange: (v: string) => void
  onTemplateChange: (v: string) => void
  onDateFromChange: (v: string) => void
  onDateToChange: (v: string) => void
  onClear: () => void
}

function FiltersBar({
  projectId,
  templateId,
  dateFrom,
  dateTo,
  templates,
  onProjectChange,
  onTemplateChange,
  onDateFromChange,
  onDateToChange,
  onClear,
}: FiltersProps) {
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  })

  const hasFilters = projectId || templateId || dateFrom || dateTo

  return (
    <div
      className="flex flex-wrap items-end gap-3 mb-5 p-4 rounded-xl border"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      {/* Project */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: 'var(--c-muted-3)' }}>Project</label>
        <select
          value={projectId}
          onChange={(e) => { onProjectChange(e.target.value); onTemplateChange('') }}
          className={filterInputClass}
          style={filterInputStyle}
        >
          <option value="" style={{ backgroundColor: 'var(--c-card)' }}>All projects</option>
          {projects?.map((p) => (
            <option key={p.id} value={String(p.id)} style={{ backgroundColor: 'var(--c-card)' }}>
              {p.display_name}
            </option>
          ))}
        </select>
      </div>

      {/* Template */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: 'var(--c-muted-3)' }}>Template</label>
        <select
          value={templateId}
          onChange={(e) => onTemplateChange(e.target.value)}
          className={filterInputClass}
          style={{ ...filterInputStyle, minWidth: '160px' }}
        >
          <option value="" style={{ backgroundColor: 'var(--c-card)' }}>All templates</option>
          {templates.map((t) => (
            <option key={t.id} value={String(t.id)} style={{ backgroundColor: 'var(--c-card)' }}>
              {t.display_name}
            </option>
          ))}
        </select>
      </div>

      {/* Date from */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: 'var(--c-muted-3)' }}>From</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onDateFromChange(e.target.value)}
          className={filterInputClass}
          style={filterInputStyle}
        />
      </div>

      {/* Date to */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: 'var(--c-muted-3)' }}>To</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => onDateToChange(e.target.value)}
          className={filterInputClass}
          style={filterInputStyle}
        />
      </div>

      {hasFilters && (
        <button
          onClick={onClear}
          className="self-end px-3 py-1.5 text-xs rounded-lg border transition-colors"
          style={{ color: 'var(--c-muted-3)', borderColor: 'var(--c-border-bright)', backgroundColor: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--c-muted-4)'; e.currentTarget.style.color = 'var(--c-muted-1)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--c-border-bright)'; e.currentTarget.style.color = 'var(--c-muted-3)' }}
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function History() {
  const [projectId, setProjectId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)

  function applyFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(0) }
  }

  const { data: projectTemplates } = useQuery({
    queryKey: ['templates', projectId],
    queryFn: () =>
      listTemplates({ project_id: projectId ? Number(projectId) : undefined, active_only: false }),
    enabled: true,
  })

  const { data: allTemplates } = useQuery({
    queryKey: ['templates', 'all'],
    queryFn: () => listTemplates({ active_only: false }),
  })

  const templateMap = useMemo(() => {
    const m = new Map<number, TemplateOut>()
    for (const t of allTemplates ?? []) m.set(t.id, t)
    return m
  }, [allTemplates])

  const offset = page * PAGE_SIZE

  const { data, isLoading, error } = useQuery({
    queryKey: ['render-history', { templateId, dateFrom, dateTo, offset }],
    queryFn: () =>
      listRenderHistory({
        template_id: templateId ? Number(templateId) : undefined,
        date_from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        date_to: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
        limit: PAGE_SIZE,
        offset,
      }),
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  function clearFilters() {
    setProjectId(''); setTemplateId(''); setDateFrom(''); setDateTo(''); setPage(0)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white font-display">Render History</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>
          Audit trail of all template renders
        </p>
      </div>

      <FiltersBar
        projectId={projectId}
        templateId={templateId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        templates={(projectTemplates ?? []).filter((t) => !t.is_snippet && t.is_active)}
        onProjectChange={applyFilter(setProjectId)}
        onTemplateChange={applyFilter(setTemplateId)}
        onDateFromChange={applyFilter(setDateFrom)}
        onDateToChange={applyFilter(setDateTo)}
        onClear={clearFilters}
      />

      {isLoading && (
        <div className="flex items-center gap-2 text-sm py-8" style={{ color: 'var(--c-muted-3)' }}>
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading history…
        </div>
      )}

      {error && (
        <div
          className="rounded-xl border px-4 py-3 text-sm text-red-400"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }}
        >
          Failed to load render history.
        </div>
      )}

      {!isLoading && !error && (
        <>
          {data?.items.length === 0 ? (
            <div className="text-center py-16" style={{ color: 'var(--c-muted-4)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-10 h-10 mx-auto mb-3 opacity-40">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15.5 15" />
              </svg>
              <p className="text-sm">No renders match the selected filters.</p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: 'var(--c-surface-alt)', borderBottom: '1px solid var(--c-border)' }}>
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>#</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Template</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Git SHA</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Rendered at</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((item, idx) => {
                    const tpl = item.template_id ? templateMap.get(item.template_id) : null
                    return (
                      <tr
                        key={item.id}
                        className="transition-colors"
                        style={{
                          borderBottom: idx < (data.items.length - 1) ? '1px solid var(--c-border)' : 'none',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--c-muted-4)' }}>
                          #{item.id}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/history/${item.id}`}
                            className="font-medium transition-colors hover:text-indigo-400"
                            style={{ color: 'var(--c-muted-1)' }}
                          >
                            {tpl ? (
                              tpl.display_name
                            ) : item.template_id ? (
                              <span className="font-mono text-xs" style={{ color: 'var(--c-muted-3)' }}>
                                template #{item.template_id}
                              </span>
                            ) : (
                              <span className="italic text-xs" style={{ color: 'var(--c-muted-4)' }}>deleted</span>
                            )}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="font-mono text-xs px-2 py-0.5 rounded border"
                            style={{ color: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.06)', borderColor: 'rgba(34,211,238,0.15)' }}
                          >
                            {item.template_git_sha.slice(0, 8)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-3)' }}>
                          {formatDate(item.rendered_at)}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--c-muted-4)' }}>
                          {item.notes ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Pagination footer */}
              <div
                className="flex items-center justify-between px-4 py-3 border-t"
                style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface-alt)' }}
              >
                <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>
                  {data && data.total > 0
                    ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, data.total)} of ${data.total}`
                    : '0 results'}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page === 0}
                    className="px-3 py-1 text-xs rounded-lg border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ color: 'var(--c-muted-3)', borderColor: 'var(--c-border-bright)', backgroundColor: 'transparent' }}
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1 text-xs rounded-lg border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ color: 'var(--c-muted-3)', borderColor: 'var(--c-border-bright)', backgroundColor: 'transparent' }}
                  >
                    Next →
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
