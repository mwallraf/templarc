import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { getCatalog } from '../api/catalog'
import { gitSyncStatus } from '../api/templates'
import { getMe } from '../api/auth'
import GitSyncModal from '../components/GitSyncModal'
import type { CatalogTemplateItem } from '../api/types'

function TemplateCard({ template }: { template: CatalogTemplateItem }) {
  return (
    <Link
      to={`/render/${template.id}`}
      className="card-hover block rounded-xl border p-4 group"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <div className="flex items-start justify-between gap-2">
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
        <p className="text-xs mt-1.5 font-mono" style={{ color: 'var(--c-muted-4)' }}>
          {template.breadcrumb.join(' › ')}
        </p>
      )}

      {template.description && (
        <p className="text-xs mt-2 line-clamp-2" style={{ color: 'var(--c-muted-3)' }}>
          {template.description}
        </p>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: 'var(--c-border)' }}>
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

export default function ProjectCatalog() {
  const { projectSlug } = useParams<{ projectSlug: string }>()
  const queryClient = useQueryClient()
  const [syncOpen, setSyncOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['catalog', projectSlug],
    queryFn: () => getCatalog(projectSlug!),
    enabled: !!projectSlug,
  })

  // Who is the current user — needed to conditionally show the sync button
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    staleTime: 5 * 60_000,
  })

  // Background drift check — runs once when we know the project id
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

  const leafTemplates = data?.templates.filter((t) => t.is_leaf) ?? []
  const nonLeaf = data?.templates.filter((t) => !t.is_leaf) ?? []

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

        {/* Sync from Git button — admin only */}
        {me?.is_admin && projectId && (
          <button
            onClick={() => setSyncOpen(true)}
            className="relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all shrink-0"
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
            {/* Drift indicator dot */}
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
        )}
      </div>

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

      {leafTemplates.length > 0 && (
        <div>
          <h2
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: 'var(--c-muted-4)' }}
          >
            Templates
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {leafTemplates.map((t) => (
              <TemplateCard key={t.id} template={t} />
            ))}
          </div>
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
            // Refetch catalog and drift status so UI updates immediately
            queryClient.invalidateQueries({ queryKey: ['catalog', projectSlug] })
            queryClient.invalidateQueries({ queryKey: ['gitSyncStatus', projectId] })
          }}
        />
      )}
    </div>
  )
}
