import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { getTemplate, getTemplateContent } from '../../api/templates'
import TemplateEditor from '../../components/TemplateEditor'

export default function TemplateEditorPage() {
  const { templateId } = useParams<{ templateId: string }>()
  const id = Number(templateId)

  const { data: template, isLoading: templateLoading, error } = useQuery({
    queryKey: ['template', id],
    queryFn: () => getTemplate(id),
    enabled: !!id,
  })

  const { data: content, isLoading: contentLoading } = useQuery({
    queryKey: ['template-content', id],
    queryFn: () => getTemplateContent(id),
    enabled: !!id,
  })

  if (templateLoading || contentLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm p-6">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading template…
      </div>
    )
  }

  if (error || !template) {
    return (
      <div className="p-6">
        <div className="text-red-600 text-sm bg-red-50 rounded-lg p-4 border border-red-200">
          Failed to load template.
        </div>
        <Link to="/admin/templates" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
          ← Back to templates
        </Link>
      </div>
    )
  }

  return (
    // Full-height layout: subtract the Layout's own padding/header
    <div className="-mx-6 -my-6 h-[calc(100vh-4rem)] flex flex-col">
      <TemplateEditor template={template} initialContent={content ?? ''} />
    </div>
  )
}
