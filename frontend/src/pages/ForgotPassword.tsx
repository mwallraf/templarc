import { useState } from 'react'
import { Link } from 'react-router-dom'
import { forgotPassword } from '../api/auth'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    try {
      await forgotPassword(email.trim())
    } catch {
      // always show success — never leak whether email exists
    } finally {
      setLoading(false)
      setSubmitted(true)
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
          background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 70%)',
        }}
      />
      <div className="absolute inset-0 bg-grid pointer-events-none opacity-60" />

      <div className="relative w-full max-w-sm px-4">
        {/* Logo */}
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
          {submitted ? (
            <div className="text-center space-y-4">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto"
                style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6" style={{ color: '#34d399' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white font-display">Check your email</h2>
                <p className="text-sm mt-2" style={{ color: 'var(--c-muted-3)' }}>
                  If that email address exists in our system, we've sent a password reset link. It expires in 15 minutes.
                </p>
              </div>
              <Link
                to="/login"
                className="block text-sm text-center font-medium transition-colors"
                style={{ color: '#818cf8' }}
              >
                ← Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-white mb-1 font-display">Forgot password?</h2>
              <p className="text-sm mb-5" style={{ color: 'var(--c-muted-3)' }}>
                Enter your email and we'll send a reset link.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
                    Email address
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
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

                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
                >
                  {loading ? 'Sending…' : 'Send reset link'}
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
