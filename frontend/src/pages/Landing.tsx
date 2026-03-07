import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const FEATURES = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <polyline points="10 13 8 15 10 17" />
        <polyline points="14 13 16 15 14 17" />
      </svg>
    ),
    title: 'Jinja2 Template Catalog',
    description: 'Organise templates in a hierarchical project catalog with parameter inheritance chains.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </svg>
    ),
    title: 'Dynamic Form Generation',
    description: 'Parameters render as typed form widgets — text, select, multiselect, password, and more.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15.5 15" />
      </svg>
    ),
    title: 'Full Render History',
    description: 'Every render is stored with its resolved parameters, git SHA, and rendered output for audit and replay.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 015.656 0l.586.586a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.102-1.101" />
      </svg>
    ),
    title: 'Remote Data Sources',
    description: 'Connect parameters to external APIs. Values auto-fill as users type — no manual lookups.',
  },
]

export default function Landing() {
  const { isAuthenticated } = useAuth()

  // Already logged in → send to catalog
  if (isAuthenticated) {
    return <Navigate to="/catalog" replace />
  }

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{ backgroundColor: 'var(--c-base)' }}
    >
      {/* Background glows */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 40% at 50% -5%, rgba(99,102,241,0.14) 0%, transparent 65%)',
        }}
      />
      <div className="absolute inset-0 bg-grid pointer-events-none opacity-40" />

      {/* Top nav */}
      <header className="relative flex items-center justify-between px-8 py-5 border-b" style={{ borderColor: 'var(--c-border)' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              boxShadow: '0 0 16px rgba(99,102,241,0.35)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="white" className="w-3.5 h-3.5">
              <path d="M3 5h18v2H3V5zm0 6h12v2H3v-2zm0 6h18v2H3v-2z" />
            </svg>
          </div>
          <span className="text-base font-bold tracking-tight text-white font-display">Templarc</span>
        </div>
        <Link
          to="/login"
          className="px-4 py-2 text-sm font-semibold rounded-lg transition-all"
          style={{
            background: 'linear-gradient(135deg, #6366f1, #818cf8)',
            boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
            color: 'white',
          }}
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section className="relative flex-1 flex flex-col items-center justify-center text-center px-6 py-20">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-8 border"
          style={{
            backgroundColor: 'rgba(99,102,241,0.08)',
            borderColor: 'rgba(99,102,241,0.2)',
            color: '#818cf8',
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />
          Template Engine Platform
        </div>

        <h1
          className="text-5xl font-bold tracking-tight text-white font-display mb-5 max-w-2xl"
          style={{ lineHeight: 1.1 }}
        >
          Generate structured text at scale
        </h1>
        <p className="text-lg max-w-lg mb-10" style={{ color: 'var(--c-muted-3)', lineHeight: 1.65 }}>
          Templarc turns Jinja2 templates into parameterized, auditable, API-driven workflows — for
          network configs, cloud scripts, contracts, or any structured output.
        </p>

        <Link
          to="/login"
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-xl transition-all"
          style={{
            background: 'linear-gradient(135deg, #6366f1, #818cf8)',
            boxShadow: '0 6px 20px rgba(99,102,241,0.35)',
            color: 'white',
          }}
        >
          Sign in to get started
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Link>
      </section>

      {/* Feature grid */}
      <section className="relative px-8 pb-20">
        <div className="max-w-4xl mx-auto grid grid-cols-2 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border p-5"
              style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
                style={{ backgroundColor: 'rgba(99,102,241,0.1)', color: '#818cf8' }}
              >
                {f.icon}
              </div>
              <h3 className="text-sm font-semibold text-white mb-1.5">{f.title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--c-muted-3)' }}>{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t px-8 py-4 text-center text-xs" style={{ borderColor: 'var(--c-border)', color: 'var(--c-dim)' }}>
        Templarc Template Engine · v1.0
      </footer>
    </div>
  )
}
