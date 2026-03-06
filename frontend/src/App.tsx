import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
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
import TemplateEditorPage from './pages/admin/TemplateEditorPage'
import Profile from './pages/Profile'
import Login from './pages/Login'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/catalog" replace />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/catalog/:projectSlug" element={<ProjectCatalog />} />
        <Route path="/render/:templateId" element={<RenderPage />} />
        <Route path="/history" element={<History />} />
        <Route path="/history/:renderId" element={<HistoryDetail />} />
        <Route path="/admin/templates" element={<AdminTemplates />} />
        <Route path="/admin/templates/:templateId/edit" element={<TemplateEditorPage />} />
        <Route path="/admin/parameters" element={<AdminParameters />} />
        <Route path="/admin/secrets" element={<AdminSecrets />} />
        <Route path="/admin/filters" element={<AdminFilters />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
    </Routes>
  )
}
