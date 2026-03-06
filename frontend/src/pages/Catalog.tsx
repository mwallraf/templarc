import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { listProjects } from '../api/catalog'

export default function Catalog() {
  const { data: projects, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  })

  if (isLoading) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-8">
          <div className="skeleton h-8 w-48" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-32 rounded-xl" />
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
        Failed to load projects.
      </div>
    )
  }

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-white font-display">Template Catalog</h1>
        <p className="text-sm mt-1" style={{ color: '#546485' }}>
          Browse and render templates across all projects
        </p>
      </div>

      {projects?.length === 0 ? (
        <div
          className="rounded-xl border border-dashed px-6 py-16 text-center"
          style={{ borderColor: '#2a3255' }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3"
            style={{ backgroundColor: '#141828' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5" style={{ color: '#3d4777' }}>
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: '#546485' }}>No projects found</p>
          <p className="text-xs mt-1" style={{ color: '#3d4777' }}>Create a project from the admin panel to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects?.map((project) => (
            <Link
              key={project.id}
              to={`/catalog/${project.name}`}
              className="card-hover block rounded-xl border p-5 group"
              style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}
            >
              {/* Icon */}
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                style={{ backgroundColor: '#141828', border: '1px solid #2a3255' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4" style={{ color: '#6366f1' }}>
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>

              <h2 className="font-semibold text-slate-100 text-sm group-hover:text-white transition-colors">
                {project.display_name}
              </h2>
              {project.description && (
                <p className="text-xs mt-1.5 line-clamp-2" style={{ color: '#546485' }}>
                  {project.description}
                </p>
              )}
              <div className="flex items-center gap-1 mt-3 text-xs font-medium" style={{ color: '#6366f1' }}>
                Browse templates
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 transition-transform group-hover:translate-x-0.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
