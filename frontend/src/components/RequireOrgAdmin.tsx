import { Outlet } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

/**
 * Wraps routes that require org_admin or org_owner.
 * Non-admin users see a 403 page instead of being redirected,
 * so they know the page exists but they lack permission.
 */
export default function RequireOrgAdmin() {
  const { isOrgAdmin, isLoading } = useAuth()

  if (isLoading) return null

  if (!isOrgAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-6xl font-bold font-display mb-4" style={{ color: 'var(--c-border-bright)' }}>403</p>
        <p className="text-lg font-medium mb-2" style={{ color: 'var(--c-text)' }}>Access denied</p>
        <p className="text-sm mb-8" style={{ color: 'var(--c-muted-3)' }}>
          This page requires org admin privileges.
        </p>
        <Link
          to="/catalog"
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}
        >
          Go to Catalog
        </Link>
      </div>
    )
  }

  return <Outlet />
}
