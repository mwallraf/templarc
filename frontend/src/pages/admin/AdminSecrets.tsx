import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listSecrets, createSecret, deleteSecret } from '../../api/auth'
import { useForm } from 'react-hook-form'
import type { SecretCreate, SecretType } from '../../api/types'

const SECRET_TYPE_LABELS: Record<SecretType, string> = {
  env: 'Environment variable',
  vault: 'HashiCorp Vault',
  db: 'Database (plaintext)',
}

const inputClass = 'w-full rounded-lg px-3 py-2 text-sm text-slate-100 border transition-colors focus:outline-none'
const inputStyle = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }

export default function AdminSecrets() {
  const [showForm, setShowForm] = useState(false)
  const qc = useQueryClient()

  const { data: secrets, isLoading } = useQuery({
    queryKey: ['secrets'],
    queryFn: listSecrets,
  })

  const createMut = useMutation({
    mutationFn: createSecret,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['secrets'] })
      setShowForm(false)
      reset()
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteSecret,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['secrets'] }),
  })

  const { register, handleSubmit, watch, reset } = useForm<SecretCreate>({
    defaultValues: { secret_type: 'env' },
  })
  const secretType = watch('secret_type')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white font-display">Secrets</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>API keys, tokens, and credentials</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 text-sm font-semibold text-white rounded-lg transition-all"
          style={{
            background: showForm ? 'transparent' : 'linear-gradient(135deg, #6366f1, #818cf8)',
            boxShadow: showForm ? 'none' : '0 4px 14px rgba(99,102,241,0.3)',
            border: showForm ? '1px solid var(--c-border-bright)' : 'none',
            color: showForm ? 'var(--c-muted-2)' : 'white',
          }}
        >
          {showForm ? 'Cancel' : 'New Secret'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((data) => createMut.mutate(data))}
          className="rounded-xl border p-5 mb-6 space-y-4"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <h2 className="font-semibold text-slate-100 font-display">New Secret</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Name</label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="e.g. netbox_api"
                {...register('name', { required: true })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Type</label>
              <select
                className={inputClass}
                style={{ ...inputStyle, color: 'var(--c-text)' }}
                {...register('secret_type')}
              >
                <option value="env" style={{ backgroundColor: 'var(--c-card)' }}>Environment variable</option>
                <option value="vault" style={{ backgroundColor: 'var(--c-card)' }}>HashiCorp Vault</option>
                <option value="db" style={{ backgroundColor: 'var(--c-card)' }}>Database (plaintext)</option>
              </select>
            </div>
          </div>

          {secretType === 'env' && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Environment variable name</label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="e.g. NETBOX_API_TOKEN"
                {...register('value')}
              />
            </div>
          )}

          {secretType === 'vault' && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Vault path</label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="e.g. secret/data/netbox"
                {...register('vault_path')}
              />
            </div>
          )}

          {secretType === 'db' && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Secret value (stored in DB)</label>
              <input
                type="password"
                className={inputClass}
                style={inputStyle}
                {...register('value')}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Description (optional)</label>
            <input
              className={inputClass}
              style={inputStyle}
              {...register('description')}
            />
          </div>

          <button
            type="submit"
            disabled={createMut.isPending}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
            }}
          >
            {createMut.isPending ? 'Saving…' : 'Save Secret'}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
          {secrets?.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm" style={{ color: 'var(--c-muted-3)' }}>
              No secrets configured.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--c-surface-alt)', borderBottom: '1px solid var(--c-border)' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>Description</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {secrets?.map((s, idx) => (
                  <tr
                    key={s.id}
                    style={{ borderBottom: idx < (secrets.length - 1) ? '1px solid var(--c-border)' : 'none' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>{s.name}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-3)' }}>{SECRET_TYPE_LABELS[s.secret_type]}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-4)' }}>{s.description ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          if (confirm(`Delete secret "${s.name}"?`)) deleteMut.mutate(s.id)
                        }}
                        className="text-xs font-medium transition-colors"
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
