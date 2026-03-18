import { Route, Routes, Link } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import Landing from './pages/Landing'
import Catalog from './pages/Catalog'
import ProjectCatalog from './pages/ProjectCatalog'
import RenderPage from './pages/RenderPage'
import History from './pages/History'
import HistoryDetail from './pages/HistoryDetail'
import AdminTemplates from './pages/admin/AdminTemplates'
import AdminParameters from './pages/admin/AdminParameters'
import AdminSecrets from './pages/admin/AdminSecrets'
import AdminFilters from './pages/admin/AdminFilters'
import AdminUsers from './pages/admin/AdminUsers'
import AdminProjects from './pages/admin/AdminProjects'
import AdminApiKeys from './pages/admin/AdminApiKeys'
import AdminFeatures from './pages/admin/AdminFeatures'
import AdminWebhooks from './pages/admin/AdminWebhooks'
import AdminSettings from './pages/admin/AdminSettings'
import AdminMembers from './pages/admin/AdminMembers'
import RequireOrgAdmin from './components/RequireOrgAdmin'
import TemplateEditorPage from './pages/admin/TemplateEditorPage'
import Profile from './pages/Profile'
import Login from './pages/Login'
import QuickpadsPage from './pages/Quickpads'
import Sandbox from './pages/Sandbox'

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />

      {/* Protected routes — RequireAuth redirects to /login if not authenticated */}
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/catalog/:projectSlug" element={<ProjectCatalog />} />
          <Route path="/render/:templateId" element={<RenderPage />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:renderId" element={<HistoryDetail />} />
          <Route path="/quickpads" element={<QuickpadsPage />} />
          <Route path="/sandbox" element={<Sandbox />} />
          {/* Studio routes — all authenticated users */}
          <Route path="/admin/templates" element={<AdminTemplates />} />
          <Route path="/admin/templates/:templateId/edit" element={<TemplateEditorPage />} />
          <Route path="/admin/parameters" element={<AdminParameters />} />
          <Route path="/admin/filters" element={<AdminFilters />} />
          <Route path="/admin/features" element={<AdminFeatures />} />
          <Route path="/admin/webhooks" element={<AdminWebhooks />} />
          <Route path="/admin/members" element={<AdminMembers />} />

          {/* System routes — org admin only */}
          <Route element={<RequireOrgAdmin />}>
            <Route path="/admin/projects" element={<AdminProjects />} />
            <Route path="/admin/secrets" element={<AdminSecrets />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/api-keys" element={<AdminApiKeys />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
          </Route>
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={
            <div className="flex flex-col items-center justify-center py-32 text-center">
              <p className="text-6xl font-bold font-display mb-4" style={{ color: 'var(--c-border-bright)' }}>404</p>
              <p className="text-lg font-medium mb-2" style={{ color: 'var(--c-text)' }}>Page not found</p>
              <p className="text-sm mb-8" style={{ color: 'var(--c-muted-3)' }}>The URL you entered doesn't exist.</p>
              <Link to="/catalog" className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}>
                Go to Catalog
              </Link>
            </div>
          } />
        </Route>
      </Route>

      {/* Public catch-all */}
      <Route path="*" element={
        <div className="min-h-screen flex flex-col items-center justify-center text-center" style={{ backgroundColor: 'var(--c-base)' }}>
          <p className="text-6xl font-bold mb-4" style={{ color: 'var(--c-border-bright)' }}>404</p>
          <p className="text-lg font-medium mb-2 text-white">Page not found</p>
          <p className="text-sm mb-8" style={{ color: 'var(--c-muted-3)' }}>The URL you entered doesn't exist.</p>
          <Link to="/" className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}>
            Go home
          </Link>
        </div>
      } />
    </Routes>
  )
}
