import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { listTemplates, createTemplate, uploadTemplate } from '../../api/templates'
import { listProjects } from '../../api/catalog'
import type { ProjectOut, TemplateCreate, TemplateOut, TemplateUploadOut } from '../../api/types'

// ── Tree helpers ─────────────────────────────────────────────────────────────

interface TreeRow {
  t: TemplateOut
  depth: number
  isLast: boolean
  continuations: boolean[] // continuations[i]=true → depth-i ancestor still has siblings below
  hasChildren: boolean
}

function buildProjectTree(templates: TemplateOut[], projectId: number): TreeRow[] {
  const projectTemplates = templates.filter((t) => t.project_id === projectId)
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
    <span className="font-mono select-none text-xs shrink-0" style={{ color: '#2a3255', whiteSpace: 'pre' }}>
      {continuations.slice(1).map((cont, i) => (
        <span key={i}>{cont ? '│  ' : '   '}</span>
      ))}
      {isLast ? '└─ ' : '├─ '}
    </span>
  )
}

// ── Form styling ─────────────────────────────────────────────────────────────

const inputClass = 'w-full rounded-lg px-3 py-2 text-sm text-slate-100 border transition-colors focus:outline-none'
const inputStyle = { backgroundColor: '#141828', borderColor: '#2a3255' }

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminTemplates() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [search, setSearch] = useState('')
  const [filterProjectId, setFilterProjectId] = useState<number | ''>('')

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importProjectId, setImportProjectId] = useState<number | ''>('')
  const [uploadResult, setUploadResult] = useState<TemplateUploadOut | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const { data: templates, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => listTemplates({ active_only: false }),
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

  const uploadMut = useMutation({
    mutationFn: ({ file, projectId }: { file: File; projectId: number }) =>
      uploadTemplate(file, projectId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      setUploadResult(result)
      setImportFile(null)
    },
  })

  const { register, handleSubmit, reset } = useForm<TemplateCreate>()

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
    }))
  }, [templates, projectMap])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white font-display">Templates</h1>
          <p className="text-sm mt-1" style={{ color: '#546485' }}>Manage template catalog entries</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowImport((v) => !v); if (!showImport) { setShowForm(false); handleCancel() } }}
            className="px-4 py-2 text-sm font-semibold rounded-lg transition-all"
            style={{
              background: showImport ? 'transparent' : 'transparent',
              border: '1px solid #2a3255',
              color: showImport ? '#8892b0' : '#8892b0',
            }}
            onMouseEnter={(e) => { if (!showImport) { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#818cf8' } }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a3255'; e.currentTarget.style.color = '#8892b0' }}
          >
            {showImport ? 'Cancel Import' : 'Import .j2'}
          </button>
          <button
            onClick={() => { setShowForm((v) => !v); if (!showForm) handleImportClose() }}
            className="px-4 py-2 text-sm font-semibold rounded-lg transition-all"
            style={{
              background: showForm ? 'transparent' : 'linear-gradient(135deg, #6366f1, #818cf8)',
              boxShadow: showForm ? 'none' : '0 4px 14px rgba(99,102,241,0.3)',
              border: showForm ? '1px solid #2a3255' : 'none',
              color: showForm ? '#8892b0' : 'white',
            }}
          >
            {showForm ? 'Cancel' : 'New Template'}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleSubmit((data) => createMut.mutate(data))}
          className="rounded-xl border p-5 mb-6 space-y-4"
          style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}
        >
          <h2 className="font-semibold text-slate-100 font-display">New Template</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>
                Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="e.g. cisco_891_base"
                {...register('name', {
                  required: true,
                  pattern: { value: /^[a-zA-Z0-9_]+$/, message: 'Only letters, digits, underscores' },
                })}
              />
              <p className="text-xs mt-1" style={{ color: '#3d4777' }}>Letters, digits, underscores only</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>
                Display Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="e.g. Cisco 891 Base Config"
                {...register('display_name', { required: true })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>
                Project <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                className={inputClass}
                style={{ ...inputStyle, color: '#e2e8f4' }}
                {...register('project_id', { required: true, setValueAs: (v) => v === '' ? undefined : Number(v) })}
              >
                <option value="" style={{ backgroundColor: '#141828' }}>— select project —</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id} style={{ backgroundColor: '#141828' }}>{p.display_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Parent Template</label>
              <select
                className={inputClass}
                style={{ ...inputStyle, color: '#e2e8f4' }}
                {...register('parent_template_id', { setValueAs: (v) => v === '' ? undefined : Number(v) })}
              >
                <option value="" style={{ backgroundColor: '#141828' }}>— none (root template) —</option>
                {templates?.map((t) => (
                  <option key={t.id} value={t.id} style={{ backgroundColor: '#141828' }}>{t.display_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Description</label>
            <input
              className={inputClass}
              style={inputStyle}
              placeholder="Optional description"
              {...register('description')}
            />
          </div>

          {createMut.isError && (
            <p className="text-xs" style={{ color: '#ef4444' }}>
              {(createMut.error as any)?.response?.data?.detail ?? 'Failed to create template'}
            </p>
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
          style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-slate-100 font-display">Import .j2 Template</h2>
              <p className="text-xs mt-1" style={{ color: '#546485' }}>
                Upload a Jinja2 template file. YAML frontmatter (<code style={{ color: '#8892b0' }}>parameters</code>,{' '}
                <code style={{ color: '#8892b0' }}>display_name</code>) will be parsed and registered automatically.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
              style={{ borderColor: '#2a3255', color: '#546485', backgroundColor: 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#818cf8' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a3255'; e.currentTarget.style.color = '#546485' }}
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
              borderColor: isDragging ? '#6366f1' : importFile ? '#4ade80' : '#2a3255',
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
                <span className="text-sm font-medium" style={{ color: '#e2e8f4' }}>{importFile.name}</span>
                <button
                  type="button"
                  className="ml-2 text-xs transition-colors"
                  style={{ color: '#546485' }}
                  onClick={(e) => { e.stopPropagation(); setImportFile(null); uploadMut.reset(); setUploadResult(null) }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div>
                <svg className="w-8 h-8 mx-auto mb-2" style={{ color: '#2a3255' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm" style={{ color: '#546485' }}>Drop a <span style={{ color: '#8892b0' }}>.j2</span> file here, or click to browse</p>
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
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>
              Project <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              className={inputClass}
              style={{ ...inputStyle, color: importProjectId === '' ? '#546485' : '#e2e8f4' }}
              value={importProjectId}
              onChange={(e) => setImportProjectId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="" style={{ backgroundColor: '#141828' }}>— select project —</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id} style={{ backgroundColor: '#141828' }}>{p.display_name}</option>
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
              <p className="text-xs" style={{ color: '#546485' }}>
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
            style={{ color: '#3d4777' }}
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
            style={{ backgroundColor: '#0d1021', borderColor: '#1e2440', color: '#e2e8f4' }}
          />
        </div>

        <select
          value={filterProjectId}
          onChange={(e) => setFilterProjectId(e.target.value === '' ? '' : Number(e.target.value))}
          className="rounded-lg px-3 py-1.5 text-sm border focus:outline-none"
          style={{ backgroundColor: '#0d1021', borderColor: '#1e2440', color: filterProjectId === '' ? '#546485' : '#e2e8f4' }}
        >
          <option value="">All projects</option>
          {projects?.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>

        {isFiltering && (
          <button
            onClick={() => { setSearch(''); setFilterProjectId('') }}
            className="text-xs transition-colors"
            style={{ color: '#546485' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#8892b0')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#546485')}
          >
            Clear
          </button>
        )}

        <span className="text-xs ml-auto" style={{ color: '#3d4777' }}>
          {templates?.length ?? 0} template{templates?.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table area */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
        </div>
      ) : isFiltering ? (
        /* ── Flat filtered list ─────────────────────────────────────────── */
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}>
          {!flatFiltered.length ? (
            <p className="px-4 py-10 text-center text-sm" style={{ color: '#546485' }}>No templates match your search.</p>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: '#0a0d1a', borderBottom: '1px solid #1e2440' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Project</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Parent</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {flatFiltered.map((t, idx) => (
                  <tr
                    key={t.id}
                    style={{ borderBottom: idx < flatFiltered.length - 1 ? '1px solid #1e2440' : 'none' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium" style={{ color: '#e2e8f4' }}>{t.display_name}</span>
                      <span className="ml-2 font-mono text-xs" style={{ color: '#3d4777' }}>{t.name}</span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#546485' }}>
                      {projectMap.get(t.project_id)?.display_name ?? `#${t.project_id}`}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#3d4777' }}>
                      {t.parent_template_id
                        ? (templateMap.get(t.parent_template_id)?.display_name ?? '—')
                        : <span style={{ color: '#2a3255' }}>—</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge active={t.is_active} /></td>
                    <td className="px-4 py-3 text-right"><EditLink id={t.id} /></td>
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
            <div className="rounded-xl border" style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}>
              <p className="px-4 py-10 text-center text-sm" style={{ color: '#546485' }}>No templates found.</p>
            </div>
          ) : projectGroups.map(({ project, rows }) => (
            <div
              key={project?.id ?? 'unknown'}
              className="rounded-xl border overflow-hidden"
              style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}
            >
              {/* Project group header */}
              <div
                className="flex items-center gap-2 px-4 py-2.5 border-b"
                style={{ backgroundColor: '#0a0d1a', borderColor: '#1e2440' }}
              >
                <svg className="w-3.5 h-3.5 shrink-0" style={{ color: '#6366f1' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#6366f1' }}>
                  {project?.display_name ?? `Project #${project?.id}`}
                </span>
                <span className="text-xs" style={{ color: '#3d4777' }}>
                  ({rows.length} template{rows.length !== 1 ? 's' : ''})
                </span>
              </div>

              {/* Template rows */}
              <table className="w-full text-sm">
                <colgroup>
                  <col style={{ width: '40%' }} />
                  <col style={{ width: '35%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '13%' }} />
                </colgroup>
                <thead style={{ borderBottom: '1px solid #1e2440' }}>
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Internal name</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Display name</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ t, depth, isLast, continuations, hasChildren }, idx) => (
                    <tr
                      key={t.id}
                      style={{ borderBottom: idx < rows.length - 1 ? '1px solid #0f1326' : 'none' }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center min-w-0">
                          <TreePrefix depth={depth} isLast={isLast} continuations={continuations} />
                          <span className="font-mono text-xs" style={{ color: '#546485' }}>{t.name}</span>
                          {hasChildren && (
                            <span className="ml-1.5 shrink-0" title="Has child templates" style={{ color: '#2a3255' }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-sm" style={{ color: '#e2e8f4' }}>{t.display_name}</span>
                        {t.description && (
                          <p className="text-xs mt-0.5 truncate" style={{ color: '#3d4777' }}>{t.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5"><StatusBadge active={t.is_active} /></td>
                      <td className="px-4 py-2.5 text-right"><EditLink id={t.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Small shared sub-components ───────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full border font-medium"
      style={
        active
          ? { backgroundColor: 'rgba(52,211,153,0.1)', color: '#34d399', borderColor: 'rgba(52,211,153,0.2)' }
          : { backgroundColor: 'rgba(148,163,184,0.08)', color: '#546485', borderColor: '#2a3255' }
      }
    >
      {active ? 'active' : 'inactive'}
    </span>
  )
}

function EditLink({ id }: { id: number }) {
  return (
    <Link
      to={`/admin/templates/${id}/edit`}
      className="text-xs font-medium transition-colors"
      style={{ color: '#6366f1' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = '#818cf8')}
      onMouseLeave={(e) => (e.currentTarget.style.color = '#6366f1')}
    >
      Edit
    </Link>
  )
}
