import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import Editor from '@monaco-editor/react'
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
} from '../../api/admin'
import { listProjects } from '../../api/catalog'
import { listTemplates } from '../../api/templates'
import type {
  RenderWebhookCreate,
  RenderWebhookOut,
  RenderWebhookUpdate,
  WebhookTestResult,
} from '../../api/types'

// ── Shared style constants (same as AdminFilters) ────────────────────────────

const inputClass = 'w-full rounded-lg px-3 py-2 text-sm text-slate-100 border transition-colors focus:outline-none'
const inputStyle = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }
const selectStyle = { ...inputStyle, color: 'var(--c-text)' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function ScopeBadge({ webhook }: { webhook: RenderWebhookOut }) {
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => listProjects() })
  const { data: tmplData } = useQuery({ queryKey: ['templates-all'], queryFn: () => listTemplates({}) })
  const templates = (tmplData as any)?.items ?? tmplData ?? []

  if (webhook.project_id != null) {
    const p = projects.find((x) => x.id === webhook.project_id)
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border font-medium"
        style={{ backgroundColor: 'rgba(96,165,250,0.1)', color: '#60a5fa', borderColor: 'rgba(96,165,250,0.2)' }}>
        project · {p?.display_name ?? `#${webhook.project_id}`}
      </span>
    )
  }
  const t = templates.find((x: any) => x.id === webhook.template_id)
  return (
    <span className="text-xs px-2 py-0.5 rounded-full border font-medium"
      style={{ backgroundColor: 'rgba(167,139,250,0.1)', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.2)' }}>
      template · {t?.display_name ?? `#${webhook.template_id}`}
    </span>
  )
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    POST: '#34d399',
    PUT: '#fbbf24',
    PATCH: '#a78bfa',
  }
  return (
    <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded"
      style={{ backgroundColor: 'var(--c-elevated)', color: colors[method] ?? 'var(--c-muted-3)' }}>
      {method}
    </span>
  )
}

function TriggerBadge({ trigger, onError }: { trigger: string; onError: string }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {trigger === 'always' && (
        <span className="text-xs px-2 py-0.5 rounded-full border font-medium"
          style={{ backgroundColor: 'rgba(251,191,36,0.08)', color: '#fbbf24', borderColor: 'rgba(251,191,36,0.2)' }}>
          always
        </span>
      )}
      {onError === 'block' && (
        <span className="text-xs px-2 py-0.5 rounded-full border font-medium"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#f87171', borderColor: 'rgba(239,68,68,0.2)' }}>
          blocking
        </span>
      )}
    </div>
  )
}

// ── Payload template editor ───────────────────────────────────────────────────

const PAYLOAD_PLACEHOLDER = `{
  "extra_vars": {
    "target_host": "{{ parameters['proj.hostname'] }}",
    "config_b64":  "{{ output | b64encode }}"
  }
}`

function PayloadEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--c-border-bright)' }}>
      <Editor
        height="180px"
        defaultLanguage="html"
        value={value || ''}
        onChange={(v) => onChange(v ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
        }}
        theme="vs-dark"
      />
    </div>
  )
}

// ── Webhook form ──────────────────────────────────────────────────────────────

interface WebhookFormValues {
  name: string
  is_active: boolean
  scope: 'project' | 'template'
  project_id: string
  template_id: string
  url: string
  http_method: string
  auth_header: string
  trigger_on: string
  on_error: string
  timeout_seconds: string
}

function WebhookForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: RenderWebhookOut
  onSave: (data: RenderWebhookCreate | RenderWebhookUpdate, payloadTpl: string) => void
  onCancel: () => void
  saving: boolean
}) {
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => listProjects() })
  const { data: tmplData } = useQuery({ queryKey: ['templates-all'], queryFn: () => listTemplates({}) })
  const templates = (tmplData as any)?.items ?? tmplData ?? []

  const defaultScope: 'project' | 'template' = initial?.project_id != null ? 'project' : 'template'
  const [payloadTpl, setPayloadTpl] = useState(initial?.payload_template ?? '')

  const { register, handleSubmit, watch, setValue } = useForm<WebhookFormValues>({
    defaultValues: {
      name: initial?.name ?? '',
      is_active: initial?.is_active ?? true,
      scope: defaultScope,
      project_id: initial?.project_id?.toString() ?? '',
      template_id: initial?.template_id?.toString() ?? '',
      url: initial?.url ?? '',
      http_method: initial?.http_method ?? 'POST',
      auth_header: initial?.auth_header ?? '',
      trigger_on: initial?.trigger_on ?? 'persist',
      on_error: initial?.on_error ?? 'warn',
      timeout_seconds: initial?.timeout_seconds?.toString() ?? '10',
    },
  })

  const scope = watch('scope')

  const onSubmit = (values: WebhookFormValues) => {
    const base = {
      name: values.name,
      is_active: values.is_active,
      url: values.url,
      http_method: values.http_method as 'POST' | 'PUT' | 'PATCH',
      auth_header: values.auth_header || null,
      payload_template: payloadTpl.trim() || null,
      trigger_on: values.trigger_on as 'persist' | 'always',
      on_error: values.on_error as 'warn' | 'block',
      timeout_seconds: parseInt(values.timeout_seconds, 10) || 10,
    }
    if (!initial) {
      onSave({
        ...base,
        project_id: scope === 'project' && values.project_id ? parseInt(values.project_id, 10) : null,
        template_id: scope === 'template' && values.template_id ? parseInt(values.template_id, 10) : null,
      } as RenderWebhookCreate, payloadTpl)
    } else {
      onSave(base as RenderWebhookUpdate, payloadTpl)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <h3 className="font-semibold text-white font-display">
        {initial ? `Edit · ${initial.name}` : 'New Webhook'}
      </h3>

      {/* Name + Active */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Name</label>
          <input
            {...register('name', { required: true })}
            className={inputClass}
            style={inputStyle}
            placeholder="e.g. Push to AWX"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Status</label>
          <select {...register('is_active')} className={inputClass} style={selectStyle}>
            <option value="true" style={{ backgroundColor: 'var(--c-card)' }}>Active</option>
            <option value="false" style={{ backgroundColor: 'var(--c-card)' }}>Inactive</option>
          </select>
        </div>
      </div>

      {/* Scope — create only */}
      {!initial && (
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Scope</label>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {(['project', 'template'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setValue('scope', s)}
                className="rounded-lg p-3 text-left text-xs transition-all border"
                style={scope === s
                  ? { borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.08)', color: '#818cf8' }
                  : { borderColor: 'var(--c-border)', backgroundColor: 'var(--c-card)', color: 'var(--c-muted-3)' }
                }
              >
                <span className="font-semibold block mb-0.5 capitalize">{s}</span>
                <span className="opacity-70">
                  {s === 'project' ? 'Fires for every template in the project' : 'Fires only for a specific template'}
                </span>
              </button>
            ))}
          </div>

          {scope === 'project' && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Project</label>
              <select {...register('project_id')} className={inputClass} style={selectStyle}>
                <option value="" style={{ backgroundColor: 'var(--c-card)' }}>— select project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id} style={{ backgroundColor: 'var(--c-card)' }}>{p.display_name}</option>
                ))}
              </select>
            </div>
          )}

          {scope === 'template' && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Template</label>
              <select {...register('template_id')} className={inputClass} style={selectStyle}>
                <option value="" style={{ backgroundColor: 'var(--c-card)' }}>— select template —</option>
                {templates.map((t: any) => (
                  <option key={t.id} value={t.id} style={{ backgroundColor: 'var(--c-card)' }}>
                    {t.display_name} ({t.name})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* URL + Method */}
      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-3">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>URL</label>
          <input
            {...register('url', { required: true })}
            className={inputClass}
            style={inputStyle}
            placeholder="https://awx.example.com/api/v2/job_templates/42/launch/"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Method</label>
          <select {...register('http_method')} className={inputClass} style={selectStyle}>
            {['POST', 'PUT', 'PATCH'].map((m) => (
              <option key={m} style={{ backgroundColor: 'var(--c-card)' }}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Auth */}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
          Auth secret ref <span className="font-normal" style={{ color: 'var(--c-muted-4)' }}>(optional)</span>
        </label>
        <input
          {...register('auth_header')}
          className={inputClass}
          style={inputStyle}
          placeholder="secret:awx_token  or  env:AWX_TOKEN"
        />
        <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
          Resolved value is sent as <span className="font-mono">Authorization: Bearer &lt;value&gt;</span>
        </p>
      </div>

      {/* Behaviour */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Trigger on</label>
          <select {...register('trigger_on')} className={inputClass} style={selectStyle}>
            <option value="persist" style={{ backgroundColor: 'var(--c-card)' }}>persist (real renders only)</option>
            <option value="always" style={{ backgroundColor: 'var(--c-card)' }}>always (including previews)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>On error</label>
          <select {...register('on_error')} className={inputClass} style={selectStyle}>
            <option value="warn" style={{ backgroundColor: 'var(--c-card)' }}>warn (fire & forget)</option>
            <option value="block" style={{ backgroundColor: 'var(--c-card)' }}>block (return 502 on failure)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Timeout (s)</label>
          <input
            type="number"
            {...register('timeout_seconds')}
            min={1}
            max={120}
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Payload template */}
      <div>
        <label className="block text-xs font-medium mb-2" style={{ color: 'var(--c-muted-2)' }}>
          Payload template{' '}
          <span className="font-normal" style={{ color: 'var(--c-muted-4)' }}>
            (Jinja2 — leave blank for default JSON)
          </span>
        </label>
        <PayloadEditor value={payloadTpl} onChange={setPayloadTpl} />
        <p className="text-xs mt-1.5" style={{ color: 'var(--c-muted-4)' }}>
          Variables:{' '}
          {['render_id', 'template_name', 'project_name', 'parameters', 'output', 'git_sha', 'rendered_by'].map((v) => (
            <span key={v} className="font-mono mr-1">{v}</span>
          ))}.
          Tip: <span className="font-mono">{'{{ output | b64encode }}'}</span>
        </p>
        {!payloadTpl.trim() && (
          <button
            type="button"
            className="mt-1 text-xs transition-colors hover:opacity-80"
            style={{ color: '#818cf8' }}
            onClick={() => setPayloadTpl(PAYLOAD_PLACEHOLDER)}
          >
            Insert AWX example →
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
          style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
        >
          {saving ? 'Saving…' : initial ? 'Update Webhook' : 'Save Webhook'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-semibold rounded-lg transition-all"
          style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)', backgroundColor: 'transparent' }}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Test result panel ─────────────────────────────────────────────────────────

function TestResult({ result, onDismiss }: { result: WebhookTestResult; onDismiss: () => void }) {
  return (
    <div
      className="rounded-lg p-3 flex items-start gap-3 border"
      style={result.success
        ? { backgroundColor: 'rgba(52,211,153,0.06)', borderColor: 'rgba(52,211,153,0.2)' }
        : { backgroundColor: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.2)' }
      }
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0 mt-0.5"
        style={{ color: result.success ? '#34d399' : '#f87171' }}>
        {result.success
          ? <polyline points="20 6 9 17 4 12" />
          : <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
        }
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold mb-0.5" style={{ color: result.success ? '#34d399' : '#f87171' }}>
          {result.success ? 'Success' : 'Failed'}
          {result.status_code != null && (
            <span className="font-mono font-normal ml-2" style={{ color: 'var(--c-muted-3)' }}>
              HTTP {result.status_code}
            </span>
          )}
        </p>
        {result.error && (
          <p className="text-xs font-mono" style={{ color: '#f87171' }}>{result.error}</p>
        )}
        {result.response_body && (
          <pre className="text-xs font-mono mt-1 overflow-auto max-h-24 whitespace-pre-wrap"
            style={{ color: 'var(--c-muted-3)' }}>
            {result.response_body}
          </pre>
        )}
      </div>
      <button onClick={onDismiss} className="text-xs shrink-0 transition-colors hover:opacity-70"
        style={{ color: 'var(--c-muted-4)' }}>
        ✕
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminWebhooks() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, WebhookTestResult>>({})

  const { data: webhookData, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => listWebhooks(),
  })
  const webhooks = webhookData?.items ?? []

  const createMut = useMutation({
    mutationFn: (data: RenderWebhookCreate) => createWebhook(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); setShowForm(false) },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: RenderWebhookUpdate }) => updateWebhook(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); setEditId(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteWebhook(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  })

  const handleTest = async (id: number) => {
    setTestingId(id)
    try {
      const result = await testWebhook(id)
      setTestResults((prev) => ({ ...prev, [id]: result }))
    } finally {
      setTestingId(null)
    }
  }

  const handleDelete = (wh: RenderWebhookOut) => {
    if (confirm(`Delete webhook "${wh.name}"?`)) {
      deleteMut.mutate(wh.id)
    }
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white font-display">Render Webhooks</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>
            Fire outbound HTTP calls after a render — push configs to AWX, NSO, n8n, or any REST endpoint
          </p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setEditId(null) }}
          className="px-4 py-2 text-sm font-semibold rounded-lg transition-all"
          style={showForm
            ? { border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)', backgroundColor: 'transparent' }
            : { background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: 'white', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }
          }
        >
          {showForm ? 'Cancel' : 'New Webhook'}
        </button>
      </div>

      {/* Info hint */}
      <div
        className="mb-5 rounded-lg p-3 flex gap-3 items-start"
        style={{ backgroundColor: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#818cf8' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
        <div className="text-xs space-y-1" style={{ color: 'var(--c-muted-3)' }}>
          <p>
            Webhooks fire after a successful render and POST the output to an external system.
            Scope a webhook to a <strong style={{ color: 'var(--c-muted-2)' }}>project</strong> (fires for every template)
            or a specific <strong style={{ color: 'var(--c-muted-2)' }}>template</strong>.
          </p>
          <p>
            Use a <span className="font-mono" style={{ color: '#818cf8' }}>Jinja2 payload template</span> to shape the body for any target API.
            The <span className="font-mono" style={{ color: '#818cf8' }}>| b64encode</span> filter is available to base64-encode the rendered config.
          </p>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div
          className="rounded-xl border p-5 mb-6 space-y-4"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <WebhookForm
            onSave={(data) => createMut.mutate(data as RenderWebhookCreate)}
            onCancel={() => setShowForm(false)}
            saving={createMut.isPending}
          />
          {createMut.isError && (
            <p className="text-xs text-red-400">
              {(createMut.error as any)?.response?.data?.detail ?? 'Create failed'}
            </p>
          )}
        </div>
      )}

      {/* Webhook table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
          {!webhooks.length ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--c-muted-3)' }}>
              No webhooks configured.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--c-surface-alt)', borderBottom: '1px solid var(--c-border)' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Scope</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Method</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>URL</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Flags</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {webhooks.map((wh, idx) => (
                  <>
                    <tr
                      key={wh.id}
                      style={{ borderBottom: (editId === wh.id || testResults[wh.id]) ? '1px solid var(--c-border-bright)' : idx < webhooks.length - 1 ? '1px solid var(--c-border)' : 'none' }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td className="px-4 py-3 font-medium text-xs" style={{ color: wh.is_active ? 'var(--c-muted-2)' : 'var(--c-muted-4)' }}>
                        <div className="flex items-center gap-2">
                          {!wh.is_active && (
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                              style={{ backgroundColor: 'var(--c-elevated)', color: 'var(--c-muted-4)' }}>
                              off
                            </span>
                          )}
                          {wh.name}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ScopeBadge webhook={wh} />
                      </td>
                      <td className="px-4 py-3">
                        <MethodBadge method={wh.http_method} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs max-w-xs truncate" style={{ color: 'var(--c-muted-3)' }}>
                        {wh.url}
                      </td>
                      <td className="px-4 py-3">
                        <TriggerBadge trigger={wh.trigger_on} onError={wh.on_error} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 justify-end">
                          <button
                            onClick={() => handleTest(wh.id)}
                            disabled={testingId === wh.id}
                            className="text-xs font-medium disabled:opacity-50 transition-colors"
                            style={{ color: '#818cf8' }}
                          >
                            {testingId === wh.id ? 'Testing…' : 'Test'}
                          </button>
                          <button
                            onClick={() => setEditId(editId === wh.id ? null : wh.id)}
                            className="text-xs font-medium transition-colors"
                            style={{ color: 'var(--c-muted-2)' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(wh)}
                            disabled={deleteMut.isPending}
                            className="text-xs font-medium disabled:opacity-50 transition-colors"
                            style={{ color: '#ef4444' }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Inline test result */}
                    {testResults[wh.id] && (
                      <tr key={`test-${wh.id}`} style={{ borderBottom: editId === wh.id ? '1px solid var(--c-border-bright)' : idx < webhooks.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
                        <td colSpan={6} className="px-4 py-2">
                          <TestResult
                            result={testResults[wh.id]}
                            onDismiss={() => setTestResults((prev) => { const n = { ...prev }; delete n[wh.id]; return n })}
                          />
                        </td>
                      </tr>
                    )}

                    {/* Inline edit form */}
                    {editId === wh.id && (
                      <tr key={`edit-${wh.id}`} style={{ borderBottom: idx < webhooks.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
                        <td colSpan={6} className="px-5 py-5"
                          style={{ backgroundColor: 'var(--c-surface-alt)' }}>
                          <WebhookForm
                            initial={wh}
                            onSave={(data) => updateMut.mutate({ id: wh.id, data: data as RenderWebhookUpdate })}
                            onCancel={() => setEditId(null)}
                            saving={updateMut.isPending}
                          />
                          {updateMut.isError && (
                            <p className="text-xs text-red-400 mt-2">
                              {(updateMut.error as any)?.response?.data?.detail ?? 'Update failed'}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
