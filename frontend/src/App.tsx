import { Route, Routes } from 'react-router-dom'
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
import TemplateEditorPage from './pages/admin/TemplateEditorPage'
import Profile from './pages/Profile'
import Login from './pages/Login'
import QuickpadsPage from './pages/Quickpads'

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
          <Route path="/admin/projects" element={<AdminProjects />} />
          <Route path="/admin/templates" element={<AdminTemplates />} />
          <Route path="/admin/templates/:templateId/edit" element={<TemplateEditorPage />} />
          <Route path="/admin/parameters" element={<AdminParameters />} />
          <Route path="/admin/secrets" element={<AdminSecrets />} />
          <Route path="/admin/filters" element={<AdminFilters />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/api-keys" element={<AdminApiKeys />} />
          <Route path="/admin/features" element={<AdminFeatures />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Route>
    </Routes>
  )
}
