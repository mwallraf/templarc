import { useForm } from 'react-hook-form'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { LoginRequest } from '../api/types'

export default function Login() {
  const { login, isLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string })?.from ?? '/catalog'

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginRequest>()

  async function onSubmit(data: LoginRequest) {
    try {
      await login(data)
      navigate(from, { replace: true })
    } catch {
      setError('root', { message: 'Invalid username or password' })
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ backgroundColor: 'var(--c-base)' }}
    >
      {/* Background radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 70%)',
        }}
      />
      {/* Subtle grid */}
      <div className="absolute inset-0 bg-grid pointer-events-none opacity-60" />

      <div className="relative w-full max-w-sm px-4">
        {/* Logo mark */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              boxShadow: '0 0 32px rgba(99,102,241,0.4)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6">
              <path d="M3 5h18v2H3V5zm0 6h12v2H3v-2zm0 6h18v2H3v-2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">Templarc</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>
            Template Engine Platform
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border p-7"
          style={{
            backgroundColor: 'var(--c-surface)',
            borderColor: 'var(--c-border)',
            boxShadow: '0 24px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03)',
          }}
        >
          <h2 className="text-lg font-semibold text-white mb-5 font-display">Sign in</h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
                Username
              </label>
              <input
                type="text"
                autoComplete="username"
                className="w-full rounded-lg px-3 py-2.5 text-sm text-slate-100 border transition-all duration-150 focus:outline-none placeholder:text-slate-600"
                style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }}
                placeholder="your-username"
                {...register('username', { required: 'Username is required' })}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#6366f1'
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--c-border-bright)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
              {errors.username && (
                <p className="mt-1.5 text-xs text-red-400">{errors.username.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                className="w-full rounded-lg px-3 py-2.5 text-sm text-slate-100 border transition-all duration-150 focus:outline-none placeholder:text-slate-600"
                style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }}
                placeholder="••••••••"
                {...register('password', { required: 'Password is required' })}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#6366f1'
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--c-border-bright)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
              {errors.password && (
                <p className="mt-1.5 text-xs text-red-400">{errors.password.message}</p>
              )}
            </div>

            {errors.root && (
              <div
                className="rounded-lg px-3 py-2.5 text-sm text-red-300 border"
                style={{
                  backgroundColor: 'rgba(239,68,68,0.08)',
                  borderColor: 'rgba(239,68,68,0.2)',
                }}
              >
                {errors.root.message}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
              }}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-5" style={{ color: 'var(--c-dim)' }}>
          Templarc Template Engine · v1.0
        </p>
      </div>
    </div>
  )
}
