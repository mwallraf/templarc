/**
 * AdminFeatures — Feature management page.
 *
 * Layout (two-panel):
 *   Left:  project selector + feature list for selected project
 *   Right: feature editor with two tabs — Snippet (body) + Parameters
 *
 * What is a Feature?
 *   A Feature is a reusable add-on snippet with its own parameters.
 *   It is attached to templates and can be toggled on/off at render time
 *   by the user — no Jinja2 knowledge required. The renderer appends each
 *   enabled feature's rendered output after the main template body.
 *
 * Contrast with Templates (full config outputs) and Quickpads (ad-hoc personal pads).
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listProjects } from '../../api/catalog'
import {
  listFeatures,
  createFeature,
  updateFeature,
  deleteFeature,
  getFeatureBody,
  updateFeatureBody,
  listFeatureParameters,
  createFeatureParameter,
  deleteFeatureParameter,
} from '../../api/features'
import type { FeatureOut, FeatureParameterOut, ProjectOut } from '../../api/types'
import AiAssistModal, { type InsertMode } from '../../components/AiAssistModal'

// ── Helpers ──────────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 border'
const inputSty = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }

// ── Parameters sub-panel ─────────────────────────────────────────────────────

interface ParamsPanelProps {
  featureId: number
}

const WIDGET_TYPES = ['text', 'number', 'textarea', 'select', 'readonly', 'hidden']

function ParamsPanel({ featureId }: ParamsPanelProps) {
  const qc = useQueryClient()
  const [newParam, setNewParam] = useState({ name: '', label: '', widget_type: 'text', default_value: '', required: false })
  const [showAdd, setShowAdd] = useState(false)

  const { data: params = [], isLoading } = useQuery({
    queryKey: ['feature-params', featureId],
    queryFn: () => listFeatureParameters(featureId),
  })

  const addMut = useMutation({
    mutationFn: () => createFeatureParameter(featureId, {
      name: newParam.name,
      label: newParam.label || undefined,
      widget_type: newParam.widget_type,
      default_value: newParam.default_value || undefined,
      required: newParam.required,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature-params', featureId] })
      qc.invalidateQueries({ queryKey: ['features'] })
      setNewParam({ name: '', label: '', widget_type: 'text', default_value: '', required: false })
      setShowAdd(false)
    },
  })

  const delMut = useMutation({
    mutationFn: (paramId: number) => deleteFeatureParameter(featureId, paramId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature-params', featureId] })
      qc.invalidateQueries({ queryKey: ['features'] })
    },
  })

  if (isLoading) return <p className="text-xs italic py-4 text-center" style={{ color: 'var(--c-muted-4)' }}>Loading…</p>

  return (
    <div className="space-y-3">
      {/* Help callout */}
      <div
        className="rounded-lg px-3 py-2.5 text-xs space-y-1"
        style={{ backgroundColor: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}
      >
        <p className="font-semibold" style={{ color: '#a5b4fc' }}>What are parameters for?</p>
        <p style={{ color: 'var(--c-muted-3)' }}>
          Each parameter maps to a variable you use in the Snippet Body (e.g.{' '}
          <code className="font-mono px-1 rounded" style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#c7d2fe' }}>
            {'{{ snmp.community }}'}
          </code>
          ). When a user enables this feature at render time, these fields appear in the form and their values are injected into the snippet automatically.
        </p>
        <p style={{ color: 'var(--c-muted-4)' }}>
          You can write the snippet first and add parameters later — order doesn't matter.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs font-medium" style={{ color: 'var(--c-muted-3)' }}>
          {params.length} parameter{params.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="text-xs px-2.5 py-1 rounded-md text-white transition-colors"
          style={{ backgroundColor: showAdd ? '#4f46e5' : '#6366f1' }}
        >
          {showAdd ? '× Cancel' : '+ Add parameter'}
        </button>
      </div>

      {showAdd && (
        <div
          className="rounded-lg p-3 space-y-2 border"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-bright)' }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--c-muted-3)' }}>Name *</label>
              <input
                value={newParam.name}
                onChange={(e) => setNewParam((p) => ({ ...p, name: e.target.value }))}
                placeholder="snmp.community"
                className={inputCls}
                style={inputSty}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--c-muted-3)' }}>Label</label>
              <input
                value={newParam.label}
                onChange={(e) => setNewParam((p) => ({ ...p, label: e.target.value }))}
                placeholder="Community string"
                className={inputCls}
                style={inputSty}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--c-muted-3)' }}>Widget</label>
              <select
                value={newParam.widget_type}
                onChange={(e) => setNewParam((p) => ({ ...p, widget_type: e.target.value }))}
                className={inputCls}
                style={inputSty}
              >
                {WIDGET_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--c-muted-3)' }}>Default value</label>
              <input
                value={newParam.default_value}
                onChange={(e) => setNewParam((p) => ({ ...p, default_value: e.target.value }))}
                placeholder="(optional)"
                className={inputCls}
                style={inputSty}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="req-param"
              checked={newParam.required}
              onChange={(e) => setNewParam((p) => ({ ...p, required: e.target.checked }))}
              className="accent-indigo-500"
            />
            <label htmlFor="req-param" className="text-xs" style={{ color: 'var(--c-muted-3)' }}>Required</label>
          </div>
          <button
            onClick={() => addMut.mutate()}
            disabled={!newParam.name.trim() || addMut.isPending}
            className="w-full py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-50 transition-colors"
            style={{ backgroundColor: '#6366f1' }}
          >
            {addMut.isPending ? 'Adding…' : 'Add parameter'}
          </button>
        </div>
      )}

      {params.length === 0 && !showAdd && (
        <p className="text-xs italic text-center py-4" style={{ color: 'var(--c-muted-4)' }}>
          No parameters yet. Add one for each{' '}
          <code className="font-mono not-italic" style={{ color: '#818cf8' }}>{'{{ variable }}'}</code>{' '}
          used in your snippet body.
        </p>
      )}

      {params.map((p: FeatureParameterOut) => (
        <div
          key={p.id}
          className="flex items-center justify-between rounded-md px-3 py-2 gap-3"
          style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono truncate" style={{ color: '#818cf8' }}>{p.name}</p>
            <p className="text-xs truncate" style={{ color: 'var(--c-muted-3)' }}>
              {p.label || p.name} · {p.widget_type}
              {p.required && <span className="ml-1 text-red-400">*</span>}
              {p.default_value && <span className="ml-1 opacity-60">default: {p.default_value}</span>}
            </p>
          </div>
          <button
            onClick={() => delMut.mutate(p.id)}
            className="text-xs shrink-0 transition-colors"
            style={{ color: 'var(--c-muted-4)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#f87171' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-4)' }}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Feature editor panel ─────────────────────────────────────────────────────

interface EditorPanelProps {
  feature: FeatureOut
  onDeleted: () => void
}

function EditorPanel({ feature, onDeleted }: EditorPanelProps) {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'snippet' | 'parameters'>('snippet')
  const [body, setBody] = useState('')
  const [bodyLoaded, setBodyLoaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [label, setLabel] = useState(feature.label)
  const [showAI, setShowAI] = useState(false)

  // Load body lazily when switching to snippet tab
  const { isFetching: bodyFetching } = useQuery({
    queryKey: ['feature-body', feature.id],
    queryFn: () => getFeatureBody(feature.id),
    enabled: activeTab === 'snippet' && !bodyLoaded,
    onSuccess: (data: { body: string }) => {
      setBody(data.body)
      setBodyLoaded(true)
    },
  } as Parameters<typeof useQuery>[0])

  const saveBodyMut = useMutation({
    mutationFn: () => updateFeatureBody(feature.id, { body, commit_message: `Update ${feature.name} snippet` }),
    onSuccess: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const updateMut = useMutation({
    mutationFn: () => updateFeature(feature.id, { label }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['features'] }),
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteFeature(feature.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['features'] })
      onDeleted()
    },
  })

  const JINJA_SNIPPETS = [
    { label: '{{ var }}', insert: '{{ variable }}' },
    { label: '{% if %}', insert: '{% if condition %}\n\n{% endif %}' },
    { label: '{% for %}', insert: '{% for item in items %}\n{{ item }}\n{% endfor %}' },
  ]

  function handleAIAccept(text: string, mode: InsertMode) {
    if (mode === 'replace') {
      setBody(text)
    } else if (mode === 'append') {
      setBody((prev) => (prev ? prev + '\n' + text : text))
    } else {
      setBody((prev) => prev + text)
    }
    setShowAI(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b" style={{ borderColor: 'var(--c-border)' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4" style={{ color: '#818cf8' }}>
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => label !== feature.label && updateMut.mutate()}
              className="w-full text-sm font-semibold bg-transparent border-none outline-none"
              style={{ color: 'var(--c-text)' }}
            />
            <p className="text-xs font-mono truncate" style={{ color: 'var(--c-muted-3)' }}>
              {feature.name}
            </p>
          </div>
          <span
            className="text-xs px-2 py-0.5 rounded shrink-0"
            style={
              feature.is_active
                ? { backgroundColor: 'rgba(52,211,153,0.1)', color: '#34d399' }
                : { backgroundColor: 'rgba(148,163,184,0.1)', color: 'var(--c-muted-4)' }
            }
          >
            {feature.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Snippet path */}
        {feature.snippet_path && (
          <p className="mt-2 text-xs font-mono truncate" style={{ color: 'var(--c-muted-4)' }}>
            📁 {feature.snippet_path}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 border-b" style={{ borderColor: 'var(--c-border)' }}>
        {(['snippet', 'parameters'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-xs font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-indigo-500 text-indigo-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab === 'parameters'
              ? `Parameters (${feature.parameters.length})`
              : 'Snippet Body'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'snippet' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs" style={{ color: 'var(--c-muted-3)' }}>
                Plain Jinja2 — no frontmatter needed. Variables reference the same context as the parent template.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {JINJA_SNIPPETS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => setBody((b) => b + s.insert)}
                  className="px-2 py-0.5 rounded text-xs font-mono transition-colors"
                  style={{
                    backgroundColor: 'var(--c-surface)',
                    border: '1px solid var(--c-border-bright)',
                    color: '#818cf8',
                  }}
                >
                  {s.label}
                </button>
              ))}
              <button
                onClick={() => setShowAI(true)}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-all"
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
            </div>
            {bodyFetching && !bodyLoaded ? (
              <p className="text-xs italic" style={{ color: 'var(--c-muted-4)' }}>Loading from Git…</p>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={18}
                placeholder={'! SNMP configuration\nsnmp-server community {{ snmp.community }} RO\nsnmp-server version {{ snmp.version }}'}
                className="w-full rounded-md px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 border resize-none"
                style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', color: 'var(--c-muted-1)' }}
              />
            )}
          </div>
        )}

        {activeTab === 'parameters' && <ParamsPanel featureId={feature.id} />}
      </div>

      {/* AI assistant modal */}
      {showAI && (
        <AiAssistModal
          registeredParams={feature.parameters.map((p) => p.name)}
          existingBody={body || undefined}
          onAccept={handleAIAccept}
          onClose={() => setShowAI(false)}
        />
      )}

      {/* Footer */}
      <div
        className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-t"
        style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface-alt)' }}
      >
        <div className="flex gap-2">
          {confirmDelete ? (
            <>
              <span className="text-xs text-red-400 self-center">Delete this feature?</span>
              <button
                onClick={() => deleteMut.mutate()}
                className="px-3 py-1.5 rounded-md text-xs bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 rounded-md text-xs transition-colors"
                style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-3)' }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-3 py-1.5 rounded-md text-xs transition-colors"
              style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-3)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#f87171' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-3)' }}
            >
              Delete
            </button>
          )}
        </div>

        {activeTab === 'snippet' && (
          <button
            onClick={() => saveBodyMut.mutate()}
            disabled={saveBodyMut.isPending}
            className="px-4 py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-50 transition-colors"
            style={{ backgroundColor: saved ? '#059669' : '#6366f1' }}
          >
            {saveBodyMut.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save to Git'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Create feature form ──────────────────────────────────────────────────────

interface CreateFormProps {
  projectId: number
  onCreated: (feature: FeatureOut) => void
  onCancel: () => void
}

function CreateForm({ projectId, onCreated, onCancel }: CreateFormProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', label: '' })
  const mut = useMutation({
    mutationFn: () => createFeature({ project_id: projectId, name: form.name, label: form.label }),
    onSuccess: (feature) => {
      qc.invalidateQueries({ queryKey: ['features', projectId] })
      onCreated(feature)
    },
  })

  return (
    <div
      className="mx-3 mb-3 rounded-lg p-3 space-y-2 border"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-bright)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--c-muted-1)' }}>New feature</p>
      <div>
        <label className="block text-xs mb-1" style={{ color: 'var(--c-muted-3)' }}>Name (slug) *</label>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
          placeholder="snmp_monitoring"
          className={inputCls}
          style={inputSty}
          autoFocus
        />
      </div>
      <div>
        <label className="block text-xs mb-1" style={{ color: 'var(--c-muted-3)' }}>Label *</label>
        <input
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          placeholder="SNMP Monitoring"
          className={inputCls}
          style={inputSty}
        />
      </div>
      {mut.isError && (
        <p className="text-xs text-red-400">
          {(mut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Create failed'}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => mut.mutate()}
          disabled={!form.name.trim() || !form.label.trim() || mut.isPending}
          className="flex-1 py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-50 transition-colors"
          style={{ backgroundColor: '#6366f1' }}
        >
          {mut.isPending ? 'Creating…' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-xs transition-colors"
          style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted-3)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function AdminFeatures() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<FeatureOut | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  })

  const { data: featureList, isLoading } = useQuery({
    queryKey: ['features', selectedProjectId],
    queryFn: () => listFeatures(selectedProjectId ?? undefined, true),
    enabled: selectedProjectId != null,
  })

  const features = featureList?.items ?? []

  function handleCreated(feature: FeatureOut) {
    setSelectedFeature(feature)
    setShowCreate(false)
  }

  function handleDeleted() {
    setSelectedFeature(null)
  }

  return (
    <div className="-mx-6 -mb-6 flex" style={{ height: 'calc(100vh - 8rem)' }}>

      {/* Left: project selector + feature list */}
      <div className="w-64 shrink-0 flex flex-col border-r" style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}>
        {/* Header */}
        <div className="shrink-0 px-3 py-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-sm font-semibold text-slate-200">Features</h2>
            {selectedProjectId != null && (
              <button
                onClick={() => { setShowCreate(true); setSelectedFeature(null) }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-white transition-colors"
                style={{ backgroundColor: '#6366f1' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#4f46e5' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#6366f1' }}
              >
                <span className="text-base leading-none">+</span> New
              </button>
            )}
          </div>

          {/* Project selector */}
          <select
            value={selectedProjectId ?? ''}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null
              setSelectedProjectId(id)
              setSelectedFeature(null)
              setShowCreate(false)
            }}
            className="w-full rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 border"
            style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
          >
            <option value="">Select a project…</option>
            {(projects as ProjectOut[]).map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
        </div>

        {/* Create form */}
        {showCreate && selectedProjectId != null && (
          <CreateForm
            projectId={selectedProjectId}
            onCreated={handleCreated}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {/* Feature list */}
        <div className="flex-1 overflow-y-auto">
          {selectedProjectId == null && (
            <p className="text-center text-xs italic py-8" style={{ color: 'var(--c-muted-4)' }}>
              Select a project to see its features
            </p>
          )}
          {selectedProjectId != null && isLoading && (
            <p className="text-center text-xs italic py-8" style={{ color: 'var(--c-muted-4)' }}>Loading…</p>
          )}
          {selectedProjectId != null && !isLoading && features.length === 0 && !showCreate && (
            <p className="text-center text-xs italic py-8" style={{ color: 'var(--c-muted-4)' }}>No features yet</p>
          )}
          {features.map((f: FeatureOut) => {
            const isSelected = selectedFeature?.id === f.id
            return (
              <button
                key={f.id}
                onClick={() => { setSelectedFeature(f); setShowCreate(false) }}
                className="w-full text-left px-3 py-2.5 transition-colors border-b"
                style={{
                  borderColor: 'var(--c-surface)',
                  backgroundColor: isSelected ? 'rgba(99,102,241,0.1)' : 'transparent',
                }}
                onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.03)' }}
                onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: f.is_active ? '#34d399' : '#64748b' }}
                  />
                  <span className={`text-xs font-medium truncate ${isSelected ? 'text-indigo-300' : 'text-slate-300'}`}>
                    {f.label}
                  </span>
                </div>
                <p className="text-xs mt-0.5 font-mono pl-3.5 truncate" style={{ color: 'var(--c-muted-4)' }}>
                  {f.name}
                </p>
                {f.parameters.length > 0 && (
                  <p className="text-xs mt-0.5 pl-3.5" style={{ color: 'var(--c-muted-4)' }}>
                    {f.parameters.length} param{f.parameters.length !== 1 ? 's' : ''}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Right: editor or empty state */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--c-base)' }}>
        {selectedFeature ? (
          <EditorPanel
            key={selectedFeature.id}
            feature={selectedFeature}
            onDeleted={handleDeleted}
          />
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 px-8 text-center">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8" style={{ color: '#6366f1' }}>
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-300 mb-1">Features</p>
              <p className="text-xs max-w-xs" style={{ color: 'var(--c-muted-3)' }}>
                Features are reusable add-on snippets with their own parameters. They're attached to templates and
                users can toggle them on or off at render time — no Jinja2 knowledge required.
              </p>
            </div>
            <div
              className="text-left rounded-xl p-4 text-xs space-y-2 max-w-sm"
              style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}
            >
              <p className="font-medium text-slate-300 mb-2">How it works:</p>
              <div className="flex gap-2"><span style={{ color: '#818cf8' }}>1.</span><span style={{ color: 'var(--c-muted-3)' }}>Create a feature and write its Jinja2 snippet</span></div>
              <div className="flex gap-2"><span style={{ color: '#818cf8' }}>2.</span><span style={{ color: 'var(--c-muted-3)' }}>Add parameters the snippet needs (e.g. snmp.community)</span></div>
              <div className="flex gap-2"><span style={{ color: '#818cf8' }}>3.</span><span style={{ color: 'var(--c-muted-3)' }}>Attach it to templates in the Template Editor → Features tab</span></div>
              <div className="flex gap-2"><span style={{ color: '#818cf8' }}>4.</span><span style={{ color: 'var(--c-muted-3)' }}>Users toggle features on/off in the render form — done!</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
