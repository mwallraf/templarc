import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import {
  listTemplates,
  createTemplate,
  uploadTemplate,
  deleteTemplate,
  updateTemplate,
} from '../../api/templates'
import { listProjects } from '../../api/catalog'
import type {
  ProjectOut,
  TemplateCreate,
  TemplateOut,
  TemplateUpdate,
  TemplateUploadOut,
} from '../../api/types'

// ── Tree helpers ─────────────────────────────────────────────────────────────

interface TreeRow {
  t: TemplateOut
  depth: number
  isLast: boolean
  continuations: boolean[] // continuations[i]=true → depth-i ancestor still has siblings below
  hasChildren: boolean
}

function buildProjectTree(templates: TemplateOut[], projectId: number): TreeRow[] {
  const projectTemplates = templates.filter((t) => t.project_id === projectId && !t.is_snippet)
  const byParent = new Map<number | null, TemplateOut[]>()
  const childCount = new Map<number, number>()

  for (const t of projectTemplates) {
    const key = t.parent_template_id ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(t)
    if (t.parent_template_id != null) {
      childCount.set(t.parent_template_id, (childCount.get(t.parent_template_id) ?? 0) + 1)
    }
  }

  for (const children of byParent.values()) {
    children.sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name))
  }

  const result: TreeRow[] = []

  function dfs(parentId: number | null, depth: number, continuations: boolean[]) {
    const children = byParent.get(parentId) ?? []
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1
      result.push({
        t: child,
        depth,
        isLast,
        continuations: [...continuations],
        hasChildren: (childCount.get(child.id) ?? 0) > 0,
      })
      dfs(child.id, depth + 1, [...continuations, !isLast])
    })
  }

  dfs(null, 0, [])
  return result
}

function TreePrefix({ depth, isLast, continuations }: Pick<TreeRow, 'depth' | 'isLast' | 'continuations'>) {
  if (depth === 0) return null
  return (
    <span className="font-mono select-none text-xs shrink-0" style={{ color: 'var(--c-border-bright)', whiteSpace: 'pre' }}>
      {continuations.slice(1).map((cont, i) => (
        <span key={i}>{cont ? '│  ' : '   '}</span>
      ))}
      {isLast ? '└─ ' : '├─ '}
    </span>
  )
}

// ── Form styling ─────────────────────────────────────────────────────────────

const inputClass = 'w-full rounded-lg px-3 py-2 text-sm text-slate-100 border transition-colors focus:outline-none'
const inputStyle = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminTemplates() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [search, setSearch] = useState('')
  const [filterProjectId, setFilterProjectId] = useState<number | ''>('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [expandedSnippetProjects, setExpandedSnippetProjects] = useState<Set<number>>(new Set())

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importProjectId, setImportProjectId] = useState<number | ''>('')
  const [uploadResult, setUploadResult] = useState<TemplateUploadOut | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const { data: templates, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => listTemplates({ active_only: true }),
  })

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  })

  const createMut = useMutation({
    mutationFn: createTemplate,
    onSuccess: (tmpl) => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      navigate(`/admin/templates/${tmpl.id}/edit`)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      setConfirmDeleteId(null)
    },
  })

  const toggleFlagMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TemplateUpdate }) => updateTemplate(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })

  const uploadMut = useMutation({
    mutationFn: ({ file, projectId }: { file: File; projectId: number }) =>
      uploadTemplate(file, projectId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      setUploadResult(result)
      setImportFile(null)
    },
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors: formErrors } } = useForm<TemplateCreate>()
  const watchIsSnippet = watch('is_snippet', false)
  const watchName = watch('name', '')
  const watchParentId = watch('parent_template_id')

  // Auto-open the create form when navigated here from the catalog
  const locationState = location.state as { openCreate?: boolean; projectId?: number } | null
  useEffect(() => {
    if (locationState?.openCreate) {
      setShowForm(true)
      if (locationState.projectId) {
        setValue('project_id', locationState.projectId)
      }
      // Clear the state so a refresh doesn't re-open the form
      window.history.replaceState({}, '')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleCancel() {
    setShowForm(false)
    reset()
    createMut.reset()
  }

  function handleImportClose() {
    setShowImport(false)
    setImportFile(null)
    setUploadResult(null)
    uploadMut.reset()
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f && (f.name.endsWith('.j2') || f.type === '' || f.type.startsWith('text/'))) {
      setImportFile(f)
      setUploadResult(null)
      uploadMut.reset()
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) {
      setImportFile(f)
      setUploadResult(null)
      uploadMut.reset()
    }
    e.target.value = ''
  }

  function onToggleFlag(id: number, data: TemplateUpdate) {
    toggleFlagMut.mutate({ id, data })
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const projectMap = useMemo(
    () => new Map<number, ProjectOut>((projects ?? []).map((p) => [p.id, p])),
    [projects],
  )

  const templateMap = useMemo(
    () => new Map<number, TemplateOut>((templates ?? []).map((t) => [t.id, t])),
    [templates],
  )

  const isFiltering = search.trim().length > 0 || filterProjectId !== ''

  // Flat filtered list (used when search/filter is active)
  const flatFiltered = useMemo(() => {
    if (!templates) return []
    let result = templates
    if (filterProjectId !== '') result = result.filter((t) => t.project_id === filterProjectId)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (t) => t.name.toLowerCase().includes(q) || t.display_name.toLowerCase().includes(q),
      )
    }
    return result.sort((a, b) => {
      const pa = projectMap.get(a.project_id)?.display_name ?? ''
      const pb = projectMap.get(b.project_id)?.display_name ?? ''
      return pa.localeCompare(pb) || a.display_name.localeCompare(b.display_name)
    })
  }, [templates, filterProjectId, search, projectMap])

  // Tree view: one group per project
  const projectGroups = useMemo(() => {
    if (!templates) return []
    const projectIds = Array.from(new Set(templates.map((t) => t.project_id))).sort((a, b) =>
      (projectMap.get(a)?.display_name ?? '').localeCompare(projectMap.get(b)?.display_name ?? ''),
    )
    return projectIds.map((pid) => ({
      project: projectMap.get(pid),
      rows: buildProjectTree(templates, pid),
      snippets: templates
        .filter((t) => t.project_id === pid && t.is_snippet)
        .sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name)),
    }))
  }, [templates, projectMap])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white font-display">Templates</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>Manage template catalog entries</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowImport((v) => !v); if (!showImport) { setShowForm(false); handleCancel() } }}
            className="px-4 py-2 text-sm font-semibold rounded-lg transition-all"
            style={{
              background: 'transparent',
              border: '1px solid var(--c-border-bright)',
              color: 'var(--c-muted-2)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#818cf8' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--c-border-bright)'; e.currentTarget.style.color = 'var(--c-muted-2)' }}
          >
            {showImport ? 'Cancel Import' : 'Import .j2'}
          </button>
          <button
            onClick={() => { setShowForm((v) => !v); if (!showForm) handleImportClose() }}
            className="px-4 py-2 text-sm font-semibold rounded-lg transition-all"
            style={{
              background: showForm ? 'transparent' : 'linear-gradient(135deg, #6366f1, #818cf8)',
              boxShadow: showForm ? 'none' : '0 4px 14px rgba(99,102,241,0.3)',
              border: showForm ? '1px solid var(--c-border-bright)' : 'none',
              color: showForm ? 'var(--c-muted-2)' : 'white',
            }}
          >
            {showForm ? 'Cancel' : 'New Template'}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleSubmit((data) => {
          if (data.is_snippet && !data.git_path && data.name) {
            data.git_path = `snippets/${data.name}.j2`
          }
          // Auto-inject {% extends %} starter when a parent template is selected.
          // Strip the project directory prefix (everything up to and including the
          // first '/') because the Jinja2 env loader is rooted at the project dir.
          if (data.parent_template_id && !data.content) {
            const parentId = Number(data.parent_template_id)
            const parent = templateMap.get(parentId)
            if (parent?.git_path) {
              const slashIdx = parent.git_path.indexOf('/')
              const extendsPath = slashIdx !== -1
                ? parent.git_path.slice(slashIdx + 1)
                : parent.git_path
              data.content = `{% extends "${extendsPath}" %}\n\n{% block content %}\n\n{% endblock %}\n`
            }
          }
          createMut.mutate(data)
        })}
          className="rounded-xl border p-5 mb-6 space-y-4"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <h2 className="font-semibold text-slate-100 font-display">New Template</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
                Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="e.g. cisco_891_base"
                {...register('name', {
                  required: 'Name is required',
                  pattern: { value: /^[a-zA-Z0-9_]+$/, message: 'Only letters, digits, underscores — no spaces or special characters' },
                })}
              />
              {formErrors.name ? (
                <p className="text-xs mt-1 font-medium" style={{ color: '#f87171' }}>{formErrors.name.message}</p>
              ) : (
                <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>Letters, digits, underscores only</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
                Display Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="e.g. Cisco 891 Base Config"
                {...register('display_name', { required: 'Display name is required' })}
              />
              {formErrors.display_name && (
                <p className="text-xs mt-1 font-medium" style={{ color: '#f87171' }}>{formErrors.display_name.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
                Project <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                className={inputClass}
                style={{ ...inputStyle, color: 'var(--c-text)' }}
                {...register('project_id', { required: 'Project is required', setValueAs: (v) => v === '' ? undefined : Number(v) })}
              >
                <option value="" style={{ backgroundColor: 'var(--c-card)' }}>— select project —</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id} style={{ backgroundColor: 'var(--c-card)' }}>{p.display_name}</option>
                ))}
              </select>
              {formErrors.project_id && (
                <p className="text-xs mt-1 font-medium" style={{ color: '#f87171' }}>{formErrors.project_id.message}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Parent Template</label>
              <select
                className={inputClass}
                style={{ ...inputStyle, color: 'var(--c-text)' }}
                {...register('parent_template_id', { setValueAs: (v) => v === '' ? undefined : Number(v) })}
              >
                <option value="" style={{ backgroundColor: 'var(--c-card)' }}>— none (root template) —</option>
                {templates?.filter((t) => !t.is_snippet).map((t) => (
                  <option key={t.id} value={t.id} style={{ backgroundColor: 'var(--c-card)' }}>{t.display_name}</option>
                ))}
              </select>
              {watchParentId && (() => {
                const parent = templateMap.get(Number(watchParentId))
                if (!parent?.git_path) return null
                const slashIdx = parent.git_path.indexOf('/')
                const extendsPath = slashIdx !== -1 ? parent.git_path.slice(slashIdx + 1) : parent.git_path
                return (
                  <p className="text-xs mt-1 font-mono" style={{ color: '#818cf8' }}>
                    ↳ will insert <span style={{ color: '#a5b4fc' }}>{`{% extends "${extendsPath}" %}`}</span>
                  </p>
                )
              })()}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Description</label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="Optional description"
                {...register('description')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
                Git path
              </label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder={watchIsSnippet
                  ? `snippets/${watchName || 'name'}.j2 (auto if blank)`
                  : 'e.g. project/subfolder/foo.j2 (auto if blank)'}
                {...register('git_path')}
              />
              <p className="text-xs mt-1" style={{ color: watchIsSnippet ? '#818cf8' : 'var(--c-muted-4)' }}>
                {watchIsSnippet
                  ? <>Snippets auto-routed to <code>snippets/{'{name}'}.j2</code></>
                  : <>Defaults to <code>{'{project}/{name}.j2'}</code></>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 rounded accent-indigo-500"
                {...register('is_hidden')}
              />
              <span className="text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>Hidden from catalog</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 rounded accent-indigo-500"
                {...register('is_snippet')}
              />
              <span className="text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>Snippet (include-only)</span>
            </label>
          </div>

          {createMut.isError && (
            <div
              className="rounded-lg px-3 py-2.5 text-xs"
              style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
            >
              {(() => {
                const detail = (createMut.error as any)?.response?.data?.detail
                if (!detail) return 'Failed to create template'
                if (typeof detail === 'string') return detail
                if (Array.isArray(detail)) return detail.map((d: any) => d.msg ?? JSON.stringify(d)).join('; ')
                return JSON.stringify(detail)
              })()}
            </div>
          )}

          <button
            type="submit"
            disabled={createMut.isPending}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
          >
            {createMut.isPending ? 'Creating…' : 'Create & Edit'}
          </button>
        </form>
      )}

      {/* Import panel */}
      {showImport && (
        <div
          className="rounded-xl border p-5 mb-6 space-y-4"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-slate-100 font-display">Import .j2 Template</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--c-muted-3)' }}>
                Upload a Jinja2 template file. YAML frontmatter (<code style={{ color: 'var(--c-muted-2)' }}>parameters</code>,{' '}
                <code style={{ color: 'var(--c-muted-2)' }}>display_name</code>) will be parsed and registered automatically.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
              style={{ borderColor: 'var(--c-border-bright)', color: 'var(--c-muted-3)', backgroundColor: 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#818cf8' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--c-border-bright)'; e.currentTarget.style.color = 'var(--c-muted-3)' }}
              onClick={() => {
                const example = [
                  '---',
                  'display_name: "My Template"',
                  'description: "Optional description of what this template generates"',
                  '',
                  'parameters:',
                  '  - name: device.hostname',
                  '    widget: text',
                  '    label: "Hostname"',
                  '    description: "Fully qualified domain name of the device"',
                  '    required: true',
                  '',
                  '  - name: device.site',
                  '    widget: select',
                  '    label: "Site"',
                  '    required: true',
                  '',
                  '  - name: vlan_id',
                  '    widget: number',
                  '    label: "VLAN ID"',
                  '    default: "100"',
                  '    required: false',
                  '',
                  '  - name: notes',
                  '    widget: textarea',
                  '    label: "Notes"',
                  '    required: false',
                  '---',
                  '',
                  '! Generated by Templarc',
                  'hostname {{ device.hostname }}',
                  '!',
                  '! Site: {{ device.site }}',
                  '! VLAN: {{ vlan_id }}',
                  '{%- if notes %}',
                  '! Notes: {{ notes }}',
                  '{%- endif %}',
                ].join('\n')
                const blob = new Blob([example], { type: 'text/plain' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'example_template.j2'
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download example
            </button>
          </div>

          {/* File drop zone */}
          <div
            className="rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors"
            style={{
              borderColor: isDragging ? '#6366f1' : importFile ? '#4ade80' : 'var(--c-border-bright)',
              backgroundColor: isDragging ? 'rgba(99,102,241,0.05)' : 'transparent',
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleFileDrop}
          >
            {importFile ? (
              <div className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 shrink-0" style={{ color: '#4ade80' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>{importFile.name}</span>
                <button
                  type="button"
                  className="ml-2 text-xs transition-colors"
                  style={{ color: 'var(--c-muted-3)' }}
                  onClick={(e) => { e.stopPropagation(); setImportFile(null); uploadMut.reset(); setUploadResult(null) }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div>
                <svg className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--c-border-bright)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm" style={{ color: 'var(--c-muted-3)' }}>Drop a <span style={{ color: 'var(--c-muted-2)' }}>.j2</span> file here, or click to browse</p>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".j2"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Project */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
              Project <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              className={inputClass}
              style={{ ...inputStyle, color: importProjectId === '' ? 'var(--c-muted-3)' : 'var(--c-text)' }}
              value={importProjectId}
              onChange={(e) => setImportProjectId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="" style={{ backgroundColor: 'var(--c-card)' }}>— select project —</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id} style={{ backgroundColor: 'var(--c-card)' }}>{p.display_name}</option>
              ))}
            </select>
          </div>

          {/* Error */}
          {uploadMut.isError && (
            <p className="text-xs" style={{ color: '#ef4444' }}>
              {(uploadMut.error as any)?.response?.data?.detail ?? 'Import failed'}
            </p>
          )}

          {/* Success result */}
          {uploadResult && (
            <div className="rounded-lg p-4 space-y-2" style={{ backgroundColor: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)' }}>
              <p className="text-sm font-medium" style={{ color: '#34d399' }}>
                ✓ Imported: {uploadResult.template.display_name}
              </p>
              <p className="text-xs" style={{ color: 'var(--c-muted-3)' }}>
                {uploadResult.parameters_registered} parameter{uploadResult.parameters_registered !== 1 ? 's' : ''} registered from frontmatter
              </p>
              {uploadResult.suggested_parameters.length > 0 && (
                <p className="text-xs" style={{ color: '#f59e0b' }}>
                  {uploadResult.suggested_parameters.length} variable{uploadResult.suggested_parameters.length !== 1 ? 's' : ''} in template body not yet registered as parameters
                </p>
              )}
              <Link
                to={`/admin/templates/${uploadResult.template.id}/edit`}
                className="inline-block text-xs font-medium mt-1 transition-colors"
                style={{ color: '#6366f1' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#818cf8')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#6366f1')}
              >
                Open in editor →
              </Link>
            </div>
          )}

          {!uploadResult && (
            <button
              type="button"
              disabled={!importFile || importProjectId === '' || uploadMut.isPending}
              onClick={() => importFile && importProjectId !== '' && uploadMut.mutate({ file: importFile, projectId: importProjectId as number })}
              className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
            >
              {uploadMut.isPending ? 'Importing…' : 'Import Template'}
            </button>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
            style={{ color: 'var(--c-muted-4)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="w-full rounded-lg pl-8 pr-3 py-1.5 text-sm border focus:outline-none"
            style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
          />
        </div>

        <select
          value={filterProjectId}
          onChange={(e) => setFilterProjectId(e.target.value === '' ? '' : Number(e.target.value))}
          className="rounded-lg px-3 py-1.5 text-sm border focus:outline-none"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', color: filterProjectId === '' ? 'var(--c-muted-3)' : 'var(--c-text)' }}
        >
          <option value="">All projects</option>
          {projects?.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>

        {isFiltering && (
          <button
            onClick={() => { setSearch(''); setFilterProjectId('') }}
            className="text-xs transition-colors"
            style={{ color: 'var(--c-muted-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-muted-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-3)')}
          >
            Clear
          </button>
        )}

        <span className="text-xs ml-auto" style={{ color: 'var(--c-muted-4)' }}>
          {(templates ?? []).filter(t => !t.is_snippet).length} template{(templates ?? []).filter(t => !t.is_snippet).length !== 1 ? 's' : ''}
          {(templates ?? []).some(t => t.is_snippet) && (
            <span className="ml-1.5" style={{ color: 'var(--c-border-bright)' }}>
              · {(templates ?? []).filter(t => t.is_snippet).length} snippet{(templates ?? []).filter(t => t.is_snippet).length !== 1 ? 's' : ''}
            </span>
          )}
        </span>
      </div>

      {/* Error from toggle/delete */}
      {(deleteMut.isError || toggleFlagMut.isError) && (
        <p className="text-xs mb-3 px-3 py-2 rounded-lg border" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.05)' }}>
          {(deleteMut.error as any)?.response?.data?.detail
            ?? (toggleFlagMut.error as any)?.response?.data?.detail
            ?? 'Operation failed'}
        </p>
      )}

      {/* Table area */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
        </div>
      ) : isFiltering ? (
        /* ── Flat filtered list ─────────────────────────────────────────── */
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
          {!flatFiltered.length ? (
            <p className="px-4 py-10 text-center text-sm" style={{ color: 'var(--c-muted-3)' }}>No templates match your search.</p>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--c-surface-alt)', borderBottom: '1px solid var(--c-border)' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Project</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Parent</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Flags</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {flatFiltered.map((t, idx) => (
                  <tr
                    key={t.id}
                    style={{ borderBottom: idx < flatFiltered.length - 1 ? '1px solid var(--c-border)' : 'none' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium" style={{ color: 'var(--c-text)' }}>{t.display_name}</span>
                      <span className="ml-2 font-mono text-xs" style={{ color: 'var(--c-muted-4)' }}>{t.name}</span>
                      {t.git_path && (
                        <p className="font-mono text-xs mt-0.5 truncate" style={{ color: 'var(--c-border-bright)' }}>{t.git_path}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-3)' }}>
                      {projectMap.get(t.project_id)?.display_name ?? `#${t.project_id}`}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-4)' }}>
                      {t.parent_template_id
                        ? (templateMap.get(t.parent_template_id)?.display_name ?? '—')
                        : <span style={{ color: 'var(--c-border-bright)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <TemplateFlagBadges t={t} onToggle={onToggleFlag} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowActions
                        id={t.id}
                        confirmId={confirmDeleteId}
                        onConfirmDelete={setConfirmDeleteId}
                        onDelete={(id) => deleteMut.mutate(id)}
                        isDeleting={deleteMut.isPending}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        /* ── Tree view grouped by project ────────────────────────────────── */
        <div className="space-y-4">
          {!templates?.length ? (
            <div className="rounded-xl border" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
              <p className="px-4 py-10 text-center text-sm" style={{ color: 'var(--c-muted-3)' }}>No templates found.</p>
            </div>
          ) : projectGroups.map(({ project, rows, snippets }) => {
            const pid = project?.id ?? 0
            const snippetsExpanded = expandedSnippetProjects.has(pid)
            function toggleSnippets() {
              setExpandedSnippetProjects((prev) => {
                const next = new Set(prev)
                next.has(pid) ? next.delete(pid) : next.add(pid)
                return next
              })
            }
            return (
            <div
              key={pid}
              className="rounded-xl border overflow-hidden"
              style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
            >
              {/* Project group header */}
              <div
                className="flex items-center gap-2 px-4 py-2.5 border-b"
                style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}
              >
                <svg className="w-3.5 h-3.5 shrink-0" style={{ color: '#6366f1' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#6366f1' }}>
                  {project?.display_name ?? `Project #${pid}`}
                </span>
                <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>
                  ({rows.length} template{rows.length !== 1 ? 's' : ''})
                </span>
              </div>

              {/* Template rows */}
              {rows.length > 0 && (
                <table className="w-full text-sm">
                  <colgroup>
                    <col style={{ width: '32%' }} />
                    <col style={{ width: '28%' }} />
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '16%' }} />
                  </colgroup>
                  <thead style={{ borderBottom: '1px solid var(--c-border)' }}>
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Internal name</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Display name</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Flags</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ t, depth, isLast, continuations, hasChildren }, idx) => (
                      <tr
                        key={t.id}
                        style={{ borderBottom: idx < rows.length - 1 ? '1px solid var(--c-surface-alt)' : 'none' }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center min-w-0">
                            <TreePrefix depth={depth} isLast={isLast} continuations={continuations} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="font-mono text-xs" style={{ color: 'var(--c-muted-3)' }}>{t.name}</span>
                                {hasChildren && (
                                  <span className="shrink-0" title="Has child templates" style={{ color: 'var(--c-border-bright)' }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </span>
                                )}
                              </div>
                              {t.git_path && (
                                <div className="font-mono text-xs truncate mt-0.5" style={{ color: 'var(--c-border-bright)' }} title={t.git_path}>
                                  {t.git_path}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-sm" style={{ color: 'var(--c-text)' }}>{t.display_name}</span>
                          {t.description && (
                            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--c-muted-4)' }}>{t.description}</p>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <TemplateFlagBadges t={t} onToggle={onToggleFlag} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <RowActions
                            id={t.id}
                            confirmId={confirmDeleteId}
                            onConfirmDelete={setConfirmDeleteId}
                            onDelete={(id) => deleteMut.mutate(id)}
                            isDeleting={deleteMut.isPending}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Snippets sub-section (collapsible) */}
              {snippets.length > 0 && (
                <div style={{ borderTop: rows.length > 0 ? '1px solid var(--c-border)' : 'none' }}>
                  {/* Toggle header */}
                  <button
                    onClick={toggleSnippets}
                    className="w-full flex items-center gap-2 px-4 py-2 text-left transition-colors"
                    style={{ backgroundColor: snippetsExpanded ? 'var(--c-surface-alt)' : 'transparent' }}
                    onMouseEnter={(e) => { if (!snippetsExpanded) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--c-row-hover)' }}
                    onMouseLeave={(e) => { if (!snippetsExpanded) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
                  >
                    <svg
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      className="w-3 h-3 shrink-0 transition-transform"
                      style={{ color: 'var(--c-muted-4)', transform: snippetsExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <svg className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--c-muted-4)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                    <span className="text-xs font-medium" style={{ color: 'var(--c-muted-3)' }}>
                      Snippets
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--c-card)', color: 'var(--c-muted-4)', border: '1px solid var(--c-border-bright)' }}>
                      {snippets.length}
                    </span>
                  </button>

                  {/* Snippet rows */}
                  {snippetsExpanded && (
                    <table className="w-full text-sm" style={{ borderTop: '1px solid var(--c-border)' }}>
                      <tbody>
                        {snippets.map((t, idx) => (
                          <tr
                            key={t.id}
                            style={{ borderBottom: idx < snippets.length - 1 ? '1px solid var(--c-surface-alt)' : 'none' }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <td className="px-4 py-2.5" style={{ width: '32%' }}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono text-xs opacity-30 select-none">└─</span>
                                <div className="min-w-0">
                                  <span className="font-mono text-xs" style={{ color: 'var(--c-muted-3)' }}>{t.name}</span>
                                  {t.git_path && (
                                    <div className="font-mono text-xs truncate mt-0.5" style={{ color: 'var(--c-border-bright)' }} title={t.git_path}>
                                      {t.git_path}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2.5" style={{ width: '28%' }}>
                              <span className="text-sm" style={{ color: 'var(--c-muted-2)' }}>{t.display_name}</span>
                              {t.description && (
                                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--c-muted-4)' }}>{t.description}</p>
                              )}
                            </td>
                            <td className="px-4 py-2.5" style={{ width: '24%' }}>
                              <TemplateFlagBadges t={t} onToggle={onToggleFlag} />
                            </td>
                            <td className="px-4 py-2.5 text-right" style={{ width: '16%' }}>
                              <RowActions
                                id={t.id}
                                confirmId={confirmDeleteId}
                                onConfirmDelete={setConfirmDeleteId}
                                onDelete={(id) => deleteMut.mutate(id)}
                                isDeleting={deleteMut.isPending}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Small shared sub-components ───────────────────────────────────────────────

// Icon components for flag badges
function IconCheck() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}
function IconX() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
function IconEye() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}
function IconEyeOff() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}
function IconCode() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  )
}

function TemplateFlagBadges({
  t,
  onToggle,
}: {
  t: TemplateOut
  onToggle: (id: number, data: TemplateUpdate) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {/* Active toggle */}
      <button
        onClick={() => onToggle(t.id, { is_active: !t.is_active })}
        title={t.is_active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
        className="p-1 rounded transition-colors"
        style={{ color: t.is_active ? '#34d399' : 'var(--c-muted-3)', backgroundColor: t.is_active ? 'rgba(52,211,153,0.08)' : 'transparent' }}
      >
        {t.is_active ? <IconCheck /> : <IconX />}
      </button>

      {/* Hidden toggle */}
      <button
        onClick={() => onToggle(t.id, { is_hidden: !t.is_hidden })}
        title={t.is_hidden ? 'Hidden from catalog — click to show' : 'Visible in catalog — click to hide'}
        className="p-1 rounded transition-colors"
        style={{ color: t.is_hidden ? '#fbbf24' : 'var(--c-muted-4)', backgroundColor: t.is_hidden ? 'rgba(251,191,36,0.08)' : 'transparent' }}
      >
        {t.is_hidden ? <IconEyeOff /> : <IconEye />}
      </button>

      {/* Snippet toggle */}
      <button
        onClick={() => onToggle(t.id, { is_snippet: !t.is_snippet })}
        title={t.is_snippet ? 'Snippet (include-only) — click to make renderable' : 'Normal template — click to mark as snippet'}
        className="p-1 rounded transition-colors"
        style={{ color: t.is_snippet ? '#a78bfa' : 'var(--c-muted-4)', backgroundColor: t.is_snippet ? 'rgba(139,92,246,0.1)' : 'transparent' }}
      >
        <IconCode />
      </button>
    </div>
  )
}

function RowActions({
  id,
  confirmId,
  onConfirmDelete,
  onDelete,
  isDeleting,
}: {
  id: number
  confirmId: number | null
  onConfirmDelete: (id: number | null) => void
  onDelete: (id: number) => void
  isDeleting: boolean
}) {
  if (confirmId === id) {
    return (
      <div className="flex items-center gap-2 justify-end">
        <span className="text-xs" style={{ color: '#ef4444' }}>Delete?</span>
        <button
          onClick={() => onDelete(id)}
          disabled={isDeleting}
          className="text-xs font-medium transition-colors disabled:opacity-50"
          style={{ color: '#ef4444' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#fca5a5')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#ef4444')}
        >
          {isDeleting ? '…' : 'Yes'}
        </button>
        <button
          onClick={() => onConfirmDelete(null)}
          className="text-xs transition-colors"
          style={{ color: 'var(--c-muted-3)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-muted-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-3)')}
        >
          No
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 justify-end">
      <Link
        to={`/admin/templates/${id}/edit`}
        className="text-xs font-medium transition-colors"
        style={{ color: '#6366f1' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#818cf8')}
        onMouseLeave={(e) => (e.currentTarget.style.color = '#6366f1')}
      >
        Edit
      </Link>
      <button
        onClick={() => onConfirmDelete(id)}
        title="Delete template"
        className="transition-colors"
        style={{ color: 'var(--c-muted-4)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-4)')}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  )
}
