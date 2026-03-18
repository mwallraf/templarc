import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { listApiKeys, createApiKey, deleteApiKey } from '../../api/admin'
import type { ApiKeyCreate, ApiKeyCreatedOut, ApiKeyOut } from '../../api/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isExpired(iso: string | null): boolean {
  if (!iso) return false
  return new Date(iso) < new Date()
}

// ── Key reveal modal ──────────────────────────────────────────────────────────

function KeyRevealModal({ apiKey, onClose }: { apiKey: ApiKeyCreatedOut; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(apiKey.raw_key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border p-6 shadow-2xl"
        style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 mb-5">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{ backgroundColor: 'rgba(99,102,241,0.15)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5" className="w-5 h-5">
              <path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--c-text)' }}>
              API key created — {apiKey.name}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted-3)' }}>
              Copy this key now. It will not be shown again.
            </p>
          </div>
        </div>

        {/* Key display */}
        <div
          className="rounded-lg p-3 mb-4 font-mono text-xs break-all select-all"
          style={{
            backgroundColor: 'var(--c-elevated)',
            border: '1px solid var(--c-border)',
            color: 'var(--c-text)',
          }}
        >
          {apiKey.raw_key}
        </div>

        {/* Warning */}
        <div
          className="rounded-lg px-3 py-2.5 mb-5 text-xs flex items-start gap-2"
          style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5" className="w-4 h-4 shrink-0 mt-0.5">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span style={{ color: '#d97706' }}>
            Store this key securely. It cannot be retrieved from the server after this dialog is closed.
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              backgroundColor: copied ? 'rgba(34,197,94,0.15)' : 'rgba(99,102,241,0.15)',
              color: copied ? '#22c55e' : '#818cf8',
              border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : 'rgba(99,102,241,0.3)'}`,
            }}
          >
            {copied ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                Copy key
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--c-elevated)',
              color: 'var(--c-muted-2)',
              border: '1px solid var(--c-border)',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Create modal ──────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (k: ApiKeyCreatedOut) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<ApiKeyCreate>({
    defaultValues: { name: '', role: 'member', expires_at: null },
  })
  const mutation = useMutation({ mutationFn: createApiKey })

  function onSubmit(data: ApiKeyCreate) {
    const payload: ApiKeyCreate = {
      ...data,
      expires_at: data.expires_at || null,
    }
    mutation.mutate(payload, {
      onSuccess: (created) => onCreated(created),
    })
  }

  const inputStyle = {
    backgroundColor: 'var(--c-elevated)',
    border: '1px solid var(--c-border)',
    color: 'var(--c-text)',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '13px',
    width: '100%',
    outline: 'none',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border p-6 shadow-2xl"
        style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--c-text)' }}>
          Create API key
        </h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
              Name <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input
              {...register('name', { required: 'Name is required' })}
              placeholder="e.g. CI pipeline, Monitoring script"
              style={inputStyle}
            />
            {errors.name && (
              <p className="text-xs mt-1" style={{ color: '#f87171' }}>{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
              Expires at <span style={{ color: 'var(--c-muted-4)' }}>(optional — leave blank for no expiry)</span>
            </label>
            <input
              type="datetime-local"
              {...register('expires_at')}
              style={inputStyle}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
              Role
            </label>
            <select
              {...register('role')}
              style={inputStyle}
            >
              <option value="member">Member</option>
              <option value="org_admin">Org Admin</option>
            </select>
          </div>

          {mutation.isError && (
            <p className="text-xs" style={{ color: '#f87171' }}>
              {(mutation.error as Error)?.message ?? 'Failed to create key'}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-opacity"
              style={{ backgroundColor: '#6366f1', opacity: mutation.isPending ? 0.6 : 1 }}
            >
              {mutation.isPending ? 'Creating…' : 'Create key'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: 'var(--c-elevated)',
                color: 'var(--c-muted-2)',
                border: '1px solid var(--c-border)',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminApiKeys() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [revealKey, setRevealKey] = useState<ApiKeyCreatedOut | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ApiKeyOut | null>(null)

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      setConfirmDelete(null)
    },
  })

  function handleCreated(created: ApiKeyCreatedOut) {
    queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    setShowCreate(false)
    setRevealKey(created)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold font-display" style={{ color: 'var(--c-text)' }}>
            API Keys
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--c-muted-3)' }}>
            Long-lived keys for programmatic access. Pass as{' '}
            <code
              className="px-1.5 py-0.5 rounded text-xs"
              style={{ backgroundColor: 'var(--c-elevated)', color: '#818cf8' }}
            >
              X-API-Key: tmpl_…
            </code>{' '}
            header.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#6366f1' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New key
        </button>
      </div>

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)' }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-16" style={{ color: 'var(--c-muted-3)' }}>
            <svg className="animate-spin w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
              <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Loading…
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center py-16">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--c-muted-4)' }}>
              <path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <p className="text-sm font-medium" style={{ color: 'var(--c-muted-2)' }}>No API keys yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>Create a key to enable programmatic access</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                {['Name', 'Prefix', 'Permissions', 'Last used', 'Expires', 'Created', ''].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--c-muted-3)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const expired = isExpired(key.expires_at)
                return (
                  <tr
                    key={key.id}
                    style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-row-hover)' }}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--c-text)' }}>
                      {key.name}
                    </td>
                    <td className="px-4 py-3">
                      <code
                        className="px-2 py-0.5 rounded text-xs"
                        style={{ backgroundColor: 'var(--c-elevated)', color: '#818cf8' }}
                      >
                        {key.key_prefix}…
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      {key.role === 'org_admin' || key.role === 'org_owner' ? (
                        <span
                          className="badge"
                          style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' }}
                        >
                          {key.role === 'org_owner' ? 'Owner' : 'Admin'}
                        </span>
                      ) : (
                        <span
                          className="badge"
                          style={{ backgroundColor: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}
                        >
                          Member
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-3)' }}>
                      {formatDate(key.last_used_at)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {key.expires_at ? (
                        <span style={{ color: expired ? '#f87171' : 'var(--c-muted-3)' }}>
                          {expired ? '⚠ ' : ''}{formatDate(key.expires_at)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--c-muted-4)' }}>Never</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-3)' }}>
                      {formatDate(key.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setConfirmDelete(key)}
                        title="Revoke key"
                        className="transition-colors"
                        style={{ color: 'var(--c-muted-4)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-4)')}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Usage hint */}
      <div
        className="mt-4 rounded-lg p-4 text-xs"
        style={{
          backgroundColor: 'var(--c-elevated)',
          border: '1px solid var(--c-border)',
          color: 'var(--c-muted-3)',
        }}
      >
        <p className="font-medium mb-1" style={{ color: 'var(--c-muted-2)' }}>Usage</p>
        <code style={{ color: 'var(--c-muted-1)' }}>
          curl -H &quot;X-API-Key: tmpl_…&quot; https://your-host/templates/1/render -d &apos;{"{}"}&apos;
        </code>
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}
      {revealKey && (
        <KeyRevealModal apiKey={revealKey} onClose={() => setRevealKey(null)} />
      )}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--c-text)' }}>
              Revoke &quot;{confirmDelete.name}&quot;?
            </h2>
            <p className="text-sm mb-5" style={{ color: 'var(--c-muted-3)' }}>
              This immediately invalidates the key. Any scripts using it will stop working.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => deleteMutation.mutate(confirmDelete.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-opacity"
                style={{ backgroundColor: '#ef4444', opacity: deleteMutation.isPending ? 0.6 : 1 }}
              >
                {deleteMutation.isPending ? 'Revoking…' : 'Revoke key'}
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--c-elevated)',
                  color: 'var(--c-muted-2)',
                  border: '1px solid var(--c-border)',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
