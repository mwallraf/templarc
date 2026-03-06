import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import { DndContext, type DragEndEvent, type DragOverEvent, DragOverlay } from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { editor as MonacoEditor, IPosition } from 'monaco-editor'
import { getTemplateVariables, updateTemplate } from '../../api/templates'
import { listParameters } from '../../api/parameters'
import { listSecrets } from '../../api/auth'
import type { ParameterOut, TemplateOut, VariableRefOut } from '../../api/types'
import type { DataSourceDef } from './DataSourceForm'
import { ParameterPanel } from './ParameterPanel'
import { PreviewModal } from './PreviewModal'
import { Toast, type ToastState } from './Toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TemplateEditorProps {
  template: TemplateOut
  initialContent?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFrontmatter(
  params: ParameterOut[],
  dataSources: DataSourceDef[],
): string {
  if (params.length === 0 && dataSources.length === 0) return ''
  let yaml = '---\n'

  if (params.length > 0) {
    yaml += 'parameters:\n'
    for (const p of params) {
      yaml += `  - name: ${p.name}\n`
      yaml += `    widget: ${p.widget_type}\n`
      if (p.label) yaml += `    label: "${p.label}"\n`
      if (p.description) yaml += `    description: "${p.description}"\n`
      if (p.help_text) yaml += `    help_text: "${p.help_text}"\n`
      if (p.required) yaml += `    required: true\n`
      if (p.default_value) yaml += `    default_value: "${p.default_value}"\n`
      if (p.is_derived && p.derived_expression) {
        yaml += `    derived: "${p.derived_expression}"\n`
      }
    }
  }

  if (dataSources.length > 0) {
    yaml += 'data_sources:\n'
    for (const ds of dataSources) {
      yaml += `  - id: ${ds.id}\n`
      yaml += `    url: "${ds.url}"\n`
      if (ds.auth) yaml += `    auth: "${ds.auth}"\n`
      if (ds.trigger) yaml += `    trigger: ${ds.trigger}\n`
      if (ds.on_error && ds.on_error !== 'warn') yaml += `    on_error: ${ds.on_error}\n`
      if (ds.cache_ttl) yaml += `    cache_ttl: ${ds.cache_ttl}\n`
      if (ds.mapping.length > 0) {
        yaml += `    mapping:\n`
        for (const m of ds.mapping) {
          yaml += `      - remote_field: "${m.remote_field}"\n`
          yaml += `        to_parameter: ${m.to_parameter}\n`
          if (m.auto_fill) yaml += `        auto_fill: true\n`
        }
      }
    }
  }

  yaml += '---\n'
  return yaml
}

// ── Monaco droppable wrapper ──────────────────────────────────────────────────

function MonacoDropZone({ children, isOver }: { children: React.ReactNode; isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id: 'monaco-editor' })
  return (
    <div
      ref={setNodeRef}
      className={`h-full transition-colors ${
        isOver ? 'ring-2 ring-inset ring-indigo-400' : ''
      }`}
    >
      {children}
    </div>
  )
}

// ── Validate panel ────────────────────────────────────────────────────────────

function ValidationPanel({
  variables,
  onClose,
}: {
  variables: VariableRefOut[]
  onClose: () => void
}) {
  const registered = variables.filter((v) => v.is_registered)
  const unregistered = variables.filter((v) => !v.is_registered)

  return (
    <div className="border-t border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Template variables (saved version)
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">
          ×
        </button>
      </div>
      <div className="flex gap-6 p-3">
        {unregistered.length > 0 && (
          <div className="flex-1">
            <p className="text-xs font-medium text-red-600 mb-1.5">
              Unregistered ({unregistered.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {unregistered.map((v) => (
                <span
                  key={v.full_path}
                  className="font-mono text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded"
                >
                  {'{{ '}
                  {v.full_path}
                  {' }}'}
                </span>
              ))}
            </div>
          </div>
        )}
        {registered.length > 0 && (
          <div className="flex-1">
            <p className="text-xs font-medium text-green-600 mb-1.5">
              Registered ({registered.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {registered.map((v) => (
                <span
                  key={v.full_path}
                  className="font-mono text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded"
                >
                  {'{{ '}
                  {v.full_path}
                  {' }}'}
                </span>
              ))}
            </div>
          </div>
        )}
        {variables.length === 0 && (
          <p className="text-xs text-gray-400 italic">No variables found in saved template.</p>
        )}
      </div>
    </div>
  )
}

// ── Main TemplateEditor ───────────────────────────────────────────────────────

export default function TemplateEditor({ template, initialContent = '' }: TemplateEditorProps) {
  const qc = useQueryClient()

  // Monaco editor instance ref
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const lastCursorRef = useRef<IPosition | null>(null)

  // Editor content (template body only — frontmatter is built from state on save)
  const [editorContent, setEditorContent] = useState(initialContent)

  // Parameters currently assigned to this template
  const [assignedParams, setAssignedParams] = useState<ParameterOut[]>([])
  const [dataSources, setDataSources] = useState<DataSourceDef[]>([])
  const [parentTemplateId, setParentTemplateId] = useState<number | undefined>(
    template.parent_template_id ?? undefined,
  )

  // Metadata
  const [metaDisplayName, setMetaDisplayName] = useState(template.display_name)
  const [metaDescription, setMetaDescription] = useState(template.description ?? '')
  const [metaSortOrder, setMetaSortOrder] = useState(template.sort_order)

  // UI state
  const [showPreview, setShowPreview] = useState(false)
  const [showValidate, setShowValidate] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [activeDragParam, setActiveDragParam] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [commitMessage, setCommitMessage] = useState('')

  // Fetch initial template parameters from API
  const { data: templateParamsData } = useQuery({
    queryKey: ['parameters', 'template', template.id],
    queryFn: () => listParameters({ template_id: template.id, page_size: 200 }),
  })

  useEffect(() => {
    if (templateParamsData && assignedParams.length === 0) {
      setAssignedParams(templateParamsData.items)
    }
  }, [templateParamsData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Secrets for data source auth picker
  const { data: secretsData } = useQuery({
    queryKey: ['secrets'],
    queryFn: listSecrets,
  })

  // Variables for validation panel (reads from saved Git version)
  const validateQuery = useQuery({
    queryKey: ['template-variables', template.id],
    queryFn: () => getTemplateVariables(template.id),
    enabled: false,
  })

  // Save mutation
  const saveMut = useMutation({
    mutationFn: () => {
      const frontmatter = buildFrontmatter(assignedParams, dataSources)
      const fullContent = frontmatter + editorContent
      return updateTemplate(template.id, {
        content: fullContent,
        parent_template_id: parentTemplateId,
        display_name: metaDisplayName || undefined,
        description: metaDescription || undefined,
        sort_order: metaSortOrder,
        commit_message: commitMessage || undefined,
        author: 'admin',
      })
    },
    onSuccess: (result) => {
      setToast({
        variant: 'success',
        message: 'Template saved',
        detail: `git ${result.template.updated_at}`,
      })
      setCommitMessage('')
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['template', template.id] })
    },
    onError: (err) => {
      setToast({
        variant: 'error',
        message: 'Save failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      })
    },
  })

  // ── Insert at cursor ──────────────────────────────────────────────────────

  const insertAtCursor = useCallback((text: string) => {
    const editor = editorRef.current
    if (!editor) return
    const pos = lastCursorRef.current ?? editor.getPosition()
    if (!pos) return
    editor.executeEdits('template-editor', [
      {
        range: {
          startLineNumber: pos.lineNumber,
          startColumn: pos.column,
          endLineNumber: pos.lineNumber,
          endColumn: pos.column,
        },
        text,
      },
    ])
    editor.focus()
  }, [])

  // ── dnd-kit handlers ──────────────────────────────────────────────────────

  function handleDragStart(event: DragOverEvent) {
    setActiveDragParam((event.active.data.current as { paramName?: string })?.paramName ?? null)
  }

  function handleDragOver(event: DragOverEvent) {
    setIsDragOver(event.over?.id === 'monaco-editor')
  }

  function handleDragEnd(event: DragEndEvent) {
    setIsDragOver(false)
    setActiveDragParam(null)

    const paramName = event.active.data.current?.paramName as string | undefined
    if (!paramName) return

    if (event.over?.id === 'monaco-editor') {
      insertAtCursor(`{{ ${paramName} }}`)
    }
  }

  // ── Parameter panel callbacks ─────────────────────────────────────────────

  function handleAssignParam(param: ParameterOut) {
    if (!assignedParams.find((p) => p.id === param.id)) {
      setAssignedParams((prev) => [...prev, param])
    }
    insertAtCursor(`{{ ${param.name} }}`)
  }

  function handleUnassignParam(paramId: number) {
    setAssignedParams((prev) => prev.filter((p) => p.id !== paramId))
  }

  function handleAddDs(ds: DataSourceDef) {
    setDataSources((prev) => [...prev.filter((d) => d.id !== ds.id), ds])
  }

  function handleRemoveDs(id: string) {
    setDataSources((prev) => prev.filter((d) => d.id !== id))
  }

  function handleUpdateDs(id: string, ds: DataSourceDef) {
    setDataSources((prev) => prev.map((d) => (d.id === id ? ds : d)))
  }

  async function handleValidate() {
    setShowValidate(true)
    await validateQuery.refetch()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DndContext
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full">
        {/* ── Toolbar ──────────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0"
          style={{ backgroundColor: '#0a0d1a', borderColor: '#1e2440' }}
        >
          <Link
            to="/admin/templates"
            className="flex items-center gap-1 text-xs font-medium transition-colors mr-1"
            style={{ color: '#546485' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#8892b0')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#546485')}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Templates
          </Link>

          <span style={{ color: '#2a3255' }}>|</span>

          <h2 className="font-semibold text-sm mr-1" style={{ color: '#e2e8f4' }}>{metaDisplayName || template.display_name}</h2>

          <span style={{ color: '#2a3255' }}>|</span>

          <button
            onClick={handleValidate}
            disabled={validateQuery.isFetching}
            className="px-3 py-1.5 text-xs rounded-md transition-colors disabled:opacity-50"
            style={{ border: '1px solid #2a3255', color: '#8892b0', backgroundColor: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {validateQuery.isFetching ? 'Checking…' : 'Validate'}
          </button>

          <button
            onClick={() => setShowPreview(true)}
            className="px-3 py-1.5 text-xs rounded-md transition-colors"
            style={{ border: '1px solid #2a3255', color: '#8892b0', backgroundColor: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Preview Form
          </button>

          <div className="flex-1" />

          {/* Commit message */}
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message (optional)"
            className="w-56 rounded-md px-2.5 py-1.5 text-xs focus:outline-none"
            style={{
              backgroundColor: '#141828',
              border: '1px solid #2a3255',
              color: '#e2e8f4',
            }}
          />

          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="px-4 py-1.5 text-white text-xs font-semibold rounded-md disabled:opacity-50 transition-all"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
            }}
          >
            {saveMut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>

        {/* ── Split view ────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">
          {/* Left: Monaco editor — 60% */}
          <div className="w-[60%] flex flex-col min-h-0">
            <MonacoDropZone isOver={isDragOver}>
              <Editor
                height="100%"
                language="python"
                theme="vs-dark"
                value={editorContent}
                onChange={(val) => setEditorContent(val ?? '')}
                onMount={(editor) => {
                  editorRef.current = editor
                  editor.onDidChangeCursorPosition((e) => {
                    lastCursorRef.current = e.position
                  })
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  tabSize: 2,
                  renderWhitespace: 'boundary',
                  padding: { top: 12 },
                }}
              />
            </MonacoDropZone>

            {/* Validation panel */}
            {showValidate && validateQuery.data && (
              <ValidationPanel
                variables={validateQuery.data}
                onClose={() => setShowValidate(false)}
              />
            )}
          </div>

          {/* Right: Parameter panel — 40% */}
          <div className="w-[40%] flex flex-col min-h-0 overflow-hidden">
            <ParameterPanel
              templateId={template.id}
              projectId={template.project_id}
              secrets={secretsData ?? []}
              assignedParams={assignedParams}
              dataSources={dataSources}
              parentTemplateId={parentTemplateId}
              metaDisplayName={metaDisplayName}
              metaDescription={metaDescription}
              metaSortOrder={metaSortOrder}
              onChangeDisplayName={setMetaDisplayName}
              onChangeDescription={setMetaDescription}
              onChangeSortOrder={setMetaSortOrder}
              onAssignParam={handleAssignParam}
              onUnassignParam={handleUnassignParam}
              onSetParent={setParentTemplateId}
              onAddDataSource={handleAddDs}
              onRemoveDataSource={handleRemoveDs}
              onUpdateDataSource={handleUpdateDs}
            />
          </div>
        </div>
      </div>

      {/* Drag overlay — ghost preview while dragging */}
      <DragOverlay>
        {activeDragParam && (
          <div className="bg-indigo-600 text-white text-xs font-mono px-3 py-1.5 rounded-md shadow-lg opacity-90 pointer-events-none">
            {'{{ '}
            {activeDragParam}
            {' }}'}
          </div>
        )}
      </DragOverlay>

      {/* Preview modal */}
      {showPreview && (
        <PreviewModal templateId={template.id} onClose={() => setShowPreview(false)} />
      )}

      {/* Toast */}
      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </DndContext>
  )
}
