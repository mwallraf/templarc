import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listUsers, createUser, updateUser, deleteUser } from '../../api/auth'
import { useForm } from 'react-hook-form'
import { useAuth } from '../../contexts/AuthContext'
import type { UserCreate } from '../../api/types'

const inputClass = 'w-full rounded-lg px-3 py-2 text-sm text-slate-100 border transition-colors focus:outline-none'
const inputStyle = { backgroundColor: '#141828', borderColor: '#2a3255' }

function formatDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function AdminUsers() {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  })

  const createMut = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      reset()
    },
  })

  const toggleAdminMut = useMutation({
    mutationFn: ({ id, is_admin }: { id: number; is_admin: boolean }) =>
      updateUser(id, { is_admin }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const { register, handleSubmit, reset, setValue } = useForm<UserCreate>({
    defaultValues: { is_admin: false },
  })

  function handleDuplicate(email: string, is_admin: boolean) {
    reset({ username: '', email, password: '', is_admin })
    setShowForm(true)
    // Scroll to form
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white font-display">Users</h1>
          <p className="text-sm mt-1" style={{ color: '#546485' }}>Manage local and LDAP accounts</p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); if (showForm) reset() }}
          className="px-4 py-2 text-sm font-semibold text-white rounded-lg transition-all"
          style={{
            background: showForm ? 'transparent' : 'linear-gradient(135deg, #6366f1, #818cf8)',
            boxShadow: showForm ? 'none' : '0 4px 14px rgba(99,102,241,0.3)',
            border: showForm ? '1px solid #2a3255' : 'none',
            color: showForm ? '#8892b0' : 'white',
          }}
        >
          {showForm ? 'Cancel' : 'New User'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((data) => createMut.mutate(data))}
          className="rounded-xl border p-5 mb-6 space-y-4"
          style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}
        >
          <h2 className="font-semibold text-slate-100 font-display">New Local User</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Username</label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="e.g. jsmith"
                autoComplete="off"
                {...register('username', { required: true })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Email</label>
              <input
                type="email"
                className={inputClass}
                style={inputStyle}
                placeholder="e.g. j.smith@example.com"
                {...register('email', { required: true })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Password</label>
              <input
                type="password"
                className={inputClass}
                style={inputStyle}
                autoComplete="new-password"
                {...register('password', { required: true })}
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded"
                  {...register('is_admin')}
                />
                <span className="text-sm" style={{ color: '#8892b0' }}>Administrator</span>
              </label>
            </div>
          </div>

          {createMut.isError && (
            <p className="text-xs" style={{ color: '#ef4444' }}>
              {(createMut.error as any)?.response?.data?.detail ?? 'Failed to create user'}
            </p>
          )}

          <button
            type="submit"
            disabled={createMut.isPending}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
            }}
          >
            {createMut.isPending ? 'Creating…' : 'Create User'}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: '#0d1021', borderColor: '#1e2440' }}>
          {!users?.length ? (
            <p className="px-4 py-10 text-center text-sm" style={{ color: '#546485' }}>No users found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: '#0a0d1a', borderBottom: '1px solid #1e2440' }}>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Username</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#3d4777' }}>Last Login</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((u, idx) => {
                  const isSelf = u.username === me?.username
                  return (
                    <tr
                      key={u.id}
                      style={{
                        borderBottom: idx < users.length - 1 ? '1px solid #1e2440' : 'none',
                        borderLeft: isSelf ? '3px solid #6366f1' : '3px solid transparent',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: '#8892b0' }}>
                        {u.username}
                        {isSelf && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full border font-sans" style={{ color: '#6366f1', borderColor: '#312e81', backgroundColor: 'rgba(99,102,241,0.1)' }}>
                            you
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#546485' }}>{u.email || '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full border"
                          style={u.is_ldap
                            ? { color: '#38bdf8', borderColor: '#0c4a6e', backgroundColor: 'rgba(56,189,248,0.08)' }
                            : { color: '#a3e635', borderColor: '#365314', backgroundColor: 'rgba(163,230,53,0.08)' }
                          }
                        >
                          {u.is_ldap ? 'LDAP' : 'Local'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full border"
                          style={u.is_admin
                            ? { color: '#f59e0b', borderColor: '#78350f', backgroundColor: 'rgba(245,158,11,0.08)' }
                            : { color: '#546485', borderColor: '#1e2440', backgroundColor: 'transparent' }
                          }
                        >
                          {u.is_admin ? 'Admin' : 'User'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#3d4777' }}>{formatDate(u.last_login)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          {/* Toggle admin — not for self */}
                          <button
                            onClick={() => toggleAdminMut.mutate({ id: u.id, is_admin: !u.is_admin })}
                            disabled={isSelf || toggleAdminMut.isPending}
                            title={isSelf ? 'Cannot change your own role' : u.is_admin ? 'Revoke admin' : 'Grant admin'}
                            className="text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            style={{ color: u.is_admin ? '#f59e0b' : '#6366f1' }}
                          >
                            {u.is_admin ? 'Revoke Admin' : 'Make Admin'}
                          </button>

                          {/* Duplicate — pre-fills form */}
                          <button
                            onClick={() => handleDuplicate(u.email, u.is_admin)}
                            className="text-xs font-medium transition-colors"
                            style={{ color: '#8892b0' }}
                          >
                            Duplicate
                          </button>

                          {/* Delete — not for self or LDAP */}
                          <button
                            onClick={() => {
                              if (confirm(`Delete user "${u.username}"? This cannot be undone.`)) {
                                deleteMut.mutate(u.id)
                              }
                            }}
                            disabled={isSelf || deleteMut.isPending}
                            title={isSelf ? 'Cannot delete your own account' : undefined}
                            className="text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            style={{ color: '#ef4444' }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
