import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { resolveParams } from '../../api/render'
import { getTemplateVariables } from '../../api/templates'
import DynamicForm from '../DynamicForm'

interface PreviewModalProps {
  templateId: number
  onClose: () => void
}

export function PreviewModal({ templateId, onClose }: PreviewModalProps) {
  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { data: definition, isLoading, error } = useQuery({
    queryKey: ['resolve-params', templateId],
    queryFn: () => resolveParams(templateId),
  })

  const { data: variableRefs } = useQuery({
    queryKey: ['template-variables', templateId],
    queryFn: () => getTemplateVariables(templateId),
    staleTime: 60_000,
  })

  const filteredDefinition = (() => {
    if (!definition) return definition
    if (!variableRefs || variableRefs.length === 0) return definition
    const usedNames = new Set(variableRefs.map((v) => v.full_path))
    const filtered = definition.parameters.filter((p) =>
      p.scope === 'template' || usedNames.has(p.name)
    )
    return { ...definition, parameters: filtered }
  })()

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div>
            <h2 className="font-semibold text-gray-900">Form Preview</h2>
            <p className="text-xs text-gray-500 mt-0.5">This is what users will see</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {isLoading && (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-8 justify-center">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading form definition…
            </div>
          )}

          {error && (
            <div className="text-red-600 text-sm bg-red-50 rounded-lg p-4">
              Failed to load form definition. Save the template first.
            </div>
          )}

          {filteredDefinition && (
            <DynamicForm
              templateId={templateId}
              definition={filteredDefinition}
              persist={false}
              user="preview"
            />
          )}
        </div>
      </div>
    </div>
  )
}
