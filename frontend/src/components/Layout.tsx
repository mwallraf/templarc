import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'

const NAV_LINKS = [
  {
    to: '/catalog',
    label: 'Catalog',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    to: '/history',
    label: 'History',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15.5 15" />
      </svg>
    ),
  },
  {
    to: '/quickpads',
    label: 'Quickpads',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    to: '/sandbox',
    label: 'Sandbox',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
        <line x1="12" y1="2" x2="12" y2="22" />
      </svg>
    ),
  },
]

const STUDIO_LINKS = [
  {
    to: '/admin/templates',
    label: 'Templates',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <polyline points="10 13 8 15 10 17" />
        <polyline points="14 13 16 15 14 17" />
      </svg>
    ),
  },
  {
    to: '/admin/features',
    label: 'Features',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    to: '/admin/parameters',
    label: 'Parameters',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
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
  },
  {
    to: '/admin/filters',
    label: 'Filters',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <polyline points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
    ),
  },
  {
    to: '/admin/webhooks',
    label: 'Webhooks',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
  {
    to: '/admin/members',
    label: 'Members',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
]

const SYSTEM_LINKS = [
  {
    to: '/admin/projects',
    label: 'Projects',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    to: '/admin/secrets',
    label: 'Secrets',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
    ),
  },
  {
    to: '/admin/users',
    label: 'Users',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  {
    to: '/admin/api-keys',
    label: 'API Keys',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    ),
  },
  {
    to: '/admin/settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
]

// Route namespaces that have no standalone page — links to them would 404.
const _NO_LINK_SEGMENTS = new Set(['render', 'history', 'admin'])

// Sub-paths under /admin/ that belong to the Studio section (not System/Admin).
const _STUDIO_SUBPATHS = new Set(['templates', 'features', 'parameters', 'filters', 'webhooks', 'members'])

function _segmentLabel(seg: string, segments: string[]): string {
  if (seg === 'admin') {
    return _STUDIO_SUBPATHS.has(segments[1]) ? 'Studio' : 'Admin'
  }
  return decodeURIComponent(seg)
}

function Breadcrumbs() {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  return (
    <nav className="flex items-center gap-1.5 text-xs mb-5" style={{ color: 'var(--c-muted-3)' }}>
      <Link to="/" className="hover:text-slate-300 transition-colors">
        Home
      </Link>
      {segments.map((seg, i) => {
        const to = '/' + segments.slice(0, i + 1).join('/')
        const isLast = i === segments.length - 1
        const isLinkable = !isLast && !_NO_LINK_SEGMENTS.has(seg)
        const label = _segmentLabel(seg, segments)
        return (
          <span key={to} className="flex items-center gap-1.5">
            <span style={{ color: 'var(--c-border-bright)' }}>/</span>
            {isLinkable ? (
              <Link to={to} className="hover:text-slate-300 transition-colors capitalize">
                {label}
              </Link>
            ) : (
              <span className={isLast ? 'text-slate-300 font-medium capitalize' : 'capitalize'} style={isLast ? undefined : { color: 'var(--c-muted-3)' }}>
                {label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 group ${
          isActive
            ? 'nav-active-indicator text-indigo-400'
            : 'text-slate-500 hover:text-slate-200'
        }`
      }
      style={({ isActive }) =>
        isActive
          ? { backgroundColor: 'rgba(99,102,241,0.1)' }
          : undefined
      }
    >
      {({ isActive }) => (
        <>
          <span className={isActive ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400 transition-colors'}>
            {icon}
          </span>
          {label}
        </>
      )}
    </NavLink>
  )
}

export default function Layout() {
  const { user, logout, isOrgAdmin } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : '??'

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--c-base)' }}>
      {/* Sidebar */}
      <aside
        className="w-56 shrink-0 flex flex-col border-r"
        style={{
          background: 'linear-gradient(180deg, var(--c-surface) 0%, var(--c-surface-alt) 100%)',
          borderColor: 'var(--c-border)',
        }}
      >
        {/* Logo */}
        <div className="px-4 py-5 border-b" style={{ borderColor: 'var(--c-border)' }}>
          <Link to="/" className="flex items-center gap-2.5">
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
            <span className="text-base font-bold tracking-tight text-white font-display">
              Templarc
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
          {NAV_LINKS.map(({ to, label, icon }) => (
            <NavItem key={to} to={to} label={label} icon={icon} />
          ))}

          {/* Studio section — all authenticated users (project editors/admins need this) */}
          <div className="pt-5 pb-2 px-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--c-dim)' }}>
              Studio
            </p>
          </div>
          {STUDIO_LINKS.map(({ to, label, icon }) => (
            <NavItem key={to} to={to} label={label} icon={icon} />
          ))}

          {/* System section — org admins only */}
          {isOrgAdmin && (
            <>
              <div className="pt-5 pb-2 px-2">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--c-dim)' }}>
                  System
                </p>
              </div>
              {SYSTEM_LINKS.map(({ to, label, icon }) => (
                <NavItem key={to} to={to} label={label} icon={icon} />
              ))}
            </>
          )}
        </nav>

        {/* User section */}
        <div className="px-3 py-3 border-t" style={{ borderColor: 'var(--c-border)' }}>
          {user ? (
            <div className="flex items-center gap-2.5">
              <Link to="/profile" className="flex items-center gap-2.5 flex-1 min-w-0 group">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white transition-opacity group-hover:opacity-80"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}
                >
                  {initials}
                </div>
                <span className="text-sm text-slate-300 truncate font-medium group-hover:text-white transition-colors">
                  {user.username}
                </span>
              </Link>
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="transition-colors shrink-0"
                style={{ color: 'var(--c-muted-4)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-muted-1)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-4)')}
              >
                {theme === 'dark' ? (
                  /* Sun icon */
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                    <circle cx="12" cy="12" r="4" />
                    <line x1="12" y1="2" x2="12" y2="4" />
                    <line x1="12" y1="20" x2="12" y2="22" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="2" y1="12" x2="4" y2="12" />
                    <line x1="20" y1="12" x2="22" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                ) : (
                  /* Moon icon */
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                  </svg>
                )}
              </button>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="transition-colors shrink-0"
                style={{ color: 'var(--c-muted-4)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-muted-1)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-4)')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
          ) : (
            <Link to="/login" className="text-indigo-400 hover:text-indigo-300 text-sm transition-colors">
              Sign in
            </Link>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--c-base)' }}>
        <div className="max-w-400 mx-auto px-6 py-6">
          <Breadcrumbs />
          <Outlet />
        </div>
      </main>
    </div>
  )
}
