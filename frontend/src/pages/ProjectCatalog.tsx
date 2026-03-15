import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { getCatalog } from '../api/catalog'
import { gitSyncStatus } from '../api/templates'
import { getMe } from '../api/auth'
import GitSyncModal from '../components/GitSyncModal'
import type { CatalogTemplateItem } from '../api/types'

const LIST_THRESHOLD = 10

// ── Card view ─────────────────────────────────────────────────────────────────

function TemplateCard({ template }: { template: CatalogTemplateItem }) {
  return (
    <Link
      to={`/render/${template.id}`}
      className="card-hover block rounded-xl border p-4 group"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h3 className="font-semibold text-slate-100 text-sm group-hover:text-white transition-colors leading-snug">
          {template.display_name}
        </h3>
        <div className="flex gap-1.5 shrink-0">
          {template.has_remote_datasources && (
            <span
              className="badge"
              style={{
                backgroundColor: 'rgba(34,211,238,0.1)',
                color: '#22d3ee',
                border: '1px solid rgba(34,211,238,0.2)',
              }}
            >
              Remote
            </span>
          )}
        </div>
      </div>

      {template.breadcrumb.length > 0 && (
        <p className="text-xs font-mono mb-1.5" style={{ color: 'var(--c-muted-4)' }}>
          {template.breadcrumb.join(' › ')}
        </p>
      )}

      {template.description && (
        <p className="text-xs line-clamp-2 mb-3" style={{ color: 'var(--c-muted-3)' }}>
          {template.description}
        </p>
      )}

      <div
        className="flex items-center justify-between pt-3 border-t"
        style={{ borderColor: 'var(--c-border)', marginTop: template.description ? undefined : 'auto' }}
      >
        <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>
          {template.parameter_count} param{template.parameter_count !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1 text-xs font-medium" style={{ color: '#6366f1' }}>
          Render
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 transition-transform group-hover:translate-x-0.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </div>
    </Link>
  )
}

// ── List row ──────────────────────────────────────────────────────────────────

function TemplateListItem({ template }: { template: CatalogTemplateItem }) {
  return (
    <Link
      to={`/render/${template.id}`}
      className="card-hover flex items-center gap-4 rounded-xl border px-4 py-3 group"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      {/* Icon */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border-bright)' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4" style={{ color: '#6366f1' }}>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>

      {/* Name + breadcrumb + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-100 text-sm group-hover:text-white transition-colors">
            {template.display_name}
          </span>
          {template.has_remote_datasources && (
            <span
              className="badge shrink-0"
              style={{
                backgroundColor: 'rgba(34,211,238,0.1)',
                color: '#22d3ee',
                border: '1px solid rgba(34,211,238,0.2)',
              }}
            >
              Remote
            </span>
          )}
        </div>
        {template.breadcrumb.length > 0 && (
          <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--c-muted-4)' }}>
            {template.breadcrumb.join(' › ')}
          </p>
        )}
        {template.description && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--c-muted-3)' }}>
            {template.description}
          </p>
        )}
      </div>

      {/* Params + arrow */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>
          {template.parameter_count} param{template.parameter_count !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1 text-xs font-medium" style={{ color: '#6366f1' }}>
          Render
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 transition-transform group-hover:translate-x-0.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </div>
    </Link>
  )
}

// ── Category card ─────────────────────────────────────────────────────────────

function CategoryCard({ template }: { template: CatalogTemplateItem }) {
  return (
    <div
      className="card-hover block rounded-xl border p-4 cursor-default"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border-bright)' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4" style={{ color: 'var(--c-muted-2)' }}>
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-200 text-sm leading-snug truncate">
            {template.display_name}
          </h3>
          {template.description && (
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--c-muted-3)' }}>
              {template.description}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function IconList() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="3" cy="6" r="1" fill="currentColor" />
      <circle cx="3" cy="12" r="1" fill="currentColor" />
      <circle cx="3" cy="18" r="1" fill="currentColor" />
    </svg>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProjectCatalog() {
  const { projectSlug } = useParams<{ projectSlug: string }>()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [syncOpen, setSyncOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [viewOverride, setViewOverride] = useState<'card' | 'list' | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['catalog', projectSlug],
    queryFn: () => getCatalog(projectSlug!),
    enabled: !!projectSlug,
  })

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    staleTime: 5 * 60_000,
  })

  const projectId = data?.project?.id
  const { data: syncStatus } = useQuery({
    queryKey: ['gitSyncStatus', projectId],
    queryFn: () => gitSyncStatus(projectId!),
    enabled: !!projectId && me?.is_admin === true,
    staleTime: 60_000,
    retry: false,
  })

  const driftCount = syncStatus
    ? syncStatus.in_git_only + syncStatus.in_db_only
    : 0

  const leafTemplates = useMemo(() => data?.templates.filter((t) => t.is_leaf) ?? [], [data])
  const nonLeaf = useMemo(() => data?.templates.filter((t) => !t.is_leaf) ?? [], [data])

  // Auto-detect default view based on count; user override wins
  const autoView: 'card' | 'list' = leafTemplates.length > LIST_THRESHOLD ? 'list' : 'card'
  const viewMode: 'card' | 'list' = viewOverride ?? autoView

  // Filter leaf templates by search
  const q = search.trim().toLowerCase()
  const filteredLeaf = useMemo(() => {
    if (!q) return leafTemplates
    return leafTemplates.filter(
      (t) =>
        t.display_name.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q) ||
        t.breadcrumb.some((b) => b.toLowerCase().includes(q))
    )
  }, [leafTemplates, q])

  if (isLoading) {
    return (
      <div>
        <div className="skeleton h-8 w-64 mb-2 rounded-lg" />
        <div className="skeleton h-4 w-96 mb-8 rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton h-28 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="rounded-xl border px-4 py-3 text-sm text-red-400"
        style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }}
      >
        Failed to load catalog.
      </div>
    )
  }

  return (
    <div>
      {/* Project header */}
      <div className="flex items-start justify-between gap-4 mb-7">
        <div>
          <h1 className="text-2xl font-bold text-white font-display">
            {data?.project.display_name}
          </h1>
          {data?.project.description && (
            <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>
              {data.project.description}
            </p>
          )}
        </div>

        {/* Admin action buttons */}
        {me?.is_admin && projectId && (
          <div className="flex items-center gap-2 shrink-0">
            {/* New Template */}
            <button
              onClick={() => navigate('/admin/templates', { state: { openCreate: true, projectId } })}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                color: 'white',
                boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
              title="Create a new template in this project"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Template
            </button>

            {/* Sync from Git */}

          <button
            onClick={() => setSyncOpen(true)}
            className="relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all"
            style={{
              backgroundColor: 'var(--c-card)',
              border: '1px solid var(--c-border-bright)',
              color: driftCount > 0 ? '#fbbf24' : 'var(--c-muted-3)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = driftCount > 0 ? 'rgba(245,158,11,0.4)' : 'var(--c-muted-4)'
              e.currentTarget.style.color = driftCount > 0 ? '#fcd34d' : 'var(--c-muted-2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--c-border-bright)'
              e.currentTarget.style.color = driftCount > 0 ? '#fbbf24' : 'var(--c-muted-3)'
            }}
            title={
              driftCount > 0
                ? `${driftCount} item${driftCount !== 1 ? 's' : ''} out of sync with Git`
                : 'In sync with Git'
            }
          >
            {driftCount > 0 && (
              <span className="relative flex h-2 w-2">
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ backgroundColor: '#fbbf24' }}
                />
                <span
                  className="relative inline-flex rounded-full h-2 w-2"
                  style={{ backgroundColor: '#f59e0b' }}
                />
              </span>
            )}
            {driftCount === 0 && syncStatus && (
              <span
                className="inline-flex rounded-full h-2 w-2"
                style={{ backgroundColor: '#4ade80' }}
              />
            )}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            <span className="font-medium">
              Sync from Git
              {driftCount > 0 && (
                <span
                  className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-mono"
                  style={{ backgroundColor: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}
                >
                  {driftCount}
                </span>
              )}
            </span>
          </button>
          </div>
        )}
      </div>

      {/* Categories */}
      {nonLeaf.length > 0 && (
        <div className="mb-7">
          <h2
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: 'var(--c-muted-4)' }}
          >
            Categories
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {nonLeaf.map((t) => (
              <CategoryCard key={t.id} template={t} />
            ))}
          </div>
        </div>
      )}

      {/* Templates section */}
      {leafTemplates.length > 0 && (
        <div>
          {/* Section header: label + search + toggle */}
          <div className="flex items-center gap-3 mb-3">
            <h2
              className="text-xs font-semibold uppercase tracking-widest shrink-0"
              style={{ color: 'var(--c-muted-4)' }}
            >
              Templates
              {leafTemplates.length > 0 && (
                <span className="ml-2 font-mono normal-case tracking-normal" style={{ color: 'var(--c-muted-5, var(--c-muted-4))' }}>
                  ({filteredLeaf.length}{q ? `/${leafTemplates.length}` : ''})
                </span>
              )}
            </h2>

            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <svg
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                style={{ color: 'var(--c-muted-4)' }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates…"
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-indigo-500"
                style={{
                  backgroundColor: 'var(--c-card)',
                  borderColor: 'var(--c-border-bright)',
                  color: 'var(--c-text)',
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs leading-none"
                  style={{ color: 'var(--c-muted-4)' }}
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            {/* Card / list toggle */}
            <div
              className="flex items-center rounded-lg border overflow-hidden shrink-0"
              style={{ borderColor: 'var(--c-border-bright)' }}
            >
              <button
                onClick={() => setViewOverride('card')}
                className="flex items-center justify-center w-8 h-7 transition-colors"
                style={{
                  backgroundColor: viewMode === 'card' ? 'var(--c-border-bright)' : 'var(--c-card)',
                  color: viewMode === 'card' ? 'var(--c-text)' : 'var(--c-muted-4)',
                }}
                title="Card view"
              >
                <IconGrid />
              </button>
              <button
                onClick={() => setViewOverride('list')}
                className="flex items-center justify-center w-8 h-7 transition-colors"
                style={{
                  backgroundColor: viewMode === 'list' ? 'var(--c-border-bright)' : 'var(--c-card)',
                  color: viewMode === 'list' ? 'var(--c-text)' : 'var(--c-muted-4)',
                }}
                title="List view"
              >
                <IconList />
              </button>
            </div>
          </div>

          {/* Template grid or list */}
          {filteredLeaf.length === 0 ? (
            <div
              className="rounded-xl border border-dashed px-6 py-10 text-center"
              style={{ borderColor: 'var(--c-border-bright)' }}
            >
              <p className="text-sm" style={{ color: 'var(--c-muted-3)' }}>
                No templates match <span className="font-mono">"{search}"</span>
              </p>
              <button
                onClick={() => setSearch('')}
                className="text-xs text-indigo-400 hover:text-indigo-300 mt-2 inline-block transition-colors"
              >
                Clear search
              </button>
            </div>
          ) : viewMode === 'card' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredLeaf.map((t) => (
                <TemplateCard key={t.id} template={t} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredLeaf.map((t) => (
                <TemplateListItem key={t.id} template={t} />
              ))}
            </div>
          )}
        </div>
      )}

      {data?.templates.length === 0 && (
        <div
          className="rounded-xl border border-dashed px-6 py-16 text-center"
          style={{ borderColor: 'var(--c-border-bright)' }}
        >
          <p className="text-sm" style={{ color: 'var(--c-muted-3)' }}>No templates in this project yet.</p>
          <Link to="/admin/templates" className="text-xs text-indigo-400 hover:text-indigo-300 mt-2 inline-block transition-colors">
            Add templates in the admin panel →
          </Link>
        </div>
      )}

      {/* Git sync modal */}
      {syncOpen && projectId && (
        <GitSyncModal
          projectId={projectId}
          projectName={data?.project.display_name ?? projectSlug ?? ''}
          onClose={() => setSyncOpen(false)}
          onApplied={() => {
            queryClient.invalidateQueries({ queryKey: ['catalog', projectSlug] })
            queryClient.invalidateQueries({ queryKey: ['gitSyncStatus', projectId] })
          }}
        />
      )}
    </div>
  )
}
