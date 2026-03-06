import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

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
]

const ADMIN_LINKS = [
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
    to: '/admin/filters',
    label: 'Filters',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
        <polyline points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
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
]

function Breadcrumbs() {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  return (
    <nav className="flex items-center gap-1.5 text-xs mb-5" style={{ color: '#546485' }}>
      <Link to="/" className="hover:text-slate-300 transition-colors">
        Home
      </Link>
      {segments.map((seg, i) => {
        const to = '/' + segments.slice(0, i + 1).join('/')
        const isLast = i === segments.length - 1
        return (
          <span key={to} className="flex items-center gap-1.5">
            <span style={{ color: '#2a3255' }}>/</span>
            {isLast ? (
              <span className="text-slate-300 font-medium capitalize">{decodeURIComponent(seg)}</span>
            ) : (
              <Link to={to} className="hover:text-slate-300 transition-colors capitalize">
                {decodeURIComponent(seg)}
              </Link>
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
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : '??'

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: '#080a12' }}>
      {/* Sidebar */}
      <aside
        className="w-56 shrink-0 flex flex-col border-r"
        style={{
          background: 'linear-gradient(180deg, #0d1021 0%, #0a0d1c 100%)',
          borderColor: '#1e2440',
        }}
      >
        {/* Logo */}
        <div className="px-4 py-5 border-b" style={{ borderColor: '#1e2440' }}>
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

          {/* Admin section divider */}
          <div className="pt-5 pb-2 px-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#2d3665' }}>
              Admin
            </p>
          </div>

          {ADMIN_LINKS.map(({ to, label, icon }) => (
            <NavItem key={to} to={to} label={label} icon={icon} />
          ))}
        </nav>

        {/* User section */}
        <div className="px-3 py-3 border-t" style={{ borderColor: '#1e2440' }}>
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
                onClick={handleLogout}
                title="Sign out"
                className="transition-colors shrink-0"
                style={{ color: '#3d4777' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#94a3b8')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#3d4777')}
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
      <main className="flex-1 overflow-auto" style={{ backgroundColor: '#080a12' }}>
        <div className="max-w-6xl mx-auto px-6 py-6">
          <Breadcrumbs />
          <Outlet />
        </div>
      </main>
    </div>
  )
}
