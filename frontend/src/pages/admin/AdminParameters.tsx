import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listParameters,
  deleteParameter,
  createParameter,
  createParameterOption,
} from '../../api/parameters'
import type { ParameterOut, ParameterScope } from '../../api/types'
import { ParameterModal } from './ParameterModal'

// ── Constants ─────────────────────────────────────────────────────────────────

const SCOPE_STYLE: Record<ParameterScope, { bg: string; text: string; border: string }> = {
  global: { bg: 'rgba(251,191,36,0.1)', text: '#fbbf24', border: 'rgba(251,191,36,0.2)' },
  project: { bg: 'rgba(96,165,250,0.1)', text: '#60a5fa', border: 'rgba(96,165,250,0.2)' },
  template: { bg: 'rgba(148,163,184,0.08)', text: '#64748b', border: 'rgba(148,163,184,0.15)' },
}

const SCOPE_LABEL: Record<ParameterScope, string> = {
  global: 'Global',
  project: 'Project',
  template: 'Template',
}

// ── YAML/JSON Export ──────────────────────────────────────────────────────────

function serializeYAML(params: ParameterOut[]): string {
  function esc(s: string) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  }
  let out = `# Templarc Parameters Export\n# Generated: ${new Date().toISOString()}\n\nparameters:\n`
  for (const p of params) {
    out += `  - name: ${p.name}\n`
    out += `    scope: ${p.scope}\n`
    out += `    widget_type: ${p.widget_type}\n`
    if (p.label) out += `    label: "${esc(p.label)}"\n`
    if (p.description) out += `    description: "${esc(p.description)}"\n`
    if (p.help_text) out += `    help_text: "${esc(p.help_text)}"\n`
    if (p.default_value) out += `    default_value: "${esc(p.default_value)}"\n`
    if (p.required) out += `    required: true\n`
    if (p.validation_regex) out += `    validation_regex: "${esc(p.validation_regex)}"\n`
    if (p.is_derived) {
      out += `    is_derived: true\n`
      if (p.derived_expression) out += `    derived_expression: "${esc(p.derived_expression)}"\n`
    }
    if (p.organization_id) out += `    organization_id: ${p.organization_id}\n`
    if (p.project_id) out += `    project_id: ${p.project_id}\n`
    if (p.template_id) out += `    template_id: ${p.template_id}\n`
    if (p.options.length > 0) {
      out += `    options:\n`
      for (const o of p.options) {
        out += `      - value: "${esc(o.value)}"\n`
        out += `        label: "${esc(o.label)}"\n`
        if (o.condition_param) out += `        condition_param: ${o.condition_param}\n`
        if (o.condition_value) out += `        condition_value: "${esc(o.condition_value)}"\n`
      }
    }
  }
  return out
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Delete confirm modal ──────────────────────────────────────────────────────

interface DeleteConfirmProps {
  param: ParameterOut
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function DeleteConfirm({ param, onConfirm, onCancel, isPending }: DeleteConfirmProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-2xl border w-full max-w-md p-6" style={{ backgroundColor: '#0d1021', borderColor: '#1e2440', boxShadow: '0 24px 48px rgba(0,0,0,0.6)' }}>
        <h3 className="font-semibold text-white mb-2 font-display">Delete parameter?</h3>
        <p className="text-sm mb-3" style={{ color: '#8892b0' }}>
          You are about to delete{' '}
          <code className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#141828', color: '#e2e8f4' }}>
            {param.name}
          </code>.
        </p>
        <div
          className="rounded-lg px-4 py-3 text-sm mb-5 border"
          style={{ backgroundColor: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.2)', color: '#fbbf24' }}
        >
          <strong>Warning:</strong> If this parameter is referenced in any template body or data source mapping, renders may fail. This is a soft delete — the record will be deactivated, not permanently removed.
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border transition-colors"
            style={{ borderColor: '#2a3255', color: '#8892b0' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #ef4444, #f87171)', boxShadow: '0 4px 14px rgba(239,68,68,0.3)' }}
          >
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Parameter table row ───────────────────────────────────────────────────────

function ParamRow({ param, onEdit, onDelete }: { param: ParameterOut; onEdit: () => void; onDelete: () => void }) {
  const s = SCOPE_STYLE[param.scope]
  return (
    <tr
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <td className="px-4 py-3 font-mono text-xs max-w-xs" style={{ color: '#8892b0' }}>
        <span className="truncate block">{param.name}</span>
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: '#e2e8f4' }}>
        {param.label ?? <span className="italic" style={{ color: '#3d4777' }}>—</span>}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs px-2 py-0.5 rounded-full border font-medium" style={{ backgroundColor: s.bg, color: s.text, borderColor: s.border }}>
          {SCOPE_LABEL[param.scope]}
        </span>
      </td>
      <td className="px-4 py-3 text-xs font-mono" style={{ color: '#546485' }}>{param.widget_type}</td>
      <td className="px-4 py-3 text-xs text-center">
        {param.required ? (
          <span className="text-red-400 font-semibold">Yes</span>
        ) : (
          <span style={{ color: '#2a3255' }}>No</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-center">
        {param.is_derived && (
          <span className="px-1.5 py-0.5 rounded-full text-xs border" style={{ backgroundColor: 'rgba(167,139,250,0.1)', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.2)' }}>
            derived
          </span>
        )}
        {param.options.length > 0 && (
          <span style={{ color: '#3d4777' }}>{param.options.length} opts</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-3">
          <button onClick={onEdit} className="text-xs font-medium transition-colors" style={{ color: '#6366f1' }}>
            Edit
          </button>
          <button onClick={onDelete} className="text-xs font-medium transition-colors" style={{ color: '#ef4444' }}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Scope section ─────────────────────────────────────────────────────────────

function ScopeSection({
  title,
  accent,
  params,
  onEdit,
  onDelete,
}: {
  title: string
  accent: string
  params: ParameterOut[]
  onEdit: (p: ParameterOut) => void
  onDelete: (p: ParameterOut) => void
}) {
  if (params.length === 0) return null

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#546485' }}>{title}</h2>
        <span
          className="text-xs px-2 py-0.5 rounded-full ml-1"
          style={{ backgroundColor: '#141828', color: '#3d4777', border: '1px solid #2a3255' }}
        >
          {params.length}
        </span>
      </div>
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}>
        <table className="w-full text-sm">
          <thead style={{ backgroundColor: '#0a0d1a', borderBottom: '1px solid #1e2440' }}>
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Name</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Label</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Scope</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Widget</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Req.</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Info</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {params.map((p, idx) => (
              <tr key={p.id} style={{ borderBottom: idx < params.length - 1 ? '1px solid #1e2440' : 'none' }}>
                <td className="px-4 py-3 font-mono text-xs max-w-xs" style={{ color: '#8892b0' }}>
                  <span className="truncate block">{p.name}</span>
                </td>
                <td className="px-4 py-3 text-sm" style={{ color: '#e2e8f4' }}>
                  {p.label ?? <span className="italic" style={{ color: '#3d4777' }}>—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2 py-0.5 rounded-full border font-medium" style={{ backgroundColor: SCOPE_STYLE[p.scope].bg, color: SCOPE_STYLE[p.scope].text, borderColor: SCOPE_STYLE[p.scope].border }}>
                    {SCOPE_LABEL[p.scope]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs font-mono" style={{ color: '#546485' }}>{p.widget_type}</td>
                <td className="px-4 py-3 text-xs text-center">
                  {p.required ? <span className="text-red-400 font-semibold">Yes</span> : <span style={{ color: '#2a3255' }}>No</span>}
                </td>
                <td className="px-4 py-3 text-xs text-center">
                  {p.is_derived && <span className="px-1.5 py-0.5 rounded-full text-xs border" style={{ backgroundColor: 'rgba(167,139,250,0.1)', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.2)' }}>derived</span>}
                  {p.options.length > 0 && <span style={{ color: '#3d4777' }}>{p.options.length} opts</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button onClick={() => onEdit(p)} className="text-xs font-medium" style={{ color: '#6366f1' }}>Edit</button>
                    <button onClick={() => onDelete(p)} className="text-xs font-medium" style={{ color: '#ef4444' }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Import handler ────────────────────────────────────────────────────────────

function parseImportYAML(content: string): Array<Record<string, unknown>> {
  const lines = content.split('\n')
  const results: Array<Record<string, unknown>> = []
  let current: Record<string, unknown> | null = null
  let options: Array<Record<string, unknown>> = []
  let currentOpt: Record<string, unknown> | null = null
  let inOptions = false

  function str(v: string) {
    return v.trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').replace(/\\n/g, '\n')
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('#') || !line.trim()) continue

    if (/^  - name:/.test(line)) {
      if (current) { if (options.length) current.options = options; results.push(current) }
      options = []; currentOpt = null; inOptions = false
      current = { name: str(line.replace(/^  - name:\s*/, '')) }
      continue
    }

    if (!current) continue

    if (/^      - value:/.test(line)) {
      currentOpt = { value: str(line.replace(/^      - value:\s*/, '')) }
      options.push(currentOpt)
      inOptions = true
      continue
    }
    if (inOptions && currentOpt && /^        /.test(line)) {
      const [key, ...rest] = line.trim().split(':')
      currentOpt[key.trim()] = str(rest.join(':'))
      continue
    }

    inOptions = false

    if (/^    options:/.test(line)) { inOptions = true; continue }

    if (/^    /.test(line)) {
      const [key, ...rest] = line.trim().split(':')
      const val = rest.join(':').trim()
      current[key.trim()] = val === 'true' ? true : val === 'false' ? false : str(val)
    }
  }
  if (current) { if (options.length) current.options = options; results.push(current) }
  return results
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminParameters() {
  const qc = useQueryClient()
  const importRef = useRef<HTMLInputElement>(null)

  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState<ParameterScope | ''>('')
  const [showModal, setShowModal] = useState(false)
  const [editingParam, setEditingParam] = useState<ParameterOut | undefined>()
  const [deletingParam, setDeletingParam] = useState<ParameterOut | undefined>()
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['parameters', { search, scopeFilter }],
    queryFn: () =>
      listParameters({
        search: search || undefined,
        scope: scopeFilter || undefined,
        page_size: 200,
        include_inactive: false,
      }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteParameter(id),
    onSuccess: () => {
      setDeletingParam(undefined)
      qc.invalidateQueries({ queryKey: ['parameters'] })
    },
  })

  const params = data?.items ?? []
  const globalParams = params.filter((p) => p.scope === 'global')
  const projectParams = params.filter((p) => p.scope === 'project')
  const templateParams = params.filter((p) => p.scope === 'template')

  function openCreate() { setEditingParam(undefined); setShowModal(true) }
  function openEdit(p: ParameterOut) { setEditingParam(p); setShowModal(true) }

  function handleExport() {
    const yaml = serializeYAML(params)
    const date = new Date().toISOString().slice(0, 10)
    downloadFile(yaml, `templarc-parameters-${date}.yaml`, 'text/yaml')
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError(null); setImportSuccess(null)

    const reader = new FileReader()
    reader.onload = async (ev) => {
      const content = ev.target?.result as string
      try {
        const parsed = parseImportYAML(content)
        if (!parsed.length) { setImportError('No parameters found in file.'); return }

        let created = 0
        for (const raw of parsed) {
          try {
            const opts = (raw.options ?? []) as Array<Record<string, string>>
            const p = await createParameter({
              name: String(raw.name ?? ''),
              scope: (raw.scope as ParameterScope) ?? 'template',
              widget_type: raw.widget_type as never,
              label: raw.label ? String(raw.label) : undefined,
              description: raw.description ? String(raw.description) : undefined,
              help_text: raw.help_text ? String(raw.help_text) : undefined,
              default_value: raw.default_value ? String(raw.default_value) : undefined,
              required: Boolean(raw.required),
              validation_regex: raw.validation_regex ? String(raw.validation_regex) : undefined,
              is_derived: Boolean(raw.is_derived),
              derived_expression: raw.derived_expression ? String(raw.derived_expression) : undefined,
              organization_id: raw.organization_id ? Number(raw.organization_id) : undefined,
              project_id: raw.project_id ? Number(raw.project_id) : undefined,
              template_id: raw.template_id ? Number(raw.template_id) : undefined,
            })
            for (const opt of opts) {
              await createParameterOption(p.id, {
                value: String(opt.value ?? ''),
                label: String(opt.label ?? ''),
                condition_param: opt.condition_param ? String(opt.condition_param) : undefined,
                condition_value: opt.condition_value ? String(opt.condition_value) : undefined,
              })
            }
            created++
          } catch { /* skip individual failures */ }
        }

        setImportSuccess(`Imported ${created} of ${parsed.length} parameters.`)
        qc.invalidateQueries({ queryKey: ['parameters'] })
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Failed to parse file.')
      }
      e.target.value = ''
    }
    reader.readAsText(file)
  }

  const inputClass = 'rounded-lg px-3 py-2 text-sm border transition-colors focus:outline-none'
  const inputStyle = { backgroundColor: '#141828', borderColor: '#2a3255', color: '#e2e8f4' }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white font-display">Parameters</h1>
          <p className="text-sm mt-1" style={{ color: '#546485' }}>Global, project, and template parameter registry</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={params.length === 0}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors disabled:opacity-40 font-medium`}
            style={{ borderColor: '#2a3255', color: '#8892b0', backgroundColor: '#141828' }}
          >
            Export YAML
          </button>
          <button
            onClick={() => importRef.current?.click()}
            className="px-3 py-2 text-sm rounded-lg border transition-colors font-medium"
            style={{ borderColor: '#2a3255', color: '#8892b0', backgroundColor: '#141828' }}
          >
            Import YAML
          </button>
          <input ref={importRef} type="file" accept=".yaml,.yml" className="hidden" onChange={handleImportFile} />
          <button
            onClick={openCreate}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
          >
            New Parameter
          </button>
        </div>
      </div>

      {/* Import feedback */}
      {importSuccess && (
        <div className="mb-4 text-sm rounded-lg px-4 py-3 flex justify-between border" style={{ backgroundColor: 'rgba(52,211,153,0.08)', borderColor: 'rgba(52,211,153,0.2)', color: '#34d399' }}>
          <span>{importSuccess}</span>
          <button onClick={() => setImportSuccess(null)}>×</button>
        </div>
      )}
      {importError && (
        <div className="mb-4 text-sm rounded-lg px-4 py-3 flex justify-between border" style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', color: '#f87171' }}>
          <span>Import failed: {importError}</span>
          <button onClick={() => setImportError(null)}>×</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name or label…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`flex-1 ${inputClass}`}
          style={inputStyle}
        />
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as ParameterScope | '')}
          className={inputClass}
          style={inputStyle}
        >
          <option value="" style={{ backgroundColor: '#141828' }}>All scopes</option>
          <option value="global" style={{ backgroundColor: '#141828' }}>Global</option>
          <option value="project" style={{ backgroundColor: '#141828' }}>Project</option>
          <option value="template" style={{ backgroundColor: '#141828' }}>Template</option>
        </select>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
        </div>
      )}

      {!isLoading && params.length === 0 && (
        <div className="text-center py-16" style={{ color: '#3d4777' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-10 h-10 mx-auto mb-3 opacity-40">
            <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
          </svg>
          <p className="text-sm">No parameters match the current filters.</p>
          <button onClick={openCreate} className="mt-3 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors">
            Create your first parameter
          </button>
        </div>
      )}

      {!isLoading && params.length > 0 && (
        <>
          <ScopeSection title="Global Parameters" accent="#fbbf24" params={globalParams} onEdit={openEdit} onDelete={setDeletingParam} />
          <ScopeSection title="Project Parameters" accent="#60a5fa" params={projectParams} onEdit={openEdit} onDelete={setDeletingParam} />
          <ScopeSection title="Template Parameters" accent="#6366f1" params={templateParams} onEdit={openEdit} onDelete={setDeletingParam} />

          <div className="text-xs text-right mt-2" style={{ color: '#2d3665' }}>
            {data?.total} parameter{data?.total !== 1 ? 's' : ''} total
          </div>
        </>
      )}

      {showModal && (
        <ParameterModal
          parameter={editingParam}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); refetch() }}
        />
      )}

      {deletingParam && (
        <DeleteConfirm
          param={deletingParam}
          isPending={deleteMut.isPending}
          onConfirm={() => deleteMut.mutate(deletingParam.id)}
          onCancel={() => setDeletingParam(undefined)}
        />
      )}
    </div>
  )
}
