import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { getMe, updateMe } from '../api/auth'
import type { MeUpdate } from '../api/types'

const inputClass = 'w-full rounded-lg px-3 py-2 text-sm border transition-colors focus:outline-none'
const inputStyle = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)', color: 'var(--c-text)' }
const readonlyStyle = { backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)', color: 'var(--c-muted-3)' }

function formatDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function Profile() {
  const qc = useQueryClient()
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
  })

  // Email form
  const emailForm = useForm<{ email: string }>()
  const emailMut = useMutation({
    mutationFn: (email: string) => updateMe({ email }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      setSuccessMsg('Email updated.')
      setTimeout(() => setSuccessMsg(''), 3000)
    },
  })

  // Password form
  const pwForm = useForm<{ current_password: string; new_password: string; confirm: string }>()
  const pwMut = useMutation({
    mutationFn: (data: { current_password: string; new_password: string }) =>
      updateMe({ current_password: data.current_password, new_password: data.new_password }),
    onSuccess: () => {
      pwForm.reset()
      setShowPasswordForm(false)
      setSuccessMsg('Password changed.')
      setTimeout(() => setSuccessMsg(''), 3000)
    },
  })

  function handlePwSubmit(data: { current_password: string; new_password: string; confirm: string }) {
    if (data.new_password !== data.confirm) {
      pwForm.setError('confirm', { message: 'Passwords do not match' })
      return
    }
    pwMut.mutate({ current_password: data.current_password, new_password: data.new_password })
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm p-4" style={{ color: 'var(--c-muted-3)' }}>
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading…
      </div>
    )
  }

  const initials = me?.username ? me.username.slice(0, 2).toUpperCase() : '??'

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-white font-display mb-1">Profile</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--c-muted-3)' }}>Your account details and settings</p>

      {/* Avatar + identity card */}
      <div
        className="rounded-xl border p-5 mb-5 flex items-center gap-5"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 text-xl font-bold text-white"
          style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 0 24px rgba(99,102,241,0.35)' }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-semibold text-white font-display">{me?.username}</p>
          <p className="text-sm" style={{ color: 'var(--c-muted-3)' }}>{me?.email ?? 'No email set'}</p>
          <div className="flex items-center gap-2 mt-2">
            {/* Account type badge */}
            <span
              className="text-xs px-2 py-0.5 rounded-full border"
              style={me?.is_ldap
                ? { color: '#38bdf8', borderColor: '#0c4a6e', backgroundColor: 'rgba(56,189,248,0.08)' }
                : { color: '#a3e635', borderColor: '#365314', backgroundColor: 'rgba(163,230,53,0.08)' }}
            >
              {me?.is_ldap ? 'LDAP' : 'Local'}
            </span>
            {/* Role badge */}
            <span
              className="text-xs px-2 py-0.5 rounded-full border"
              style={me?.is_admin
                ? { color: '#f59e0b', borderColor: '#78350f', backgroundColor: 'rgba(245,158,11,0.08)' }
                : { color: 'var(--c-muted-3)', borderColor: 'var(--c-border)', backgroundColor: 'transparent' }}
            >
              {me?.is_admin ? 'Admin' : 'User'}
            </span>
          </div>
        </div>
      </div>

      {/* Info grid */}
      <div
        className="rounded-xl border p-5 mb-5 space-y-4"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--c-muted-2)' }}>Account info</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-4)' }}>Username</label>
            <input className={inputClass} style={readonlyStyle} value={me?.username ?? ''} readOnly />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-4)' }}>Organization ID</label>
            <input className={inputClass} style={readonlyStyle} value={me?.org_id ?? ''} readOnly />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-4)' }}>Last login</label>
            <input className={inputClass} style={readonlyStyle} value={formatDate(me?.last_login)} readOnly />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-4)' }}>Member since</label>
            <input className={inputClass} style={readonlyStyle} value={formatDate(me?.created_at)} readOnly />
          </div>
        </div>
      </div>

      {/* Email update */}
      <div
        className="rounded-xl border p-5 mb-5"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--c-muted-2)' }}>Email address</h2>
        <form
          onSubmit={emailForm.handleSubmit((d) => emailMut.mutate(d.email))}
          className="flex gap-3"
        >
          <input
            className={`${inputClass} flex-1`}
            style={inputStyle}
            type="email"
            placeholder="your@email.com"
            defaultValue={me?.email ?? ''}
            {...emailForm.register('email', { required: true })}
          />
          <button
            type="submit"
            disabled={emailMut.isPending}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 shrink-0 transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
          >
            {emailMut.isPending ? 'Saving…' : 'Update'}
          </button>
        </form>
        {emailMut.isError && (
          <p className="text-xs mt-2" style={{ color: '#ef4444' }}>
            {(emailMut.error as any)?.response?.data?.detail ?? 'Failed to update email'}
          </p>
        )}
      </div>

      {/* Password change — local accounts only */}
      <div
        className="rounded-xl border p-5 mb-5"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--c-muted-2)' }}>Password</h2>
          {me?.is_ldap ? (
            <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>Managed by LDAP</span>
          ) : (
            <button
              onClick={() => { setShowPasswordForm((v) => !v); pwForm.reset(); pwMut.reset() }}
              className="text-xs font-medium transition-colors"
              style={{ color: '#6366f1' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#818cf8')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#6366f1')}
            >
              {showPasswordForm ? 'Cancel' : 'Change password'}
            </button>
          )}
        </div>

        {showPasswordForm && !me?.is_ldap && (
          <form onSubmit={pwForm.handleSubmit(handlePwSubmit)} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Current password</label>
              <input
                type="password"
                className={inputClass}
                style={inputStyle}
                autoComplete="current-password"
                {...pwForm.register('current_password', { required: true })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>New password</label>
                <input
                  type="password"
                  className={inputClass}
                  style={inputStyle}
                  autoComplete="new-password"
                  {...pwForm.register('new_password', { required: true, minLength: { value: 8, message: 'Min 8 characters' } })}
                />
                {pwForm.formState.errors.new_password && (
                  <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{pwForm.formState.errors.new_password.message}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Confirm password</label>
                <input
                  type="password"
                  className={inputClass}
                  style={inputStyle}
                  autoComplete="new-password"
                  {...pwForm.register('confirm', { required: true })}
                />
                {pwForm.formState.errors.confirm && (
                  <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{pwForm.formState.errors.confirm.message}</p>
                )}
              </div>
            </div>

            {pwMut.isError && (
              <p className="text-xs" style={{ color: '#ef4444' }}>
                {(pwMut.error as any)?.response?.data?.detail ?? 'Failed to change password'}
              </p>
            )}

            <button
              type="submit"
              disabled={pwMut.isPending}
              className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
              style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
            >
              {pwMut.isPending ? 'Changing…' : 'Change password'}
            </button>
          </form>
        )}
      </div>

      {/* Success toast */}
      {successMsg && (
        <div
          className="fixed bottom-6 right-6 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg"
          style={{ backgroundColor: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }}
        >
          {successMsg}
        </div>
      )}
    </div>
  )
}
