import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useLocation, Link } from 'react-router-dom'
import { resolveParams, listPresets, createPreset, deletePreset } from '../api/render'
import { getTemplate, getTemplateVariables } from '../api/templates'
import type { RenderPresetOut } from '../api/types'
import DynamicForm, { type DynamicFormHandle } from '../components/DynamicForm'
import ApiCodePanel, { getApiBase } from '../components/ApiCodePanel'
import { useAuth } from '../contexts/AuthContext'

function Spinner() {
  return (
    <div className="flex items-center gap-2.5 text-sm py-12" style={{ color: 'var(--c-muted-3)' }}>
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Loading template…
    </div>
  )
}

// ── Save Preset Dialog ────────────────────────────────────────────────────────

interface SavePresetDialogProps {
  onSave: (name: string, description: string) => void
  onCancel: () => void
  isPending: boolean
  error: string | null
}

function SavePresetDialog({ onSave, onCancel, isPending, error }: SavePresetDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
    >
      <div
        className="rounded-2xl border w-full max-w-md p-6 space-y-4"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        <h2 className="text-base font-semibold text-white">Save as Preset</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-1)' }}>
              Preset name <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. C891F DirectFiber test"
              className="w-full text-sm rounded-lg px-3 py-2 border outline-none"
              style={{ backgroundColor: 'var(--c-base)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-1)' }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional notes about this preset"
              className="w-full text-sm rounded-lg px-3 py-2 border outline-none resize-none"
              style={{ backgroundColor: 'var(--c-base)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
            />
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm px-4 py-2 rounded-lg border transition-colors"
            style={{ color: 'var(--c-muted-3)', borderColor: 'var(--c-border)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim() || isPending}
            onClick={() => onSave(name.trim(), description.trim())}
            className="text-sm px-4 py-2 rounded-lg text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}
          >
            {isPending ? 'Saving…' : 'Save Preset'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Preset toolbar ─────────────────────────────────────────────────────────────

interface PresetToolbarProps {
  presets: RenderPresetOut[]
  onLoadPreset: (preset: RenderPresetOut) => void
  onDeletePreset: (preset: RenderPresetOut) => void
  onSavePreset: () => void
  isDeleting: boolean
}

function PresetToolbar({ presets, onLoadPreset, onDeletePreset, onSavePreset, isDeleting }: PresetToolbarProps) {
  const [selectedId, setSelectedId] = useState('')

  const selectedPreset = presets.find((p) => String(p.id) === selectedId) ?? null

  function handleLoad() {
    if (selectedPreset) onLoadPreset(selectedPreset)
  }

  function handleDelete() {
    if (selectedPreset && window.confirm(`Delete preset "${selectedPreset.name}"?`)) {
      onDeletePreset(selectedPreset)
      setSelectedId('')
    }
  }

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl border"
      style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--c-muted-3)' }}>
        <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
      <span className="text-xs font-medium flex-shrink-0" style={{ color: 'var(--c-muted-3)' }}>Presets</span>

      {presets.length === 0 ? (
        <span className="flex-1 text-xs italic" style={{ color: 'var(--c-dim)' }}>No presets saved yet</span>
      ) : (
        <>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="flex-1 text-xs rounded-lg px-3 py-1.5 border appearance-none outline-none"
            style={{ backgroundColor: 'var(--c-base)', borderColor: 'var(--c-border)', color: 'var(--c-muted-1)' }}
          >
            <option value="">Select a preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={!selectedPreset}
            onClick={handleLoad}
            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: 'var(--c-muted-1)', borderColor: 'var(--c-border)', backgroundColor: 'var(--c-base)' }}
          >
            Load
          </button>

          <button
            type="button"
            disabled={!selectedPreset || isDeleting}
            onClick={handleDelete}
            title="Delete selected preset"
            className="flex-shrink-0 p-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.2)', backgroundColor: 'rgba(248,113,113,0.07)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
          </button>
        </>
      )}

      <button
        type="button"
        onClick={onSavePreset}
        className="flex-shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors"
        style={{ color: '#818cf8', borderColor: 'rgba(99,102,241,0.25)', backgroundColor: 'rgba(99,102,241,0.07)' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        Save preset
      </button>
    </div>
  )
}

// ── API example builders ──────────────────────────────────────────────────────

function buildRenderExamples(templateId: string, params: { name: string }[]) {
  const base = getApiBase()
  const paramsObj = Object.fromEntries(params.map((p) => [p.name, '']))
  const body = JSON.stringify({ params: paramsObj }, null, 2)

  const curl = `curl -s -X POST "${base}/templates/${templateId}/render" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${body}'`

  const python = `import requests

response = requests.post(
    "${base}/templates/${templateId}/render",
    headers={"Authorization": "Bearer $TOKEN"},
    json=${JSON.stringify({ params: paramsObj }, null, 4).replace(/^/gm, '    ').trimStart()},
)
print(response.json()["output"])`

  return [
    { lang: 'curl' as const, code: curl },
    { lang: 'python' as const, code: python },
  ]
}

// ── RenderPage ────────────────────────────────────────────────────────────────

export default function RenderPage() {
  const { templateId } = useParams<{ templateId: string }>()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { isOrgAdmin: isAdmin } = useAuth()

  const id = templateId ?? ''

  // Key to force DynamicForm re-mount when a preset is loaded (resets form values)
  const [formKey, setFormKey] = useState(0)
  const formRef = useRef<DynamicFormHandle>(null)
  const [activePrefill, setActivePrefill] = useState<Record<string, unknown> | undefined>(
    (location.state as { prefill?: Record<string, unknown> })?.prefill,
  )

  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const {
    data: template,
    isLoading: templateLoading,
    error: templateError,
  } = useQuery({
    queryKey: ['template', id],
    queryFn: () => getTemplate(id),
    enabled: !!id,
  })

  const {
    data: definition,
    isLoading: defLoading,
    error: defError,
  } = useQuery({
    queryKey: ['resolve-params', id],
    queryFn: () => resolveParams(id),
    enabled: !!id,
  })

  // Fetch variable refs so we can filter the render form to only show
  // parameters that are actually used in the template (full inheritance chain).
  const { data: variableRefs } = useQuery({
    queryKey: ['template-variables', id],
    queryFn: () => getTemplateVariables(id),
    enabled: !!id,
    staleTime: 60_000,
  })

  const { data: presets = [] } = useQuery({
    queryKey: ['presets', id],
    queryFn: () => listPresets(id),
    enabled: !!id,
  })

  const deleteMut = useMutation({
    mutationFn: (presetId: number) => deletePreset(id, presetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presets', id] })
    },
  })

  const saveMut = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      createPreset(id, {
        name: data.name,
        description: data.description || undefined,
        params: formRef.current?.getCurrentValues() ?? activePrefill ?? {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presets', id] })
      setShowSaveDialog(false)
      setSaveError(null)
    },
    onError: (err) => {
      setSaveError(err instanceof Error ? err.message : 'Failed to save preset')
    },
  })

  function handleLoadPreset(preset: RenderPresetOut) {
    setActivePrefill(preset.params)
    setFormKey((k) => k + 1)
  }

  const isLoading = templateLoading || defLoading
  const error = templateError || defError

  // Filter the resolved parameter set to only show parameters that are
  // actually referenced in the template body (or its parent chain).
  // Template-scope params are always shown (they're explicitly registered
  // for this template). Project/global params are only shown if used.
  const filteredDefinition = (() => {
    if (!definition) return definition
    if (!variableRefs || variableRefs.length === 0) return definition
    const usedNames = new Set(variableRefs.map((v) => v.full_path))
    const filtered = definition.parameters.filter((p) => {
      if (p.scope === 'template') return true  // always show template-scope params
      return usedNames.has(p.name)
    })
    return { ...definition, parameters: filtered }
  })()

  if (isLoading) return <Spinner />

  if (error || !template || !definition) {
    return (
      <div
        className="rounded-xl border px-4 py-3 text-sm text-red-400"
        style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }}
      >
        Failed to load template. Make sure the API is running.
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs mb-3" style={{ color: 'var(--c-muted-4)' }}>
          <Link to="/catalog" className="hover:text-indigo-400 transition-colors">
            Catalog
          </Link>
          <span>›</span>
          <span className="font-mono" style={{ color: 'var(--c-muted-3)' }}>{template.name}</span>
          <span
            className="ml-auto font-mono text-xs px-2 py-0.5 rounded border"
            style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)', color: 'var(--c-muted-3)' }}
          >
            {filteredDefinition!.parameters.length} param{filteredDefinition!.parameters.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white font-display">{template.display_name}</h1>
            {isAdmin && (
              <Link
                to={`/admin/templates/${id}/edit`}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-colors mt-1"
                style={{ color: 'var(--c-muted-3)', borderColor: 'var(--c-border)', backgroundColor: 'var(--c-card)' }}
                title="Open in template editor"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" />
                </svg>
                Edit
              </Link>
            )}
          </div>
          <div className="shrink-0 mt-1">
            <ApiCodePanel examples={buildRenderExamples(id, filteredDefinition!.parameters)} />
          </div>
        </div>
        {template.description && (
          <p className="text-sm mt-1.5" style={{ color: 'var(--c-muted-3)' }}>{template.description}</p>
        )}
      </div>

      {/* Preset toolbar */}
      <div className="mb-5">
        <PresetToolbar
          presets={presets}
          onLoadPreset={handleLoadPreset}
          onDeletePreset={(preset) => deleteMut.mutate(preset.id)}
          isDeleting={deleteMut.isPending}
          onSavePreset={() => {
            setSaveError(null)
            setShowSaveDialog(true)
          }}
        />
      </div>

      {filteredDefinition!.parameters.length === 0 && (
        <div
          className="rounded-xl border p-4 mb-4"
          style={{ backgroundColor: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.2)' }}
        >
          <p className="text-sm text-amber-300">
            This template has no registered parameters. Click Render to generate with defaults.
          </p>
        </div>
      )}

      <DynamicForm
        key={formKey}
        ref={formRef}
        templateId={id}
        definition={filteredDefinition!}
        prefillValues={activePrefill}
      />

      {/* Save preset dialog */}
      {showSaveDialog && (
        <SavePresetDialog
          onSave={(name, description) => saveMut.mutate({ name, description })}
          onCancel={() => setShowSaveDialog(false)}
          isPending={saveMut.isPending}
          error={saveError}
        />
      )}
    </div>
  )
}
