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
} from '../../api/admin'
import type { CustomFilterCreate, CustomObjectCreate, FilterTestResult } from '../../api/types'

// ── Shared helpers ────────────────────────────────────────────────────────────

const FILTER_PLACEHOLDER = `def my_filter(value):
    return str(value).upper()`

const OBJECT_PLACEHOLDER = `class Router:
    def __init__(self, site_id):
        self.site_id = site_id`

const inputClass = 'w-full rounded-lg px-3 py-2 text-sm text-slate-100 border transition-colors focus:outline-none'
const inputStyle = { backgroundColor: '#141828', borderColor: '#2a3255' }

function CodeEditor({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#2a3255' }}>
      <Editor
        height="220px"
        defaultLanguage="python"
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
            ? { border: '1px solid #2a3255', color: '#8892b0', backgroundColor: 'transparent' }
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
          style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}
        >
          <h3 className="font-semibold text-white font-display">New Filter</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Name</label>
              <input className={`${inputClass} font-mono`} style={inputStyle} placeholder="e.g. to_upper" {...register('name', { required: true })} />
              <p className="text-xs mt-1" style={{ color: '#3d4777' }}>lowercase letters, digits, underscores</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Scope</label>
              <select className={inputClass} style={{ ...inputStyle, color: '#e2e8f4' }} {...register('scope')}>
                <option value="global" style={{ backgroundColor: '#141828' }}>Global (all projects)</option>
                <option value="project" style={{ backgroundColor: '#141828' }}>Project-scoped</option>
              </select>
            </div>
          </div>

          {scope === 'project' && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Project ID</label>
              <input type="number" className={inputClass} style={inputStyle} {...register('project_id', { required: scope === 'project', valueAsNumber: true })} />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Description (optional)</label>
            <input className={inputClass} style={inputStyle} {...register('description')} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: '#8892b0' }}>Filter code</label>
            <CodeEditor value={code} onChange={setCode} placeholder={FILTER_PLACEHOLDER} />
          </div>

          {/* Test panel */}
          <div className="rounded-lg p-3 space-y-2.5" style={{ backgroundColor: '#0a0d1a', border: '1px solid #1e2440' }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#3d4777' }}>Test</p>
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
                style={{ backgroundColor: '#1c2235', color: '#8892b0', border: '1px solid #2a3255' }}
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
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}>
          {!filters?.length ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: '#546485' }}>No custom filters registered.</p>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: '#0a0d1a', borderBottom: '1px solid #1e2440' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Scope</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Description</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Created by</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filters.map((f, idx) => (
                  <tr key={f.id} style={{ borderBottom: idx < filters.length - 1 ? '1px solid #1e2440' : 'none' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: '#8892b0' }}>{f.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full border font-medium"
                        style={f.scope === 'global'
                          ? { backgroundColor: 'rgba(96,165,250,0.1)', color: '#60a5fa', borderColor: 'rgba(96,165,250,0.2)' }
                          : { backgroundColor: 'rgba(167,139,250,0.1)', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.2)' }
                        }
                      >
                        {f.scope}{f.project_id ? ` #${f.project_id}` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#546485' }}>{f.description ?? '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#3d4777' }}>{f.created_by ?? '—'}</td>
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

// ── Objects tab ───────────────────────────────────────────────────────────────

function ObjectsTab() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [code, setCode] = useState('')

  const { data: objects, isLoading } = useQuery({
    queryKey: ['admin-objects'],
    queryFn: () => listObjects(),
  })

  const { register, handleSubmit, reset } = useForm<CustomObjectCreate>()

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
            ? { border: '1px solid #2a3255', color: '#8892b0', backgroundColor: 'transparent' }
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
          style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}
        >
          <h3 className="font-semibold text-white font-display">New Context Object</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Name</label>
              <input className={`${inputClass} font-mono`} style={inputStyle} placeholder="e.g. Router" {...register('name', { required: true })} />
              <p className="text-xs mt-1" style={{ color: '#3d4777' }}>accessible in templates as this name</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Project ID (optional)</label>
              <input type="number" className={inputClass} style={inputStyle} placeholder="leave blank for global" {...register('project_id', { valueAsNumber: true })} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Description (optional)</label>
            <input className={inputClass} style={inputStyle} {...register('description')} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: '#8892b0' }}>Object code</label>
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
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}>
          {!objects?.length ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: '#546485' }}>No custom objects registered.</p>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: '#0a0d1a', borderBottom: '1px solid #1e2440' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Project</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Description</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Created by</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {objects.map((o, idx) => (
                  <tr key={o.id} style={{ borderBottom: idx < objects.length - 1 ? '1px solid #1e2440' : 'none' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: '#8892b0' }}>{o.name}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#546485' }}>{o.project_id ? `#${o.project_id}` : 'Global'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#546485' }}>{o.description ?? '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#3d4777' }}>{o.created_by ?? '—'}</td>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminFilters() {
  const [activeTab, setActiveTab] = useState<'filters' | 'objects'>('filters')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white font-display">Filters & Objects</h1>
        <p className="text-sm mt-1" style={{ color: '#546485' }}>Custom Jinja2 filters and context objects</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ backgroundColor: '#0d1021', border: '1px solid #1e2440' }}>
        {(['filters', 'objects'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-5 py-2 text-sm font-medium rounded-lg transition-all capitalize"
            style={activeTab === tab
              ? { backgroundColor: '#1c2235', color: '#e2e8f4', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }
              : { color: '#546485' }
            }
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'filters' ? <FiltersTab /> : <ObjectsTab />}
    </div>
  )
}
