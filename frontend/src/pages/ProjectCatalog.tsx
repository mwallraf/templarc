import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { getCatalog } from '../api/catalog'
import type { CatalogTemplateItem } from '../api/types'

function TemplateCard({ template }: { template: CatalogTemplateItem }) {
  return (
    <Link
      to={`/render/${template.id}`}
      className="card-hover block rounded-xl border p-4 group"
      style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}
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
        <p className="text-xs mt-1.5 font-mono" style={{ color: '#3d4777' }}>
          {template.breadcrumb.join(' › ')}
        </p>
      )}

      {template.description && (
        <p className="text-xs mt-2 line-clamp-2" style={{ color: '#546485' }}>
          {template.description}
        </p>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: '#1e2440' }}>
        <span className="text-xs" style={{ color: '#3d4777' }}>
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
      style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: '#141828', border: '1px solid #2a3255' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4" style={{ color: '#8892b0' }}>
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-200 text-sm leading-snug truncate">
            {template.display_name}
          </h3>
          {template.description && (
            <p className="text-xs mt-0.5 truncate" style={{ color: '#546485' }}>
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

  const { data, isLoading, error } = useQuery({
    queryKey: ['catalog', projectSlug],
    queryFn: () => getCatalog(projectSlug!),
    enabled: !!projectSlug,
  })

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
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-white font-display">
          {data?.project.display_name}
        </h1>
        {data?.project.description && (
          <p className="text-sm mt-1" style={{ color: '#546485' }}>
            {data.project.description}
          </p>
        )}
      </div>

      {nonLeaf.length > 0 && (
        <div className="mb-7">
          <h2
            className="text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: '#3d4777' }}
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
            style={{ color: '#3d4777' }}
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
          style={{ borderColor: '#2a3255' }}
        >
          <p className="text-sm" style={{ color: '#546485' }}>No templates in this project yet.</p>
          <Link to="/admin/templates" className="text-xs text-indigo-400 hover:text-indigo-300 mt-2 inline-block transition-colors">
            Add templates in the admin panel →
          </Link>
        </div>
      )}
    </div>
  )
}
