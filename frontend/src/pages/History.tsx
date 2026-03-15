import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { listRenderHistory, getRenderHistory } from '../api/render'
import { listProjects } from '../api/catalog'
import { listTemplates } from '../api/templates'
import type { RenderHistoryOut, TemplateOut } from '../api/types'

// ── Inline line diff (no external dep needed) ─────────────────────────────────

interface DiffPart {
  value: string
  added?: boolean
  removed?: boolean
}

function diffLines(left: string, right: string): DiffPart[] {
  const lLines = left.split('\n')
  const rLines = right.split('\n')
  const result: DiffPart[] = []
  const lLen = lLines.length
  const rLen = rLines.length
  // Simple LCS-based line diff
  const dp: number[][] = Array.from({ length: lLen + 1 }, () => new Array(rLen + 1).fill(0))
  for (let i = lLen - 1; i >= 0; i--) {
    for (let j = rLen - 1; j >= 0; j--) {
      if (lLines[i] === rLines[j]) dp[i][j] = 1 + dp[i + 1][j + 1]
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  let i = 0, j = 0
  while (i < lLen || j < rLen) {
    if (i < lLen && j < rLen && lLines[i] === rLines[j]) {
      result.push({ value: lLines[i] + '\n' })
      i++; j++
    } else if (j < rLen && (i >= lLen || dp[i + 1][j] <= dp[i][j + 1])) {
      result.push({ value: rLines[j] + '\n', added: true })
      j++
    } else {
      result.push({ value: lLines[i] + '\n', removed: true })
      i++
    }
  }
  return result
}

const PAGE_SIZE = 25
const GROUPED_LIMIT = 200

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

// ── Shared input style ────────────────────────────────────────────────────────

const filterInputClass =
  'rounded-lg px-2.5 py-1.5 text-sm border transition-colors duration-150 focus:outline-none'
const filterInputStyle = {
  backgroundColor: 'var(--c-card)',
  borderColor: 'var(--c-border-bright)',
  color: 'var(--c-text)',
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg className={`animate-spin h-${size} w-${size}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ── Preview Panel ─────────────────────────────────────────────────────────────

function PreviewPanel({
  historyId,
  onClose,
  templateName,
}: {
  historyId: number
  onClose: () => void
  templateName: string
}) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['render-history', historyId],
    queryFn: () => getRenderHistory(historyId),
    enabled: !!historyId,
  })

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function copy() {
    if (!data) return
    navigator.clipboard.writeText(data.raw_output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{
          width: '600px',
          backgroundColor: 'var(--c-base)',
          borderLeft: '1px solid var(--c-border)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface)' }}
        >
          <div>
            <div className="text-xs mb-1" style={{ color: 'var(--c-muted-4)' }}>Preview</div>
            <div className="font-semibold text-sm" style={{ color: 'var(--c-text)' }}>
              {templateName}
              {data?.display_label && (
                <span
                  className="ml-2 text-xs px-2 py-0.5 rounded-full border font-mono"
                  style={{ color: '#34d399', backgroundColor: 'rgba(52,211,153,0.08)', borderColor: 'rgba(52,211,153,0.2)' }}
                >
                  {data.display_label}
                </span>
              )}
            </div>
            {data && (
              <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: 'var(--c-muted-4)' }}>
                <span>{formatDate(data.rendered_at)}</span>
                {data.rendered_by_username && (
                  <>
                    <span style={{ color: 'var(--c-border-bright)' }}>·</span>
                    <span>{data.rendered_by_username}</span>
                  </>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none transition-colors"
            style={{ color: 'var(--c-muted-4)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--c-text)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--c-muted-4)' }}
          >
            ✕
          </button>
        </div>

        {/* Action bar */}
        <div
          className="flex items-center gap-2 px-5 py-2.5 border-b shrink-0"
          style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface-alt)' }}
        >
          <button
            onClick={copy}
            disabled={!data}
            className="px-3 py-1 text-xs rounded-lg border transition-all disabled:opacity-40"
            style={{ color: 'var(--c-muted-2)', borderColor: 'var(--c-border-bright)', backgroundColor: 'var(--c-card)' }}
          >
            {copied ? '✓ Copied' : 'Copy output'}
          </button>
          <Link
            to={`/history/${historyId}`}
            className="px-3 py-1 text-xs rounded-lg border transition-colors"
            style={{ color: '#818cf8', borderColor: 'rgba(99,102,241,0.3)', backgroundColor: 'rgba(99,102,241,0.06)' }}
          >
            Open full detail →
          </Link>
          {data?.template_id && (
            <button
              onClick={() => navigate(`/render/${data.template_id}`, { state: { prefill: data.resolved_parameters } })}
              className="px-3 py-1 text-xs rounded-lg border transition-colors"
              style={{ color: 'var(--c-muted-3)', borderColor: 'var(--c-border-bright)', backgroundColor: 'transparent' }}
            >
              Re-render with these params →
            </button>
          )}
        </div>

        {/* Output */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm" style={{ color: 'var(--c-muted-3)' }}>
              <Spinner /> Loading output…
            </div>
          ) : data ? (
            <pre
              className="p-5 text-xs code-block whitespace-pre leading-relaxed"
              style={{ backgroundColor: 'var(--c-base)', color: '#a5f3c8', minHeight: '100%' }}
            >
              {data.raw_output}
            </pre>
          ) : null}
        </div>
      </div>
    </>
  )
}

// ── Compare Modal ─────────────────────────────────────────────────────────────

function CompareModal({
  ids,
  templateMap,
  onClose,
}: {
  ids: [number, number]
  templateMap: Map<number, TemplateOut>
  onClose: () => void
}) {
  const { data: left, isLoading: leftLoading } = useQuery({
    queryKey: ['render-history', ids[0]],
    queryFn: () => getRenderHistory(ids[0]),
  })
  const { data: right, isLoading: rightLoading } = useQuery({
    queryKey: ['render-history', ids[1]],
    queryFn: () => getRenderHistory(ids[1]),
  })

  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const diffResult = useMemo(() => {
    if (!left || !right) return null
    return diffLines(left.raw_output, right.raw_output)
  }, [left, right])

  function headerFor(h: RenderHistoryOut | undefined, side: 'left' | 'right') {
    if (!h) return null
    const tpl = h.template_id ? templateMap.get(h.template_id) : null
    return (
      <div
        className="px-4 py-2.5 border-b text-xs flex items-center gap-3 shrink-0"
        style={{
          backgroundColor: side === 'left' ? 'rgba(99,102,241,0.07)' : 'rgba(52,211,153,0.07)',
          borderColor: 'var(--c-border)',
        }}
      >
        <span
          className="font-mono px-1.5 py-0.5 rounded text-xs"
          style={{ backgroundColor: 'var(--c-card)', color: '#22d3ee' }}
        >
          #{h.id}
        </span>
        <span style={{ color: 'var(--c-muted-2)' }}>{tpl?.display_name ?? `template #${h.template_id}`}</span>
        {h.display_label && (
          <span style={{ color: side === 'left' ? '#818cf8' : '#34d399' }}>
            {h.display_label}
          </span>
        )}
        <span className="ml-auto" style={{ color: 'var(--c-muted-4)' }}>{formatDateShort(h.rendered_at)}</span>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: 'var(--c-base)' }}
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface)' }}
      >
        <h2 className="font-semibold text-sm" style={{ color: 'var(--c-text)' }}>
          Compare renders #{ids[0]} ↔ #{ids[1]}
        </h2>
        <button
          onClick={onClose}
          className="text-lg leading-none transition-colors px-2"
          style={{ color: 'var(--c-muted-4)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--c-text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--c-muted-4)' }}
        >
          ✕ Close
        </button>
      </div>

      {(leftLoading || rightLoading) ? (
        <div className="flex items-center gap-2 p-8 text-sm" style={{ color: 'var(--c-muted-3)' }}>
          <Spinner /> Loading renders…
        </div>
      ) : (
        <div className="flex-1 overflow-hidden flex">
          {/* Side-by-side diff */}
          <div className="flex-1 overflow-auto flex flex-col border-r" style={{ borderColor: 'var(--c-border)' }}>
            {headerFor(left, 'left')}
            <pre
              className="flex-1 p-4 text-xs code-block whitespace-pre leading-relaxed overflow-auto"
              style={{ backgroundColor: 'var(--c-base)', color: '#a5f3c8' }}
            >
              {left?.raw_output}
            </pre>
          </div>
          <div className="flex-1 overflow-auto flex flex-col">
            {headerFor(right, 'right')}
            {diffResult ? (
              <pre
                className="flex-1 p-4 text-xs code-block whitespace-pre leading-relaxed overflow-auto"
                style={{ backgroundColor: 'var(--c-base)' }}
              >
                {diffResult.map((part, i) => (
                  <span
                    key={i}
                    style={{
                      backgroundColor: part.added
                        ? 'rgba(52,211,153,0.15)'
                        : part.removed
                        ? 'rgba(239,68,68,0.12)'
                        : 'transparent',
                      color: part.added ? '#34d399' : part.removed ? '#f87171' : '#a5f3c8',
                      display: 'block',
                    }}
                  >
                    {part.value}
                  </span>
                ))}
              </pre>
            ) : (
              <pre
                className="flex-1 p-4 text-xs code-block whitespace-pre leading-relaxed overflow-auto"
                style={{ backgroundColor: 'var(--c-base)', color: '#a5f3c8' }}
              >
                {right?.raw_output}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Group row (collapsible) ───────────────────────────────────────────────────

interface GroupRowProps {
  label: string
  items: RenderHistoryOut[]
  templateMap: Map<number, TemplateOut>
  compareSelected: number[]
  onCompareToggle: (id: number) => void
  onPreview: (id: number) => void
  onCopyRow: (id: number) => void
}

function GroupRow({ label, items, templateMap, compareSelected, onCompareToggle, onPreview, onCopyRow }: GroupRowProps) {
  const [expanded, setExpanded] = useState(false)
  const latest = items[0]
  return (
    <>
      <tr
        className="cursor-pointer transition-colors"
        style={{ borderBottom: '1px solid var(--c-border)' }}
        onClick={() => setExpanded((v) => !v)}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-4)' }}>
          <span style={{ color: 'var(--c-muted-3)' }}>{expanded ? '▼' : '▶'}</span>
        </td>
        <td className="px-4 py-3" colSpan={2}>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm" style={{ color: 'var(--c-muted-1)' }}>
              {label || <span className="italic" style={{ color: 'var(--c-muted-4)' }}>unlabeled</span>}
            </span>
            <span
              className="text-xs px-2 py-0.5 rounded-full border"
              style={{ color: 'var(--c-muted-3)', borderColor: 'var(--c-border-bright)', backgroundColor: 'var(--c-card)' }}
            >
              {items.length} renders
            </span>
          </div>
        </td>
        <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-3)' }}>
          {formatDate(latest.rendered_at)}
        </td>
        <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-4)' }}>
          {latest.rendered_by_username ?? (latest.rendered_by ? `#${latest.rendered_by}` : '—')}
        </td>
        <td />
      </tr>
      {expanded && items.map((item, idx) => {
        const tpl = item.template_id ? templateMap.get(item.template_id) : null
        return (
          <HistoryRow
            key={item.id}
            item={item}
            idx={idx}
            tpl={tpl}
            isLast={idx === items.length - 1}
            isSubRow
            compareSelected={compareSelected}
            onCompareToggle={onCompareToggle}
            onPreview={onPreview}
            onCopyRow={onCopyRow}
          />
        )
      })}
    </>
  )
}

// ── Single history row ────────────────────────────────────────────────────────

interface HistoryRowProps {
  item: RenderHistoryOut
  idx: number
  tpl: TemplateOut | null | undefined
  isLast: boolean
  isSubRow?: boolean
  compareSelected: number[]
  onCompareToggle: (id: number) => void
  onPreview: (id: number) => void
  onCopyRow: (id: number) => void
}

function HistoryRow({ item, tpl, isLast, isSubRow, compareSelected, onCompareToggle, onPreview, onCopyRow }: HistoryRowProps) {
  const [hovered, setHovered] = useState(false)
  const [copiedRow, setCopiedRow] = useState(false)

  function handleCopyRow(e: React.MouseEvent) {
    e.stopPropagation()
    onCopyRow(item.id)
    setCopiedRow(true)
    setTimeout(() => setCopiedRow(false), 1500)
  }

  return (
    <tr
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--c-border)',
        backgroundColor: isSubRow
          ? hovered ? 'rgba(99,102,241,0.04)' : 'rgba(99,102,241,0.02)'
          : hovered ? 'var(--c-row-hover)' : 'transparent',
        paddingLeft: isSubRow ? '2rem' : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Compare checkbox */}
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={compareSelected.includes(item.id)}
          onChange={() => onCompareToggle(item.id)}
          onClick={(e) => e.stopPropagation()}
          className="rounded"
          style={{ accentColor: '#6366f1' }}
        />
      </td>

      {/* Template / ID */}
      <td className="px-4 py-3" style={{ paddingLeft: isSubRow ? '2rem' : undefined }}>
        <Link
          to={`/history/${item.id}`}
          className="font-medium transition-colors hover:text-indigo-400 text-sm"
          style={{ color: 'var(--c-muted-1)' }}
        >
          {tpl ? tpl.display_name : item.template_id ? (
            <span className="font-mono text-xs" style={{ color: 'var(--c-muted-3)' }}>
              template #{item.template_id}
            </span>
          ) : (
            <span className="italic text-xs" style={{ color: 'var(--c-muted-4)' }}>deleted</span>
          )}
        </Link>
        {item.display_label && (
          <div
            className="text-xs mt-0.5 font-mono"
            style={{ color: '#34d399' }}
          >
            {item.display_label}
          </div>
        )}
      </td>

      {/* Git SHA */}
      <td className="px-4 py-3">
        <span
          className="font-mono text-xs px-2 py-0.5 rounded border"
          style={{ color: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.06)', borderColor: 'rgba(34,211,238,0.15)' }}
        >
          {item.template_git_sha.slice(0, 8)}
        </span>
      </td>

      {/* Rendered at */}
      <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-3)' }}>
        {formatDate(item.rendered_at)}
      </td>

      {/* Rendered by */}
      <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-4)' }}>
        {item.rendered_by_username ?? (item.rendered_by ? `#${item.rendered_by}` : '—')}
      </td>

      {/* Actions (hover) */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 justify-end">
          {hovered && (
            <>
              {/* Copy icon */}
              <button
                onClick={handleCopyRow}
                title="Copy output"
                className="p-1 rounded transition-colors"
                style={{ color: copiedRow ? '#34d399' : 'var(--c-muted-4)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--c-muted-2)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = copiedRow ? '#34d399' : 'var(--c-muted-4)' }}
              >
                {copiedRow ? (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                    <polyline points="2 8 6 12 14 4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                    <rect x="5" y="5" width="9" height="9" rx="1.5" />
                    <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
                  </svg>
                )}
              </button>

              {/* Preview eye */}
              <button
                onClick={() => onPreview(item.id)}
                title="Preview output"
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--c-muted-4)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--c-muted-2)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--c-muted-4)' }}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                  <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
                  <circle cx="8" cy="8" r="2" />
                </svg>
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function History() {
  const [projectId, setProjectId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [myRendersOnly, setMyRendersOnly] = useState(false)
  const [grouped, setGrouped] = useState(false)
  const [page, setPage] = useState(0)
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [compareSelected, setCompareSelected] = useState<number[]>([])
  const [showCompare, setShowCompare] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search 400ms
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(search), 400)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [search])

  function applyFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(0) }
  }

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  })

  const { data: projectTemplates } = useQuery({
    queryKey: ['templates', projectId],
    queryFn: () => listTemplates({ project_id: projectId ? Number(projectId) : undefined, active_only: false }),
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

  // Selected template object (for grouping check)
  const selectedTemplate = templateId ? templateMap.get(Number(templateId)) : undefined
  const canGroup = !!(templateId && selectedTemplate?.history_label_param)

  const offset = page * PAGE_SIZE
  const isGroupedFetch = grouped && canGroup

  const { data, isLoading, error } = useQuery({
    queryKey: ['render-history', { templateId, dateFrom, dateTo, debouncedSearch, myRendersOnly, grouped: isGroupedFetch, offset }],
    queryFn: () =>
      listRenderHistory({
        template_id: templateId ? Number(templateId) : undefined,
        date_from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        date_to: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
        search: debouncedSearch || undefined,
        rendered_by_me: myRendersOnly || undefined,
        grouped: isGroupedFetch || undefined,
        limit: isGroupedFetch ? GROUPED_LIMIT : PAGE_SIZE,
        offset: isGroupedFetch ? 0 : offset,
      }),
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  // Group items by display_label (client-side when grouped mode active)
  const groupedItems = useMemo(() => {
    if (!isGroupedFetch || !data) return null
    const groups = new Map<string, RenderHistoryOut[]>()
    for (const item of data.items) {
      const key = item.display_label ?? ''
      const arr = groups.get(key) ?? []
      arr.push(item)
      groups.set(key, arr)
    }
    return groups
  }, [isGroupedFetch, data])

  function clearFilters() {
    setProjectId(''); setTemplateId(''); setDateFrom(''); setDateTo(''); setSearch(''); setDebouncedSearch('')
    setMyRendersOnly(false); setGrouped(false); setPage(0); setCompareSelected([])
  }

  const hasFilters = projectId || templateId || dateFrom || dateTo || debouncedSearch || myRendersOnly

  // Compare toggle: FIFO-2
  function handleCompareToggle(id: number) {
    setCompareSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  // Copy row: fetch detail lazily, copy raw_output
  const copyingRef = useRef<Set<number>>(new Set())
  function handleCopyRow(id: number) {
    if (copyingRef.current.has(id)) return
    copyingRef.current.add(id)
    getRenderHistory(id)
      .then((h) => navigator.clipboard.writeText(h.raw_output))
      .finally(() => copyingRef.current.delete(id))
  }

  // Preview template name
  const previewTemplateName = useMemo(() => {
    if (!previewId) return ''
    const item = data?.items.find((i) => i.id === previewId)
    if (!item) return `Render #${previewId}`
    const tpl = item.template_id ? templateMap.get(item.template_id) : null
    return tpl?.display_name ?? `Render #${previewId}`
  }, [previewId, data, templateMap])

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white font-display">Render History</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>
          Audit trail of all template renders
        </p>
      </div>

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-end gap-3 mb-4 p-4 rounded-xl border"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        {/* Project */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium" style={{ color: 'var(--c-muted-3)' }}>Project</label>
          <select
            value={projectId}
            onChange={(e) => { applyFilter(setProjectId)(e.target.value); applyFilter(setTemplateId)('') }}
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
            onChange={(e) => applyFilter(setTemplateId)(e.target.value)}
            className={filterInputClass}
            style={{ ...filterInputStyle, minWidth: '160px' }}
          >
            <option value="" style={{ backgroundColor: 'var(--c-card)' }}>All templates</option>
            {(projectTemplates ?? []).filter((t) => !t.is_snippet && t.is_active).map((t) => (
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
            onChange={(e) => applyFilter(setDateFrom)(e.target.value)}
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
            onChange={(e) => applyFilter(setDateTo)(e.target.value)}
            className={filterInputClass}
            style={filterInputStyle}
          />
        </div>

        {/* Search */}
        <div className="flex flex-col gap-1.5 flex-1" style={{ minWidth: '180px' }}>
          <label className="text-xs font-medium" style={{ color: 'var(--c-muted-3)' }}>Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            placeholder="Search label, notes, template…"
            className={filterInputClass}
            style={{ ...filterInputStyle, width: '100%' }}
          />
        </div>

        {/* Toggle pills */}
        <div className="flex items-end gap-2 self-end">
          {/* My renders */}
          <button
            onClick={() => { setMyRendersOnly((v) => !v); setPage(0) }}
            className="px-3 py-1.5 text-xs rounded-lg border transition-colors font-medium"
            style={{
              color: myRendersOnly ? '#818cf8' : 'var(--c-muted-3)',
              borderColor: myRendersOnly ? 'rgba(99,102,241,0.5)' : 'var(--c-border-bright)',
              backgroundColor: myRendersOnly ? 'rgba(99,102,241,0.08)' : 'transparent',
            }}
          >
            My renders
          </button>

          {/* Group by device */}
          {canGroup && (
            <button
              onClick={() => { setGrouped((v) => !v); setPage(0) }}
              className="px-3 py-1.5 text-xs rounded-lg border transition-colors font-medium"
              style={{
                color: grouped ? '#34d399' : 'var(--c-muted-3)',
                borderColor: grouped ? 'rgba(52,211,153,0.4)' : 'var(--c-border-bright)',
                backgroundColor: grouped ? 'rgba(52,211,153,0.07)' : 'transparent',
              }}
            >
              Group by device
            </button>
          )}

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="px-3 py-1.5 text-xs rounded-lg border transition-colors"
              style={{ color: 'var(--c-muted-3)', borderColor: 'var(--c-border-bright)', backgroundColor: 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--c-muted-1)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--c-muted-3)' }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Compare toolbar */}
      {compareSelected.length > 0 && (
        <div
          className="flex items-center gap-3 mb-3 px-4 py-2.5 rounded-xl border"
          style={{ backgroundColor: 'rgba(99,102,241,0.07)', borderColor: 'rgba(99,102,241,0.3)' }}
        >
          <span className="text-xs" style={{ color: '#818cf8' }}>
            {compareSelected.length} render{compareSelected.length > 1 ? 's' : ''} selected
          </span>
          {compareSelected.length === 2 && (
            <button
              onClick={() => setShowCompare(true)}
              className="px-3 py-1 text-xs rounded-lg font-semibold transition-colors"
              style={{ backgroundColor: 'rgba(99,102,241,0.2)', color: '#818cf8' }}
            >
              Compare selected →
            </button>
          )}
          <button
            onClick={() => setCompareSelected([])}
            className="ml-auto text-xs transition-colors"
            style={{ color: 'var(--c-muted-4)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm py-8" style={{ color: 'var(--c-muted-3)' }}>
          <Spinner /> Loading history…
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="rounded-xl border px-4 py-3 text-sm text-red-400"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }}
        >
          Failed to load render history.
        </div>
      )}

      {/* Table */}
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
                    <th className="text-left px-4 py-3 w-8" />
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Template / Label</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Git SHA</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Rendered at</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>By</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {groupedItems ? (
                    // Grouped mode
                    Array.from(groupedItems.entries()).map(([label, items]) => (
                      <GroupRow
                        key={label || '__unlabeled__'}
                        label={label}
                        items={items}
                        templateMap={templateMap}
                        compareSelected={compareSelected}
                        onCompareToggle={handleCompareToggle}
                        onPreview={setPreviewId}
                        onCopyRow={handleCopyRow}
                      />
                    ))
                  ) : (
                    // Flat mode
                    data?.items.map((item, idx) => {
                      const tpl = item.template_id ? templateMap.get(item.template_id) : null
                      return (
                        <HistoryRow
                          key={item.id}
                          item={item}
                          idx={idx}
                          tpl={tpl}
                          isLast={idx === (data.items.length - 1)}
                          compareSelected={compareSelected}
                          onCompareToggle={handleCompareToggle}
                          onPreview={setPreviewId}
                          onCopyRow={handleCopyRow}
                        />
                      )
                    })
                  )}
                </tbody>
              </table>

              {/* Pagination footer (hidden in grouped mode) */}
              {!isGroupedFetch && (
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
              )}
              {isGroupedFetch && data && (
                <div
                  className="px-4 py-2.5 border-t text-xs"
                  style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface-alt)', color: 'var(--c-muted-4)' }}
                >
                  {data.total} total render{data.total !== 1 ? 's' : ''} — showing up to {GROUPED_LIMIT}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Preview panel */}
      {previewId !== null && (
        <PreviewPanel
          historyId={previewId}
          templateName={previewTemplateName}
          onClose={() => setPreviewId(null)}
        />
      )}

      {/* Compare modal */}
      {showCompare && compareSelected.length === 2 && (
        <CompareModal
          ids={[compareSelected[0], compareSelected[1]]}
          templateMap={templateMap}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  )
}
