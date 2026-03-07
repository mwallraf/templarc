import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import Editor from '@monaco-editor/react'
import {
  listFilters,
  createFilter,
  deleteFilter,
  testFilter,
  listObjects,
  createObject,
  deleteObject,
  listMacros,
  createMacro,
  deleteMacro,
} from '../../api/admin'
import { listProjects } from '../../api/catalog'
import type { CustomFilterCreate, CustomObjectCreate, CustomMacroCreate, FilterTestResult } from '../../api/types'

// ── Shared helpers ────────────────────────────────────────────────────────────

const FILTER_PLACEHOLDER = `def my_filter(value):
    return str(value).upper()`

const OBJECT_PLACEHOLDER = `class Router:
    def __init__(self, site_id):
        self.site_id = site_id`

const MACRO_PLACEHOLDER = `{% macro interface_block(name, ip) %}
interface {{ name }}
  ip address {{ ip }}
{% endmacro %}`

const inputClass = 'w-full rounded-lg px-3 py-2 text-sm text-slate-100 border transition-colors focus:outline-none'
const inputStyle = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }
const selectStyle = { ...inputStyle, color: 'var(--c-text)' }

function CodeEditor({
  value,
  onChange,
  placeholder,
  language = 'python',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  language?: string
}) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--c-border-bright)' }}>
      <Editor
        height="220px"
        defaultLanguage={language}
        value={value || placeholder || ''}
        onChange={(v) => onChange(v ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 4,
          insertSpaces: true,
        }}
        theme="vs-dark"
      />
    </div>
  )
}

// Project dropdown used in both Filters and Objects forms
function ProjectSelect({ register }: { register: ReturnType<typeof useForm>['register'] }) {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  })
  return (
    <select className={inputClass} style={selectStyle} {...register('project_id', { valueAsNumber: true })}>
      <option value="" style={{ backgroundColor: 'var(--c-card)' }}>— select project —</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id} style={{ backgroundColor: 'var(--c-card)' }}>
          {p.display_name}
        </option>
      ))}
    </select>
  )
}

// ── Filters tab ───────────────────────────────────────────────────────────────

function FiltersTab() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [code, setCode] = useState('')
  const [testInput, setTestInput] = useState('test_value')
  const [testResult, setTestResult] = useState<FilterTestResult | null>(null)
  const [testRunning, setTestRunning] = useState(false)
  const [deleteWarning, setDeleteWarning] = useState<{ id: number; name: string; used: string[] } | null>(null)

  const { data: filters, isLoading } = useQuery({
    queryKey: ['admin-filters'],
    queryFn: () => listFilters(),
  })

  const { register, handleSubmit, watch, reset } = useForm<CustomFilterCreate>({
    defaultValues: { scope: 'global' },
  })
  const scope = watch('scope')

  const createMut = useMutation({
    mutationFn: (data: CustomFilterCreate) => createFilter({ ...data, code }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-filters'] })
      setShowForm(false); setCode(''); setTestResult(null); reset()
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteFilter,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-filters'] }); setDeleteWarning(null) },
  })

  async function handleTest() {
    if (!code.trim()) return
    setTestRunning(true)
    try { const result = await testFilter(code, testInput); setTestResult(result) }
    finally { setTestRunning(false) }
  }

  async function handleDelete(id: number, name: string) {
    const result = await deleteFilter(id)
    if (result.used_in_templates.length > 0) {
      setDeleteWarning({ id, name, used: result.used_in_templates })
    } else {
      qc.invalidateQueries({ queryKey: ['admin-filters'] })
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white font-display">Custom Filters</h2>
        <button
          onClick={() => { setShowForm((v) => !v); setTestResult(null) }}
          className="px-4 py-2 text-sm font-semibold rounded-lg transition-all"
          style={showForm
            ? { border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)', backgroundColor: 'transparent' }
            : { background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: 'white', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }
          }
        >
          {showForm ? 'Cancel' : 'New Filter'}
        </button>
      </div>

      {deleteWarning && (
        <div className="mb-4 rounded-lg p-4 border" style={{ backgroundColor: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.2)' }}>
          <p className="text-sm font-medium mb-1" style={{ color: '#fbbf24' }}>
            Filter &quot;{deleteWarning.name}&quot; was deleted but is still referenced in:
          </p>
          <ul className="text-sm list-disc list-inside" style={{ color: '#f59e0b' }}>
            {deleteWarning.used.map((t) => <li key={t}>{t}</li>)}
          </ul>
          <button onClick={() => setDeleteWarning(null)} className="mt-2 text-xs underline" style={{ color: '#d97706' }}>Dismiss</button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit((data) => createMut.mutate(data))}
          className="rounded-xl border p-5 mb-6 space-y-4"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <h3 className="font-semibold text-white font-display">New Filter</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Name</label>
              <input className={`${inputClass} font-mono`} style={inputStyle} placeholder="e.g. to_upper" {...register('name', { required: true })} />
              <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>lowercase letters, digits, underscores</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Scope</label>
              <select className={inputClass} style={selectStyle} {...register('scope')}>
                <option value="global" style={{ backgroundColor: 'var(--c-card)' }}>Global (all projects)</option>
                <option value="project" style={{ backgroundColor: 'var(--c-card)' }}>Project-scoped</option>
              </select>
            </div>
          </div>

          {scope === 'project' && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Project</label>
              <ProjectSelect register={register} />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Description (optional)</label>
            <input className={inputClass} style={inputStyle} {...register('description')} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--c-muted-2)' }}>Filter code</label>
            <CodeEditor value={code} onChange={setCode} placeholder={FILTER_PLACEHOLDER} />
          </div>

          {/* Test panel */}
          <div className="rounded-lg p-3 space-y-2.5" style={{ backgroundColor: 'var(--c-surface-alt)', border: '1px solid var(--c-border)' }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--c-muted-4)' }}>Test</p>
            <div className="flex gap-2 items-center">
              <input
                className="flex-1 rounded-lg px-3 py-1.5 text-sm font-mono border focus:outline-none"
                style={inputStyle}
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="test input value"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={testRunning || !code.trim()}
                className="px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                style={{ backgroundColor: 'var(--c-elevated)', color: 'var(--c-muted-2)', border: '1px solid var(--c-border-bright)' }}
              >
                {testRunning ? 'Running…' : 'Run Test'}
              </button>
            </div>
            {testResult && (
              <div
                className="text-xs font-mono rounded-lg px-3 py-2 border"
                style={testResult.ok
                  ? { backgroundColor: 'rgba(52,211,153,0.08)', color: '#34d399', borderColor: 'rgba(52,211,153,0.2)' }
                  : { backgroundColor: 'rgba(239,68,68,0.08)', color: '#f87171', borderColor: 'rgba(239,68,68,0.2)' }
                }
              >
                {testResult.ok ? `Output: ${testResult.output}` : `Error: ${testResult.error}`}
              </div>
            )}
          </div>

          {createMut.isError && (
            <p className="text-xs text-red-400">{(createMut.error as Error)?.message ?? 'Save failed'}</p>
          )}

          <button
            type="submit"
            disabled={createMut.isPending || !code.trim()}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
          >
            {createMut.isPending ? 'Saving…' : 'Save Filter'}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
          {!filters?.length ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--c-muted-3)' }}>No custom filters registered.</p>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--c-surface-alt)', borderBottom: '1px solid var(--c-border)' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Scope</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Description</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Created by</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filters.map((f, idx) => (
                  <tr key={f.id} style={{ borderBottom: idx < filters.length - 1 ? '1px solid var(--c-border)' : 'none' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>{f.name}</td>
                    <td className="px-4 py-3">
                      <ScopeBadge scope={f.scope} projectId={f.project_id} />
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-3)' }}>{f.description ?? '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-4)' }}>{f.created_by ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(f.id, f.name)}
                        disabled={deleteMut.isPending}
                        className="text-xs font-medium disabled:opacity-50 transition-colors"
                        style={{ color: '#ef4444' }}
                      >
                        Delete
                      </button>
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
}

// ── Shared scope badge ────────────────────────────────────────────────────────

function ScopeBadge({ scope, projectId }: { scope: string; projectId?: number | null }) {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  })
  const projectName = projectId
    ? (projects.find((p) => p.id === projectId)?.display_name ?? `#${projectId}`)
    : null

  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full border font-medium"
      style={scope === 'global'
        ? { backgroundColor: 'rgba(96,165,250,0.1)', color: '#60a5fa', borderColor: 'rgba(96,165,250,0.2)' }
        : { backgroundColor: 'rgba(167,139,250,0.1)', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.2)' }
      }
    >
      {scope}{projectName ? ` · ${projectName}` : ''}
    </span>
  )
}

// ── Objects tab ───────────────────────────────────────────────────────────────

function ObjectsTab() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [code, setCode] = useState('')

  const { data: objects, isLoading } = useQuery({
    queryKey: ['admin-objects'],
    queryFn: () => listObjects(),
  })

  const { register, handleSubmit, watch, reset } = useForm<CustomObjectCreate>({
    defaultValues: { scope: 'global' },
  })
  const scope = watch('scope')

  const createMut = useMutation({
    mutationFn: (data: CustomObjectCreate) => createObject({ ...data, code }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-objects'] })
      setShowForm(false); setCode(''); reset()
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteObject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-objects'] }),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white font-display">Custom Objects</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 text-sm font-semibold rounded-lg transition-all"
          style={showForm
            ? { border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)', backgroundColor: 'transparent' }
            : { background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: 'white', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }
          }
        >
          {showForm ? 'Cancel' : 'New Object'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((data) => createMut.mutate(data))}
          className="rounded-xl border p-5 mb-6 space-y-4"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <h3 className="font-semibold text-white font-display">New Context Object</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Name</label>
              <input className={`${inputClass} font-mono`} style={inputStyle} placeholder="e.g. Router" {...register('name', { required: true })} />
              <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>accessible in templates as this name</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Scope</label>
              <select className={inputClass} style={selectStyle} {...register('scope')}>
                <option value="global" style={{ backgroundColor: 'var(--c-card)' }}>Global (all projects)</option>
                <option value="project" style={{ backgroundColor: 'var(--c-card)' }}>Project-scoped</option>
              </select>
            </div>
          </div>

          {scope === 'project' && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Project</label>
              <ProjectSelect register={register} />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Description (optional)</label>
            <input className={inputClass} style={inputStyle} {...register('description')} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--c-muted-2)' }}>Object code</label>
            <CodeEditor value={code} onChange={setCode} placeholder={OBJECT_PLACEHOLDER} />
          </div>

          {createMut.isError && (
            <p className="text-xs text-red-400">{(createMut.error as Error)?.message ?? 'Save failed'}</p>
          )}

          <button
            type="submit"
            disabled={createMut.isPending || !code.trim()}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
          >
            {createMut.isPending ? 'Saving…' : 'Save Object'}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
          {!objects?.length ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--c-muted-3)' }}>No custom objects registered.</p>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--c-surface-alt)', borderBottom: '1px solid var(--c-border)' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Scope</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Description</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Created by</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {objects.map((o, idx) => (
                  <tr key={o.id} style={{ borderBottom: idx < objects.length - 1 ? '1px solid var(--c-border)' : 'none' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>{o.name}</td>
                    <td className="px-4 py-3">
                      <ScopeBadge scope={o.scope} projectId={o.project_id} />
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-3)' }}>{o.description ?? '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-4)' }}>{o.created_by ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => { if (confirm(`Delete object "${o.name}"?`)) deleteMut.mutate(o.id) }}
                        disabled={deleteMut.isPending}
                        className="text-xs font-medium disabled:opacity-50 transition-colors"
                        style={{ color: '#ef4444' }}
                      >
                        Delete
                      </button>
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
}

// ── Macros tab ────────────────────────────────────────────────────────────────

function MacrosTab() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [body, setBody] = useState('')

  const { data: macros, isLoading } = useQuery({
    queryKey: ['admin-macros'],
    queryFn: () => listMacros(),
  })

  const { register, handleSubmit, watch, reset } = useForm<CustomMacroCreate>({
    defaultValues: { scope: 'global' },
  })
  const scope = watch('scope')

  const createMut = useMutation({
    mutationFn: (data: CustomMacroCreate) => createMacro({ ...data, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-macros'] })
      setShowForm(false); setBody(''); reset()
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteMacro,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-macros'] }),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white font-display">Custom Macros</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted-4)' }}>
            Reusable Jinja2 macros — call them directly in templates without an import
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 text-sm font-semibold rounded-lg transition-all"
          style={showForm
            ? { border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)', backgroundColor: 'transparent' }
            : { background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: 'white', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }
          }
        >
          {showForm ? 'Cancel' : 'New Macro'}
        </button>
      </div>

      {/* Syntax hint */}
      <div
        className="mb-5 rounded-lg p-3 flex gap-3 items-start"
        style={{ backgroundColor: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#818cf8' }}>
          <path d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="text-xs space-y-1" style={{ color: 'var(--c-muted-3)' }}>
          <p>The macro <strong style={{ color: 'var(--c-muted-2)' }}>name</strong> field must match the macro name in the body.</p>
          <p className="font-mono" style={{ color: 'var(--c-muted-4)' }}>
            {'{% macro my_macro(arg1, arg2) %} … {% endmacro %}'}
          </p>
          <p>Templates can call it directly: <span className="font-mono" style={{ color: '#818cf8' }}>{'{{ my_macro("val1", "val2") }}'}</span></p>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((data) => createMut.mutate(data))}
          className="rounded-xl border p-5 mb-6 space-y-4"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <h3 className="font-semibold text-white font-display">New Macro</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Name</label>
              <input
                className={`${inputClass} font-mono`}
                style={inputStyle}
                placeholder="e.g. interface_block"
                {...register('name', { required: true })}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>must match the macro name in the body</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Scope</label>
              <select className={inputClass} style={selectStyle} {...register('scope')}>
                <option value="global" style={{ backgroundColor: 'var(--c-card)' }}>Global (all projects)</option>
                <option value="project" style={{ backgroundColor: 'var(--c-card)' }}>Project-scoped</option>
              </select>
            </div>
          </div>

          {scope === 'project' && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Project</label>
              <ProjectSelect register={register} />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Description (optional)</label>
            <input className={inputClass} style={inputStyle} {...register('description')} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--c-muted-2)' }}>Macro body (Jinja2)</label>
            <CodeEditor value={body} onChange={setBody} placeholder={MACRO_PLACEHOLDER} language="html" />
          </div>

          {createMut.isError && (
            <p className="text-xs text-red-400">{(createMut.error as Error)?.message ?? 'Save failed'}</p>
          )}

          <button
            type="submit"
            disabled={createMut.isPending || !body.trim()}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
          >
            {createMut.isPending ? 'Saving…' : 'Save Macro'}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
          {!macros?.length ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--c-muted-3)' }}>No custom macros registered.</p>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--c-surface-alt)', borderBottom: '1px solid var(--c-border)' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Scope</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Description</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Created by</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {macros.map((m, idx) => (
                  <tr key={m.id} style={{ borderBottom: idx < macros.length - 1 ? '1px solid var(--c-border)' : 'none' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>{m.name}</span>
                      <span className="ml-2 font-mono text-xs" style={{ color: 'var(--c-muted-4)' }}>{'(…)'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <ScopeBadge scope={m.scope} projectId={m.project_id} />
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-3)' }}>{m.description ?? '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-4)' }}>{m.created_by ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => { if (confirm(`Delete macro "${m.name}"?`)) deleteMut.mutate(m.id) }}
                        disabled={deleteMut.isPending}
                        className="text-xs font-medium disabled:opacity-50 transition-colors"
                        style={{ color: '#ef4444' }}
                      >
                        Delete
                      </button>
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
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'filters' | 'objects' | 'macros'

const TAB_LABELS: Record<Tab, string> = {
  filters: 'Filters',
  objects: 'Objects',
  macros: 'Macros',
}

export default function AdminFilters() {
  const [activeTab, setActiveTab] = useState<Tab>('filters')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white font-display">Filters, Objects & Macros</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>Custom Jinja2 filters, context objects, and reusable macros</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-5 py-2 text-sm font-medium rounded-lg transition-all"
            style={activeTab === tab
              ? { backgroundColor: 'var(--c-elevated)', color: 'var(--c-text)', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }
              : { color: 'var(--c-muted-3)' }
            }
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'filters' && <FiltersTab />}
      {activeTab === 'objects' && <ObjectsTab />}
      {activeTab === 'macros' && <MacrosTab />}
    </div>
  )
}
