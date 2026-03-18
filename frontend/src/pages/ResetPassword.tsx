import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { resetPassword } from '../api/auth'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--c-base)' }}
      >
        <div
          className="rounded-2xl border p-8 max-w-sm w-full text-center"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <p className="text-red-400 mb-4">Invalid or missing reset token.</p>
          <Link to="/login" className="text-sm" style={{ color: '#818cf8' }}>← Back to sign in</Link>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 12) {
      setError('Password must be at least 12 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await resetPassword(token, password)
      navigate('/login', { state: { notice: 'Password updated. Please sign in.' } })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Reset failed. The link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ backgroundColor: 'var(--c-base)' }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 70%)' }}
      />
      <div className="absolute inset-0 bg-grid pointer-events-none opacity-60" />

      <div className="relative w-full max-w-sm px-4">
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 0 32px rgba(99,102,241,0.4)' }}
          >
            <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6">
              <path d="M3 5h18v2H3V5zm0 6h12v2H3v-2zm0 6h18v2H3v-2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">Templarc</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>Template Engine Platform</p>
        </div>

        <div
          className="rounded-2xl border p-7"
          style={{
            backgroundColor: 'var(--c-surface)',
            borderColor: 'var(--c-border)',
            boxShadow: '0 24px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03)',
          }}
        >
          <h2 className="text-lg font-semibold text-white mb-1 font-display">Set new password</h2>
          <p className="text-sm mb-5" style={{ color: 'var(--c-muted-3)' }}>
            Choose a strong password of at least 12 characters.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
                New password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
                className="w-full rounded-lg px-3 py-2.5 text-sm text-slate-100 border transition-all duration-150 focus:outline-none placeholder:text-slate-600"
                style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#6366f1'
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--c-border-bright)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
                Confirm password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
                className="w-full rounded-lg px-3 py-2.5 text-sm text-slate-100 border transition-all duration-150 focus:outline-none placeholder:text-slate-600"
                style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#6366f1'
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--c-border-bright)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
            </div>

            {error && (
              <div
                className="rounded-lg px-3 py-2.5 text-sm text-red-300 border"
                style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
            >
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>

          <div className="mt-5 text-center">
            <Link
              to="/login"
              className="text-sm transition-colors"
              style={{ color: 'var(--c-muted-3)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-muted-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-3)')}
            >
              ← Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
