import { useQuery } from '@tanstack/react-query'
import { useParams, useLocation, Link } from 'react-router-dom'
import { resolveParams } from '../api/render'
import { getTemplate } from '../api/templates'
import DynamicForm from '../components/DynamicForm'

function Spinner() {
  return (
    <div className="flex items-center gap-2.5 text-sm py-12" style={{ color: '#546485' }}>
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Loading template…
    </div>
  )
}

export default function RenderPage() {
  const { templateId } = useParams<{ templateId: string }>()
  const location = useLocation()
  const prefillValues = (location.state as { prefill?: Record<string, unknown> })?.prefill

  const id = Number(templateId)

  const {
    data: template,
    isLoading: templateLoading,
    error: templateError,
  } = useQuery({
    queryKey: ['template', id],
    queryFn: () => getTemplate(id),
    enabled: !!id,
  })

  const {
    data: definition,
    isLoading: defLoading,
    error: defError,
  } = useQuery({
    queryKey: ['resolve-params', id],
    queryFn: () => resolveParams(id),
    enabled: !!id,
  })

  const isLoading = templateLoading || defLoading
  const error = templateError || defError

  if (isLoading) return <Spinner />

  if (error || !template || !definition) {
    return (
      <div
        className="rounded-xl border px-4 py-3 text-sm text-red-400"
        style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }}
      >
        Failed to load template. Make sure the API is running.
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs mb-3" style={{ color: '#3d4777' }}>
          <Link to="/catalog" className="hover:text-indigo-400 transition-colors">
            Catalog
          </Link>
          <span>›</span>
          <span className="font-mono" style={{ color: '#546485' }}>{template.name}</span>
          <span
            className="ml-auto font-mono text-xs px-2 py-0.5 rounded border"
            style={{ backgroundColor: '#141828', borderColor: '#2a3255', color: '#546485' }}
          >
            {definition.parameters.length} param{definition.parameters.length !== 1 ? 's' : ''}
          </span>
        </div>

        <h1 className="text-2xl font-bold text-white font-display">{template.display_name}</h1>
        {template.description && (
          <p className="text-sm mt-1.5" style={{ color: '#546485' }}>{template.description}</p>
        )}
      </div>

      {definition.parameters.length === 0 ? (
        <div
          className="rounded-xl border p-5"
          style={{ backgroundColor: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.2)' }}
        >
          <p className="text-sm text-amber-300">
            This template has no registered parameters. Click Render to generate with defaults.
          </p>
          <div className="mt-4">
            <button
              className="px-5 py-2 text-sm font-semibold text-white rounded-lg transition-all duration-150"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
              }}
            >
              Render
            </button>
          </div>
        </div>
      ) : (
        <DynamicForm
          templateId={id}
          definition={definition}
          prefillValues={prefillValues}
        />
      )}
    </div>
  )
}
