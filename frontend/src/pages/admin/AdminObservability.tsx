import { useState, useEffect, useCallback } from 'react'
import { getRendersOverTime, getTopTemplates, getHealthDetail, getAuditLog } from '../../api/admin'
import type { AuditLogParams } from '../../api/admin'
import type { RenderDayPoint, TopTemplateItem, ComponentCheck, HealthOut } from '../../api/types'

// ---------------------------------------------------------------------------
// Section 1: Render Analytics
// ---------------------------------------------------------------------------

function RenderAnalytics() {
  const [days, setDays] = useState(30)
  const [series, setSeries] = useState<RenderDayPoint[]>([])
  const [topItems, setTopItems] = useState<TopTemplateItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ts, top] = await Promise.all([getRendersOverTime(days), getTopTemplates(days)])
      setSeries(ts.series)
      setTopItems(top.items)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  const maxTotal = Math.max(...series.map(p => p.total), 1)

  return (
    <div>
      {/* Day range selector */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-medium" style={{ color: 'var(--c-muted-3)' }}>Range:</span>
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              days === d
                ? 'text-white'
                : ''
            }`}
            style={days === d
              ? { background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: 'white' }
              : { background: 'var(--c-surface-2)', color: 'var(--c-text)' }
            }
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Bar chart */}
      {loading ? (
        <div className="h-32 flex items-center justify-center text-sm" style={{ color: 'var(--c-muted-3)' }}>
          Loading…
        </div>
      ) : (
        <div className="mb-6">
          <div className="flex items-end gap-px h-32 overflow-hidden rounded" style={{ background: 'var(--c-surface-2)' }}>
            {series.map((p, i) => {
              const pct = (p.total / maxTotal) * 100
              const errPct = p.total > 0 ? (p.errors / p.total) * 100 : 0
              const showLabel = i % 7 === 0
              return (
                <div
                  key={p.date}
                  className="relative flex-1 flex flex-col justify-end group"
                  title={`${p.date} | ${p.total} renders, ${p.errors} errors`}
                >
                  <div
                    className="relative w-full transition-all"
                    style={{ height: `${Math.max(pct, 2)}%`, background: '#6366f1', minHeight: p.total > 0 ? 2 : 0 }}
                  >
                    {p.errors > 0 && (
                      <div
                        className="absolute bottom-0 left-0 right-0"
                        style={{ height: `${errPct}%`, background: '#ef4444', minHeight: 2 }}
                      />
                    )}
                  </div>
                  {showLabel && (
                    <div
                      className="absolute -bottom-5 left-0 text-xs whitespace-nowrap"
                      style={{ color: 'var(--c-muted-3)', fontSize: '0.6rem' }}
                    >
                      {p.date.slice(5)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-6 text-xs" style={{ color: 'var(--c-muted-3)' }}>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#6366f1' }} />
              Total renders
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#ef4444' }} />
              Errors
            </span>
          </div>
        </div>
      )}

      {/* Top templates table */}
      <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--c-text)' }}>
        Top {topItems.length} templates (last {days}d)
      </h3>
      {topItems.length === 0 && !loading && (
        <p className="text-sm" style={{ color: 'var(--c-muted-3)' }}>No render data for this period.</p>
      )}
      {topItems.length > 0 && (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--c-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--c-surface-2)', color: 'var(--c-muted-3)' }}>
                <th className="text-left px-3 py-2 font-medium">Template</th>
                <th className="text-right px-3 py-2 font-medium">Renders</th>
                <th className="text-right px-3 py-2 font-medium">Errors</th>
                <th className="text-right px-3 py-2 font-medium">Error rate</th>
              </tr>
            </thead>
            <tbody>
              {topItems.map(item => (
                <tr key={item.template_id} style={{ borderTop: '1px solid var(--c-border)', color: 'var(--c-text)' }}>
                  <td className="px-3 py-2">{item.display_name}</td>
                  <td className="text-right px-3 py-2">{item.render_count}</td>
                  <td className="text-right px-3 py-2">{item.error_count}</td>
                  <td className="text-right px-3 py-2">
                    {item.render_count > 0
                      ? `${((item.error_count / item.render_count) * 100).toFixed(1)}%`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 2: Audit Log
// ---------------------------------------------------------------------------

interface AuditLogEntry {
  id: number
  user_sub: string
  action: string
  resource_type: string
  resource_id: string | null
  timestamp: string
  changes: Record<string, unknown>
}

const RESOURCE_TYPES = ['all', 'template', 'parameter', 'project', 'secret', 'auth', 'git', 'datasource', 'feature', 'filter']

function AuditLogSection() {
  const [items, setItems] = useState<AuditLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [filterUser, setFilterUser] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: AuditLogParams = { skip: page * limit, limit }
      if (filterUser.trim()) params.user_sub = filterUser.trim()
      if (filterType !== 'all') params.resource_type = filterType
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const data = await getAuditLog(params)
      setItems(data.items as AuditLogEntry[])
      setTotal(data.total)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [page, filterUser, filterType, dateFrom, dateTo])

  useEffect(() => {
    const t = setTimeout(load, filterUser ? 400 : 0)
    return () => clearTimeout(t)
  }, [load, filterUser])

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: 'var(--c-muted-3)' }}>User</label>
          <input
            value={filterUser}
            onChange={e => { setFilterUser(e.target.value); setPage(0) }}
            placeholder="Search user…"
            className="px-2 py-1.5 rounded text-sm border"
            style={{ background: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-text)', width: 160 }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: 'var(--c-muted-3)' }}>Resource type</label>
          <select
            value={filterType}
            onChange={e => { setFilterType(e.target.value); setPage(0) }}
            className="px-2 py-1.5 rounded text-sm border"
            style={{ background: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
          >
            {RESOURCE_TYPES.map(t => <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: 'var(--c-muted-3)' }}>From</label>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }}
            className="px-2 py-1.5 rounded text-sm border"
            style={{ background: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: 'var(--c-muted-3)' }}>To</label>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }}
            className="px-2 py-1.5 rounded text-sm border"
            style={{ background: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }} />
        </div>
        <button
          onClick={() => { setFilterUser(''); setFilterType('all'); setDateFrom(''); setDateTo(''); setPage(0) }}
          className="px-3 py-1.5 rounded text-sm border"
          style={{ borderColor: 'var(--c-border)', color: 'var(--c-muted-3)' }}
        >
          Reset
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--c-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--c-surface-2)', color: 'var(--c-muted-3)' }}>
              <th className="text-left px-3 py-2 font-medium">Timestamp</th>
              <th className="text-left px-3 py-2 font-medium">User</th>
              <th className="text-left px-3 py-2 font-medium">Action</th>
              <th className="text-left px-3 py-2 font-medium">Resource type</th>
              <th className="text-left px-3 py-2 font-medium">Resource ID</th>
              <th className="text-left px-3 py-2 font-medium">Changes</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center py-6 text-sm" style={{ color: 'var(--c-muted-3)' }}>Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} className="text-center py-6 text-sm" style={{ color: 'var(--c-muted-3)' }}>No audit log entries.</td></tr>
            )}
            {items.map(entry => (
              <tr key={entry.id} style={{ borderTop: '1px solid var(--c-border)', color: 'var(--c-text)' }}>
                <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: 'var(--c-muted-3)' }}>
                  {new Date(entry.timestamp).toLocaleString()}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{entry.user_sub}</td>
                <td className="px-3 py-2">
                  <span className="px-1.5 py-0.5 rounded text-xs font-medium"
                    style={{ background: 'var(--c-surface-2)', color: 'var(--c-text)' }}>
                    {entry.action}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">{entry.resource_type}</td>
                <td className="px-3 py-2 font-mono text-xs">{entry.resource_id ?? '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {Object.keys(entry.changes).length === 0 ? '—' : (
                    <>
                      <button
                        onClick={() => toggleExpand(entry.id)}
                        className="text-xs underline"
                        style={{ color: 'var(--c-accent, #6366f1)' }}
                      >
                        {expanded.has(entry.id) ? 'hide' : 'view'}
                      </button>
                      {expanded.has(entry.id) && (
                        <pre className="mt-1 text-xs rounded p-2 overflow-auto max-h-40"
                          style={{ background: 'var(--c-surface-2)', color: 'var(--c-text)' }}>
                          {JSON.stringify(entry.changes, null, 2)}
                        </pre>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-sm" style={{ color: 'var(--c-muted-3)' }}>
        <span>Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
        <div className="flex gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 rounded border disabled:opacity-40"
            style={{ borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
          >
            Prev
          </button>
          <button
            disabled={(page + 1) * limit >= total}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 rounded border disabled:opacity-40"
            style={{ borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 3: System Health (inline admin version)
// ---------------------------------------------------------------------------

function statusColor(s: string) {
  if (s === 'ok') return '#22c55e'
  if (s === 'warn') return '#f59e0b'
  return '#ef4444'
}

function HealthSection() {
  const [health, setHealth] = useState<HealthOut | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getHealthDetail()
      setHealth(data)
      setLastChecked(new Date())
    } catch {
      setHealth(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Tick counter to update "N seconds ago" text
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const secondsAgo = lastChecked ? Math.round((Date.now() - lastChecked.getTime()) / 1000) : null

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={refresh}
          className="px-3 py-1.5 rounded text-sm font-medium"
          style={{ background: 'var(--c-surface-2)', color: 'var(--c-text)', border: '1px solid var(--c-border)' }}
        >
          {loading ? 'Checking…' : 'Refresh'}
        </button>
        {secondsAgo !== null && (
          <span className="text-xs" style={{ color: 'var(--c-muted-3)' }}>
            Last checked {secondsAgo}s ago
          </span>
        )}
        {health && (
          <span
            className="px-2 py-0.5 rounded text-xs font-bold uppercase"
            style={{ background: statusColor(health.status) + '22', color: statusColor(health.status) }}
          >
            {health.status}
          </span>
        )}
      </div>

      {health && (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--c-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--c-surface-2)', color: 'var(--c-muted-3)' }}>
                <th className="text-left px-3 py-2 font-medium">Component</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Latency</th>
                <th className="text-left px-3 py-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {health.components.map((c: ComponentCheck) => (
                <tr key={c.name} style={{ borderTop: '1px solid var(--c-border)', color: 'var(--c-text)' }}>
                  <td className="px-3 py-2 font-medium capitalize">{c.name}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ background: statusColor(c.status) }}
                      />
                      {c.status}
                    </span>
                  </td>
                  <td className="text-right px-3 py-2 text-xs" style={{ color: 'var(--c-muted-3)' }}>
                    {c.latency_ms != null ? `${c.latency_ms}ms` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--c-muted-3)' }}>
                    {c.message ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!health && !loading && (
        <p className="text-sm" style={{ color: '#ef4444' }}>Unable to reach health endpoint.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'analytics', label: 'Render Analytics' },
  { key: 'audit', label: 'Audit Log' },
  { key: 'health', label: 'System Health' },
] as const

type TabKey = typeof TABS[number]['key']

export default function AdminObservability() {
  const [tab, setTab] = useState<TabKey>('analytics')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold font-display mb-1" style={{ color: 'var(--c-text)' }}>
          Observability
        </h1>
        <p className="text-sm" style={{ color: 'var(--c-muted-3)' }}>
          Render analytics, audit log, and system health.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--c-border)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={tab === t.key
              ? { color: '#6366f1', borderBottom: '2px solid #6366f1', marginBottom: -1 }
              : { color: 'var(--c-muted-3)', borderBottom: '2px solid transparent', marginBottom: -1 }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'analytics' && <RenderAnalytics />}
      {tab === 'audit' && <AuditLogSection />}
      {tab === 'health' && <HealthSection />}
    </div>
  )
}
