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
import { listFilters } from '../../api/admin'
import type { CustomFilterOut, ParameterOut, TemplateOut, VariableRefOut } from '../../api/types'
import type { DataSourceDef } from './DataSourceForm'
import { ParameterPanel } from './ParameterPanel'
import { PreviewModal } from './PreviewModal'
import { Toast, type ToastState } from './Toast'
import AiAssistModal, { type InsertMode } from '../AiAssistModal'

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

// ── Validate modal ────────────────────────────────────────────────────────────

function ValidateModal({
  variables,
  isLoading,
  onClose,
}: {
  variables: VariableRefOut[] | undefined
  isLoading: boolean
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const registered = variables?.filter((v) => v.is_registered) ?? []
  const unregistered = variables?.filter((v) => !v.is_registered) ?? []
  const total = variables?.length ?? 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-12"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-2xl mx-4 rounded-2xl border overflow-hidden"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3.5 border-b"
          style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}
        >
          <div className="flex items-center gap-3">
            <svg className="w-4 h-4 shrink-0" style={{ color: '#6366f1' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>Template Variables</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted-4)' }}>Scanned from the saved Git version</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors text-lg leading-none"
            style={{ color: 'var(--c-muted-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-muted-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-3)')}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {isLoading && (
            <div className="flex items-center gap-2 justify-center py-10 text-sm" style={{ color: 'var(--c-muted-3)' }}>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Scanning template variables…
            </div>
          )}

          {!isLoading && variables !== undefined && (
            <>
              {/* Summary bar */}
              <div
                className="flex items-center gap-5 rounded-xl px-4 py-3 mb-5 border"
                style={{ backgroundColor: 'var(--c-base)', borderColor: 'var(--c-border)' }}
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold font-display" style={{ color: 'var(--c-text)' }}>{total}</span>
                  <span className="text-xs" style={{ color: 'var(--c-muted-3)' }}>total</span>
                </div>
                <div className="w-px h-8" style={{ backgroundColor: 'var(--c-border)' }} />
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold font-display" style={{ color: registered.length > 0 ? '#34d399' : 'var(--c-muted-4)' }}>{registered.length}</span>
                  <span className="text-xs" style={{ color: 'var(--c-muted-3)' }}>registered</span>
                </div>
                <div className="w-px h-8" style={{ backgroundColor: 'var(--c-border)' }} />
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold font-display" style={{ color: unregistered.length > 0 ? '#f87171' : 'var(--c-muted-4)' }}>{unregistered.length}</span>
                  <span className="text-xs" style={{ color: 'var(--c-muted-3)' }}>unregistered</span>
                </div>
                {unregistered.length === 0 && total > 0 && (
                  <span className="ml-auto text-xs font-medium px-2.5 py-1 rounded-full border" style={{ backgroundColor: 'rgba(52,211,153,0.08)', borderColor: 'rgba(52,211,153,0.2)', color: '#34d399' }}>
                    All registered ✓
                  </span>
                )}
              </div>

              {/* Unregistered */}
              {unregistered.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: '#f87171' }}>
                    Unregistered — need a parameter definition
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unregistered.map((v) => (
                      <span
                        key={v.full_path}
                        className="font-mono text-xs px-2.5 py-1 rounded-lg border"
                        style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', color: '#fca5a5' }}
                      >
                        {'{{'}
                        <span className="mx-0.5 opacity-60"> </span>
                        {v.full_path}
                        <span className="mx-0.5 opacity-60"> </span>
                        {'}}'}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Registered */}
              {registered.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: '#34d399' }}>
                    Registered
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {registered.map((v) => (
                      <span
                        key={v.full_path}
                        className="font-mono text-xs px-2.5 py-1 rounded-lg border"
                        style={{ backgroundColor: 'rgba(52,211,153,0.06)', borderColor: 'rgba(52,211,153,0.18)', color: '#6ee7b7' }}
                      >
                        {'{{'}
                        <span className="mx-0.5 opacity-60"> </span>
                        {v.full_path}
                        <span className="mx-0.5 opacity-60"> </span>
                        {'}}'}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {total === 0 && (
                <p className="text-sm text-center py-6" style={{ color: 'var(--c-muted-4)' }}>
                  No Jinja2 variables found in the saved template body.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Snippet toolbar ───────────────────────────────────────────────────────────

const JINJA_SNIPPETS: { label: string; insert: string; title: string }[] = [
  { label: '{{ }}',       insert: '{{ variable }}',                                    title: 'Variable expression' },
  { label: '{% if %}',    insert: '{% if condition %}\n\n{% endif %}',                 title: 'If / endif block' },
  { label: '{% elif %}',  insert: '{% elif condition %}',                              title: 'Elif branch' },
  { label: '{% else %}',  insert: '{% else %}',                                        title: 'Else branch' },
  { label: '{% for %}',   insert: '{% for item in items %}\n{{ item }}\n{% endfor %}', title: 'For loop' },
  { label: '{% set %}',   insert: '{% set var = value %}',                             title: 'Set variable' },
  { label: '{% include %}', insert: "{% include 'shared/file.j2' %}",                 title: 'Include fragment' },
  { label: '| default',  insert: " | default('')",                                    title: 'Default filter' },
  { label: '| join',     insert: " | join(', ')",                                     title: 'Join list' },
  { label: '| upper',    insert: ' | upper',                                           title: 'Uppercase' },
  { label: '| lower',    insert: ' | lower',                                           title: 'Lowercase' },
  { label: '| replace',  insert: " | replace('old', 'new')",                          title: 'Replace string' },
]

function SnippetToolbar({ onInsert }: { onInsert: (text: string) => void }) {
  const chipBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'monospace',
    fontSize: '11px',
    padding: '1px 7px',
    borderRadius: '4px',
    cursor: 'pointer',
    border: '1px solid',
    transition: 'opacity 0.1s',
    whiteSpace: 'nowrap',
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-1 gap-y-1 px-3 py-1.5 border-b shrink-0"
      style={{ backgroundColor: 'var(--c-base)', borderColor: 'var(--c-surface-alt)' }}
    >
      {JINJA_SNIPPETS.map((s) => (
        <button
          key={s.label}
          type="button"
          title={s.title}
          onClick={() => onInsert(s.insert)}
          style={{
            ...chipBase,
            color: '#818cf8',
            backgroundColor: 'rgba(99,102,241,0.08)',
            borderColor: 'rgba(99,102,241,0.2)',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.75' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
        >
          {s.label}
        </button>
      ))}
      <span style={{ fontSize: '10px', color: 'var(--c-border-bright)', marginLeft: '4px', userSelect: 'none' }}>
        type <span style={{ color: 'var(--c-muted-4)', fontFamily: 'monospace' }}>|</span> for filter autocomplete
      </span>
    </div>
  )
}

// ── Jinja2 built-in filter completions ────────────────────────────────────────

const JINJA2_BUILTIN_FILTERS: { name: string; doc: string; snippet?: string }[] = [
  { name: 'abs',            doc: 'Return the absolute value of the argument.' },
  { name: 'capitalize',     doc: 'Capitalize: first character uppercase, all others lowercase.' },
  { name: 'center',         doc: 'Center the value in a field of given width.', snippet: 'center(${1:80})' },
  { name: 'default',        doc: "Return a default value if the value is undefined or falsy.", snippet: "default('${1:}')" },
  { name: 'd',              doc: "Alias for default.", snippet: "d('${1:}')" },
  { name: 'dictsort',       doc: 'Sort a dict and yield (key, value) pairs.' },
  { name: 'escape',         doc: 'Convert &, <, >, \', " to HTML-safe sequences.' },
  { name: 'e',              doc: 'Alias for escape.' },
  { name: 'filesizeformat', doc: 'Format the value as a human-readable file size (e.g. "1.2 MB").' },
  { name: 'first',          doc: 'Return the first item of a sequence.' },
  { name: 'float',          doc: 'Convert the value into a floating point number.' },
  { name: 'forceescape',    doc: 'Enforce HTML escaping, even if auto-escaping is disabled.' },
  { name: 'format',         doc: 'Apply printf-style formatting to the value.', snippet: 'format(${1:})' },
  { name: 'groupby',        doc: 'Group a sequence of objects by an attribute.', snippet: "groupby('${1:attribute}')" },
  { name: 'indent',         doc: 'Add spaces in front of each line (first line optional).', snippet: 'indent(${1:4})' },
  { name: 'int',            doc: 'Convert the value into an integer.' },
  { name: 'items',          doc: 'Return an iterator over the (key, value) pairs of a dict.' },
  { name: 'join',           doc: "Concatenate items in a sequence with a separator.", snippet: "join('${1:, }')" },
  { name: 'last',           doc: 'Return the last item of a sequence.' },
  { name: 'length',         doc: 'Return the number of items of a sequence or mapping.' },
  { name: 'count',          doc: 'Alias for length.' },
  { name: 'list',           doc: 'Convert the value into a list.' },
  { name: 'lower',          doc: 'Convert a value to lowercase.' },
  { name: 'map',            doc: 'Apply a filter on a sequence of objects.', snippet: "map(attribute='${1:attr}')" },
  { name: 'max',            doc: 'Return the largest item from the sequence.' },
  { name: 'min',            doc: 'Return the smallest item from the sequence.' },
  { name: 'pprint',         doc: 'Pretty print a variable (useful for debugging).' },
  { name: 'random',         doc: 'Return a random item from the sequence.' },
  { name: 'reject',         doc: 'Filter a sequence, removing items that pass the test.', snippet: "reject('${1:test}')" },
  { name: 'rejectattr',     doc: 'Filter a sequence of objects, removing those where the attribute passes the test.', snippet: "rejectattr('${1:attr}')" },
  { name: 'replace',        doc: 'Replace occurrences of a substring.', snippet: "replace('${1:old}', '${2:new}')" },
  { name: 'reverse',        doc: 'Reverse the object or return a reversed iterator.' },
  { name: 'round',          doc: 'Round the number to a given precision.', snippet: 'round(${1:0})' },
  { name: 'safe',           doc: 'Mark the value as safe — it will not be HTML-escaped.' },
  { name: 'select',         doc: 'Filter a sequence, keeping items that pass the test.', snippet: "select('${1:test}')" },
  { name: 'selectattr',     doc: 'Filter a sequence of objects, keeping those where the attribute passes the test.', snippet: "selectattr('${1:attr}')" },
  { name: 'slice',          doc: 'Slice an iterator and return a list of lists.', snippet: 'slice(${1:3})' },
  { name: 'sort',           doc: 'Sort an iterable.', snippet: "sort(attribute='${1:attr}')" },
  { name: 'string',         doc: 'Convert the object to a string.' },
  { name: 'striptags',      doc: 'Strip SGML/XML tags and replace adjacent whitespace.' },
  { name: 'sum',            doc: 'Return the sum of a sequence of numbers.', snippet: "sum(attribute='${1:attr}')" },
  { name: 'title',          doc: 'Return a titlecased version of the value.' },
  { name: 'tojson',         doc: 'Serialize an object to a JSON string.', snippet: 'tojson(indent=${1:2})' },
  { name: 'trim',           doc: 'Strip leading and trailing whitespace.' },
  { name: 'truncate',       doc: 'Return a truncated copy of the string.', snippet: 'truncate(${1:255})' },
  { name: 'unique',         doc: 'Return a list of unique items from the iterable.' },
  { name: 'upper',          doc: 'Convert a value to uppercase.' },
  { name: 'urlencode',      doc: 'Percent-encode a string for use in a URL.' },
  { name: 'urlize',         doc: 'Convert URLs in plain text into clickable HTML links.' },
  { name: 'wordcount',      doc: 'Count the words in the string.' },
  { name: 'wordwrap',       doc: "Wrap the string's words at the given width.", snippet: 'wordwrap(${1:79})' },
  { name: 'xmlattr',        doc: 'Build an HTML/XML attribute string from a dict.' },
]

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
  const [showAI, setShowAI] = useState(false)
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

  // Custom filters — for Monaco IntelliSense completion
  const { data: customFilters = [] } = useQuery({
    queryKey: ['filters', template.project_id],
    queryFn: () => listFilters({ project_id: template.project_id }),
    select: (data) => data.filter((f) => f.is_active),
  })

  // Keep a ref so the completion provider always reads fresh data without re-registering
  const customFiltersRef = useRef<CustomFilterOut[]>(customFilters)
  useEffect(() => { customFiltersRef.current = customFilters }, [customFilters])

  // Disposable for the Monaco completion provider — cleaned up on unmount
  const completionDisposableRef = useRef<{ dispose(): void } | null>(null)
  useEffect(() => () => { completionDisposableRef.current?.dispose() }, [])

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

  function handleAIAccept(text: string, mode: InsertMode) {
    if (mode === 'replace') {
      setEditorContent(text)
    } else if (mode === 'append') {
      setEditorContent((prev) => (prev ? prev + '\n' + text : text))
    } else {
      insertAtCursor(text)
    }
    setShowAI(false)
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
          style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}
        >
          <Link
            to="/admin/templates"
            className="flex items-center gap-1 text-xs font-medium transition-colors mr-1"
            style={{ color: 'var(--c-muted-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-muted-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-3)')}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Templates
          </Link>

          <span style={{ color: 'var(--c-border-bright)' }}>|</span>

          <h2 className="font-semibold text-sm mr-1" style={{ color: 'var(--c-text)' }}>{metaDisplayName || template.display_name}</h2>

          <span style={{ color: 'var(--c-border-bright)' }}>|</span>

          <button
            onClick={handleValidate}
            disabled={validateQuery.isFetching}
            className="px-3 py-1.5 text-xs rounded-md transition-colors disabled:opacity-50"
            style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)', backgroundColor: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {validateQuery.isFetching ? 'Checking…' : 'Validate'}
          </button>

          <button
            onClick={() => setShowPreview(true)}
            className="px-3 py-1.5 text-xs rounded-md transition-colors"
            style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)', backgroundColor: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Preview Form
          </button>

          <button
            onClick={() => setShowAI(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all"
            style={{
              background: 'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(168,85,247,0.15))',
              border: '1px solid rgba(99,102,241,0.35)',
              color: '#a5b4fc',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.6)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.35)' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            AI
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
              backgroundColor: 'var(--c-card)',
              border: '1px solid var(--c-border-bright)',
              color: 'var(--c-text)',
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
            <SnippetToolbar onInsert={insertAtCursor} />
            <MonacoDropZone isOver={isDragOver}>
              <Editor
                height="100%"
                language="python"
                theme="vs-dark"
                value={editorContent}
                onChange={(val) => setEditorContent(val ?? '')}
                onMount={(editor, monaco) => {
                  editorRef.current = editor
                  editor.onDidChangeCursorPosition((e) => {
                    lastCursorRef.current = e.position
                  })

                  // Register Jinja2 filter completion provider (triggers on |)
                  completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('python', {
                    triggerCharacters: ['|'],
                    provideCompletionItems: (model, position) => {
                      // Only activate when the text before the cursor ends with | (optionally with spaces)
                      const textBefore = model.getLineContent(position.lineNumber).substring(0, position.column - 1)
                      if (!/\|\s*\w*$/.test(textBefore)) return { suggestions: [] }

                      const word = model.getWordUntilPosition(position)
                      const range = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endColumn: word.endColumn,
                      }

                      const customSuggestions = customFiltersRef.current.map((f) => ({
                        label: f.name,
                        kind: monaco.languages.CompletionItemKind.Function,
                        detail: '⚙ custom filter',
                        documentation: { value: f.description ?? `Custom Jinja2 filter: \`${f.name}\`` },
                        insertText: f.name,
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.None,
                        range,
                        sortText: '0' + f.name, // custom filters sort first
                      }))

                      const builtinSuggestions = JINJA2_BUILTIN_FILTERS.map((f) => ({
                        label: f.name,
                        kind: monaco.languages.CompletionItemKind.Function,
                        detail: 'Jinja2',
                        documentation: { value: f.doc },
                        insertText: f.snippet ?? f.name,
                        insertTextRules: f.snippet
                          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                          : monaco.languages.CompletionItemInsertTextRule.None,
                        range,
                        sortText: '1' + f.name,
                      }))

                      return { suggestions: [...customSuggestions, ...builtinSuggestions] }
                    },
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

      {/* Validate modal */}
      {showValidate && (
        <ValidateModal
          variables={validateQuery.data}
          isLoading={validateQuery.isFetching}
          onClose={() => setShowValidate(false)}
        />
      )}

      {/* Toast */}
      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}

      {/* AI assistant modal */}
      {showAI && (
        <AiAssistModal
          registeredParams={assignedParams.map((p) => p.name)}
          customFilters={customFilters.map((f) => f.name)}
          existingBody={editorContent}
          onAccept={handleAIAccept}
          onClose={() => setShowAI(false)}
        />
      )}
    </DndContext>
  )
}
