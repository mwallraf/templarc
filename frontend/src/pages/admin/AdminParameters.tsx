import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listParameters,
  deleteParameter,
  createParameter,
  createParameterOption,
} from '../../api/parameters'
import { findDuplicateParameters, promoteParameter } from '../../api/admin'
import { listProjects } from '../../api/catalog'
import type { DuplicateParameterGroup, ParameterOut, ParameterScope, PromoteReport } from '../../api/types'
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
      <div className="rounded-2xl border w-full max-w-md p-6" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', boxShadow: '0 24px 48px rgba(0,0,0,0.6)' }}>
        <h3 className="font-semibold text-white mb-2 font-display">Delete parameter?</h3>
        <p className="text-sm mb-3" style={{ color: 'var(--c-muted-2)' }}>
          You are about to delete{' '}
          <code className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--c-card)', color: 'var(--c-text)' }}>
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
            style={{ borderColor: 'var(--c-border-bright)', color: 'var(--c-muted-2)' }}
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
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <td className="px-4 py-3 font-mono text-xs max-w-xs" style={{ color: 'var(--c-muted-2)' }}>
        <span className="truncate block">{param.name}</span>
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: 'var(--c-text)' }}>
        {param.label ?? <span className="italic" style={{ color: 'var(--c-muted-4)' }}>—</span>}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs px-2 py-0.5 rounded-full border font-medium" style={{ backgroundColor: s.bg, color: s.text, borderColor: s.border }}>
          {SCOPE_LABEL[param.scope]}
        </span>
      </td>
      <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--c-muted-3)' }}>{param.widget_type}</td>
      <td className="px-4 py-3 text-xs text-center">
        {param.required ? (
          <span className="text-red-400 font-semibold">Yes</span>
        ) : (
          <span style={{ color: 'var(--c-border-bright)' }}>No</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-center">
        {param.is_derived && (
          <span className="px-1.5 py-0.5 rounded-full text-xs border" style={{ backgroundColor: 'rgba(167,139,250,0.1)', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.2)' }}>
            derived
          </span>
        )}
        {param.options.length > 0 && (
          <span style={{ color: 'var(--c-muted-4)' }}>{param.options.length} opts</span>
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
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--c-muted-3)' }}>{title}</h2>
        <span
          className="text-xs px-2 py-0.5 rounded-full ml-1"
          style={{ backgroundColor: 'var(--c-card)', color: 'var(--c-muted-4)', border: '1px solid var(--c-border-bright)' }}
        >
          {params.length}
        </span>
      </div>
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
        <table className="w-full text-sm">
          <thead style={{ backgroundColor: 'var(--c-surface-alt)', borderBottom: '1px solid var(--c-border)' }}>
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Name</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Label</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Scope</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Widget</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Req.</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Info</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {params.map((p, idx) => (
              <tr key={p.id} style={{ borderBottom: idx < params.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
                <td className="px-4 py-3 font-mono text-xs max-w-xs" style={{ color: 'var(--c-muted-2)' }}>
                  <span className="truncate block">{p.name}</span>
                </td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--c-text)' }}>
                  {p.label ?? <span className="italic" style={{ color: 'var(--c-muted-4)' }}>—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2 py-0.5 rounded-full border font-medium" style={{ backgroundColor: SCOPE_STYLE[p.scope].bg, color: SCOPE_STYLE[p.scope].text, borderColor: SCOPE_STYLE[p.scope].border }}>
                    {SCOPE_LABEL[p.scope]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--c-muted-3)' }}>{p.widget_type}</td>
                <td className="px-4 py-3 text-xs text-center">
                  {p.required ? <span className="text-red-400 font-semibold">Yes</span> : <span style={{ color: 'var(--c-border-bright)' }}>No</span>}
                </td>
                <td className="px-4 py-3 text-xs text-center">
                  {p.is_derived && <span className="px-1.5 py-0.5 rounded-full text-xs border" style={{ backgroundColor: 'rgba(167,139,250,0.1)', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.2)' }}>derived</span>}
                  {p.options.length > 0 && <span style={{ color: 'var(--c-muted-4)' }}>{p.options.length} opts</span>}
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

// ── Promote dialog ────────────────────────────────────────────────────────────

interface PromoteDialogProps {
  group: DuplicateParameterGroup
  onConfirm: (toName: string) => void
  onCancel: () => void
  isPending: boolean
  result: PromoteReport | null
}

function PromoteDialog({ group, onConfirm, onCancel, isPending, result }: PromoteDialogProps) {
  const suggested = `proj.${group.name}`
  const [toName, setToName] = useState(suggested)
  const isValid = toName.startsWith('proj.') || toName.startsWith('glob.')

  if (result) {
    // Show success summary
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}>
        <div className="rounded-2xl border w-full max-w-lg p-6" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', boxShadow: '0 24px 48px rgba(0,0,0,0.6)' }}>
          <div className="flex items-center gap-2.5 mb-4">
            <svg className="w-5 h-5 shrink-0" style={{ color: '#34d399' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="font-semibold text-white font-display">Promote complete</h3>
          </div>
          <div className="space-y-2 mb-5 text-sm" style={{ color: 'var(--c-muted-2)' }}>
            <div className="flex justify-between">
              <span>New parameter ID</span>
              <code className="font-mono text-xs" style={{ color: '#6366f1' }}>#{result.created_param_id}</code>
            </div>
            <div className="flex justify-between">
              <span>Deleted template copies</span>
              <span style={{ color: 'var(--c-text)' }}>{result.deleted_param_ids.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Git files rewritten</span>
              <span style={{ color: '#34d399' }}>{result.git_files_rewritten}</span>
            </div>
          </div>
          {result.template_rewrites.length > 0 && (
            <div className="rounded-lg overflow-hidden mb-5" style={{ backgroundColor: 'var(--c-base)', border: '1px solid var(--c-border)' }}>
              {result.template_rewrites.map((r, i) => (
                <div
                  key={r.template_id}
                  className="flex items-center gap-2 px-3 py-2 text-xs"
                  style={{ borderBottom: i < result.template_rewrites.length - 1 ? '1px solid var(--c-surface-alt)' : 'none' }}
                >
                  {r.error ? (
                    <svg className="w-3.5 h-3.5 shrink-0" style={{ color: '#ef4444' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  ) : r.rewritten ? (
                    <svg className="w-3.5 h-3.5 shrink-0" style={{ color: '#34d399' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--c-muted-3)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  )}
                  <span className="flex-1 truncate font-mono" style={{ color: 'var(--c-muted-2)' }}>{r.git_path ?? r.template_name}</span>
                  {r.error ? (
                    <span style={{ color: '#f87171' }}>{r.error}</span>
                  ) : r.rewritten ? (
                    <span style={{ color: 'var(--c-muted-3)' }}>{r.replacements} replacement{r.replacements !== 1 ? 's' : ''}</span>
                  ) : (
                    <span style={{ color: 'var(--c-muted-4)' }}>no match</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-semibold text-white rounded-lg transition-all"
              style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}>
      <div className="rounded-2xl border w-full max-w-md p-6" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', boxShadow: '0 24px 48px rgba(0,0,0,0.6)' }}>
        <h3 className="font-semibold text-white mb-1 font-display">Promote parameter</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--c-muted-3)' }}>
          Creates a single project-scope parameter, removes {group.count} template copies, and rewrites {group.count} template file{group.count !== 1 ? 's' : ''}.
        </p>

        {/* From → To */}
        <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 mb-4 text-xs font-mono" style={{ backgroundColor: 'var(--c-base)', border: '1px solid var(--c-border)' }}>
          <span style={{ color: 'var(--c-muted-3)' }}>From</span>
          <code style={{ color: 'var(--c-text)' }}>{group.name}</code>
          <svg className="w-3 h-3 mx-1 shrink-0" style={{ color: 'var(--c-muted-4)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span style={{ color: 'var(--c-muted-3)' }}>To</span>
          <code style={{ color: '#818cf8' }}>{toName}</code>
        </div>

        {/* New name input */}
        <div className="mb-4">
          <label className="block text-xs mb-1.5" style={{ color: 'var(--c-muted-3)' }}>New parameter name</label>
          <input
            type="text"
            value={toName}
            onChange={(e) => setToName(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm font-mono border focus:outline-none"
            style={{ backgroundColor: 'var(--c-card)', borderColor: isValid ? 'var(--c-border-bright)' : '#ef4444', color: 'var(--c-text)' }}
            placeholder="proj.service_id"
          />
          {!isValid && (
            <p className="mt-1 text-xs" style={{ color: '#f87171' }}>Must start with <code>proj.</code> or <code>glob.</code></p>
          )}
        </div>

        {/* Affected templates */}
        <div className="rounded-lg overflow-hidden mb-5" style={{ backgroundColor: 'var(--c-base)', border: '1px solid var(--c-border)' }}>
          <div className="px-3 py-1.5 border-b text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)', borderColor: 'var(--c-surface-alt)' }}>
            Affected templates
          </div>
          {group.templates.map((ref, i) => (
            <div
              key={ref.template_id}
              className="px-3 py-2 text-xs"
              style={{ borderBottom: i < group.templates.length - 1 ? '1px solid var(--c-surface-alt)' : 'none', color: 'var(--c-muted-2)' }}
            >
              {ref.template_display_name}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border transition-colors"
            style={{ borderColor: 'var(--c-border-bright)', color: 'var(--c-muted-2)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(toName)}
            disabled={isPending || !isValid}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
          >
            {isPending ? 'Promoting…' : 'Promote'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Duplicates panel ─────────────────────────────────────────────────────────

function DuplicatesPanel({ projectId }: { projectId: number | undefined }) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [promotingGroup, setPromotingGroup] = useState<DuplicateParameterGroup | null>(null)
  const [promoteResult, setPromoteResult] = useState<PromoteReport | null>(null)
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['param-duplicates', projectId],
    queryFn: () => findDuplicateParameters(projectId),
  })

  const promoteMut = useMutation({
    mutationFn: (toName: string) =>
      promoteParameter({ from_name: promotingGroup!.name, to_name: toName, project_id: promotingGroup!.project_id }),
    onSuccess: (report) => {
      setPromoteResult(report)
      qc.invalidateQueries({ queryKey: ['param-duplicates'] })
      qc.invalidateQueries({ queryKey: ['parameters'] })
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-2 mt-4">
        {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
      </div>
    )
  }

  if (error) {
    return (
      <p className="mt-4 text-sm" style={{ color: '#ef4444' }}>
        Failed to load duplicates.
      </p>
    )
  }

  const report = data!
  if (report.total_duplicate_names === 0) {
    return (
      <div
        className="mt-4 rounded-xl border px-6 py-10 text-center"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        <svg className="w-8 h-8 mx-auto mb-3" style={{ color: '#34d399' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm font-medium" style={{ color: '#34d399' }}>No duplicate parameters found</p>
        <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
          {projectId ? 'All template parameters in this project are unique.' : 'All template parameters across all projects are unique.'}
        </p>
      </div>
    )
  }

  // Group by project
  const byProject = new Map<number, { name: string; groups: DuplicateParameterGroup[] }>()
  for (const g of report.groups) {
    if (!byProject.has(g.project_id)) {
      byProject.set(g.project_id, { name: g.project_display_name, groups: [] })
    }
    byProject.get(g.project_id)!.groups.push(g)
  }

  return (
    <div className="mt-4 space-y-2">
      {/* Summary bar */}
      <div
        className="flex items-center gap-6 rounded-xl border px-4 py-3"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        <Stat label="Duplicate names" value={report.total_duplicate_names} />
        <div className="w-px h-8" style={{ backgroundColor: 'var(--c-border)' }} />
        <Stat label="Redundant definitions" value={report.total_redundant_params} />
        <div className="w-px h-8" style={{ backgroundColor: 'var(--c-border)' }} />
        <Stat
          label="With conflicts"
          value={report.groups.filter((g) => g.has_conflicts).length}
          danger
        />
        <p className="ml-auto text-xs" style={{ color: 'var(--c-muted-4)' }}>
          Conflicts = differing widget type or required flag across templates
        </p>
      </div>

      {/* Groups by project */}
      {Array.from(byProject.entries()).map(([pid, { name, groups }]) => (
        <div
          key={pid}
          className="rounded-xl border overflow-hidden"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          {/* Project header */}
          <div
            className="flex items-center gap-2 px-4 py-2.5 border-b"
            style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}
          >
            <svg className="w-3.5 h-3.5 shrink-0" style={{ color: '#6366f1' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#6366f1' }}>{name}</span>
            <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>({groups.length} duplicate name{groups.length !== 1 ? 's' : ''})</span>
          </div>

          {/* Param groups */}
          <div className="divide-y" style={{ borderColor: 'var(--c-border)' }}>
            {groups.map((g) => {
              const key = `${pid}:${g.name}`
              const isOpen = expandedGroup === key
              return (
                <div key={g.name}>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                    style={{ backgroundColor: 'transparent' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onClick={() => setExpandedGroup(isOpen ? null : key)}
                  >
                    {/* Expand chevron */}
                    <svg
                      className="w-3.5 h-3.5 shrink-0 transition-transform"
                      style={{ color: 'var(--c-muted-4)', transform: isOpen ? 'rotate(90deg)' : 'none' }}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
                    >
                      <polyline points="9 6 15 12 9 18" />
                    </svg>

                    {/* Conflict indicator */}
                    {g.has_conflicts ? (
                      <svg className="w-3.5 h-3.5 shrink-0" style={{ color: '#f59e0b' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--c-muted-3)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}

                    {/* Name */}
                    <code className="font-mono text-xs flex-1" style={{ color: 'var(--c-text)' }}>{g.name}</code>

                    {/* Badges */}
                    <span
                      className="text-xs px-2 py-0.5 rounded-full border"
                      style={{ backgroundColor: 'var(--c-card)', color: 'var(--c-muted-4)', borderColor: 'var(--c-border-bright)' }}
                    >
                      ×{g.count} templates
                    </span>
                    {g.has_conflicts && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full border font-medium"
                        style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.2)' }}
                      >
                        conflict
                      </span>
                    )}
                    {/* Promote button — only for conflict-free groups */}
                    {!g.has_conflicts && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPromotingGroup(g); setPromoteResult(null) }}
                        className="text-xs font-semibold px-2.5 py-0.5 rounded-full border transition-colors"
                        style={{ backgroundColor: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.3)', color: '#818cf8' }}
                        title="Promote to project-scope parameter"
                      >
                        Promote →
                      </button>
                    )}
                  </button>

                  {/* Expanded detail */}
                  {isOpen && (
                    <div className="px-4 pb-4">
                      <table className="w-full text-xs rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--c-base)' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                            <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Template</th>
                            <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Widget</th>
                            <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Label</th>
                            <th className="text-center px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Req.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.templates.map((ref, idx) => (
                            <tr
                              key={ref.param_id}
                              style={{ borderBottom: idx < g.templates.length - 1 ? '1px solid var(--c-surface-alt)' : 'none' }}
                            >
                              <td className="px-3 py-2" style={{ color: 'var(--c-muted-2)' }}>{ref.template_display_name}</td>
                              <td className="px-3 py-2 font-mono" style={{ color: g.has_conflicts && g.templates.some(r => r.widget_type !== ref.widget_type) ? '#f59e0b' : 'var(--c-muted-3)' }}>
                                {ref.widget_type}
                              </td>
                              <td className="px-3 py-2" style={{ color: ref.label ? 'var(--c-muted-2)' : 'var(--c-muted-4)' }}>
                                {ref.label ?? <em>—</em>}
                              </td>
                              <td className="px-3 py-2 text-center" style={{ color: ref.required ? '#f87171' : 'var(--c-muted-4)' }}>
                                {ref.required ? 'Yes' : 'No'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {g.has_conflicts && (
                        <p className="mt-2 text-xs" style={{ color: '#f59e0b' }}>
                          ⚠ Definitions differ — resolve conflicts before promoting to project scope.
                        </p>
                      )}
                      {!g.has_conflicts && (
                        <p className="mt-2 text-xs" style={{ color: 'var(--c-muted-3)' }}>
                          All definitions are consistent — safe to promote to project scope.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {promotingGroup && (
        <PromoteDialog
          group={promotingGroup}
          isPending={promoteMut.isPending}
          result={promoteResult}
          onConfirm={(toName) => promoteMut.mutate(toName)}
          onCancel={() => { setPromotingGroup(null); setPromoteResult(null) }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="text-xl font-bold font-display"
        style={{ color: danger && value > 0 ? '#f59e0b' : 'var(--c-text)' }}
      >
        {value}
      </span>
      <span className="text-xs" style={{ color: 'var(--c-muted-3)' }}>{label}</span>
    </div>
  )
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
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [dupProjectId, setDupProjectId] = useState<number | undefined>(undefined)

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
    enabled: showDuplicates,
  })

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
  const inputStyle = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)', color: 'var(--c-text)' }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white font-display">Parameters</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>Global, project, and template parameter registry</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={params.length === 0}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors disabled:opacity-40 font-medium`}
            style={{ borderColor: 'var(--c-border-bright)', color: 'var(--c-muted-2)', backgroundColor: 'var(--c-card)' }}
          >
            Export YAML
          </button>
          <button
            onClick={() => importRef.current?.click()}
            className="px-3 py-2 text-sm rounded-lg border transition-colors font-medium"
            style={{ borderColor: 'var(--c-border-bright)', color: 'var(--c-muted-2)', backgroundColor: 'var(--c-card)' }}
          >
            Import YAML
          </button>
          <input ref={importRef} type="file" accept=".yaml,.yml" className="hidden" onChange={handleImportFile} />
          <button
            onClick={() => setShowDuplicates((v) => !v)}
            className="px-3 py-2 text-sm rounded-lg border transition-all font-medium flex items-center gap-1.5"
            style={{
              borderColor: showDuplicates ? '#6366f1' : 'var(--c-border-bright)',
              color: showDuplicates ? '#818cf8' : 'var(--c-muted-2)',
              backgroundColor: showDuplicates ? 'rgba(99,102,241,0.08)' : 'var(--c-card)',
            }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Find Duplicates
          </button>
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

      {/* Duplicates panel */}
      {showDuplicates && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>
              Duplicate Template Parameters
            </h2>
            <select
              value={dupProjectId ?? ''}
              onChange={(e) => setDupProjectId(e.target.value === '' ? undefined : Number(e.target.value))}
              className="rounded-lg px-3 py-1.5 text-xs border focus:outline-none"
              style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)', color: dupProjectId ? 'var(--c-text)' : 'var(--c-muted-3)' }}
            >
              <option value="">All projects</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
          </div>
          <DuplicatesPanel projectId={dupProjectId} />
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
          <option value="" style={{ backgroundColor: 'var(--c-card)' }}>All scopes</option>
          <option value="global" style={{ backgroundColor: 'var(--c-card)' }}>Global</option>
          <option value="project" style={{ backgroundColor: 'var(--c-card)' }}>Project</option>
          <option value="template" style={{ backgroundColor: 'var(--c-card)' }}>Template</option>
        </select>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
        </div>
      )}

      {!isLoading && params.length === 0 && (
        <div className="text-center py-16" style={{ color: 'var(--c-muted-4)' }}>
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

          <div className="text-xs text-right mt-2" style={{ color: 'var(--c-dim)' }}>
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
