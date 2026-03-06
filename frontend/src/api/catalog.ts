import { apiClient } from './client'
import type {
  ProjectOut,
  ProjectCreate,
  ProjectUpdate,
  ProjectDetailOut,
  TemplateTreeNode,
  CatalogResponse,
} from './types'

export async function listProjects(params?: {
  organization_id?: number
  search?: string
}): Promise<ProjectOut[]> {
  const res = await apiClient.get<ProjectOut[]>('/catalog/projects', { params })
  return res.data
}

export async function createProject(data: ProjectCreate): Promise<ProjectOut> {
  const res = await apiClient.post<ProjectOut>('/catalog/projects', data)
  return res.data
}

export async function getProject(projectId: number): Promise<ProjectDetailOut> {
  const res = await apiClient.get<ProjectDetailOut>(`/catalog/projects/${projectId}`)
  return res.data
}

export async function updateProject(projectId: number, data: ProjectUpdate): Promise<ProjectOut> {
  const res = await apiClient.put<ProjectOut>(`/catalog/projects/${projectId}`, data)
  return res.data
}

export async function getProjectTemplates(projectId: number): Promise<TemplateTreeNode[]> {
  const res = await apiClient.get<TemplateTreeNode[]>(`/catalog/projects/${projectId}/templates`)
  return res.data
}

export async function getCatalog(projectSlug: string): Promise<CatalogResponse> {
  const res = await apiClient.get<CatalogResponse>(`/catalog/${projectSlug}`)
  return res.data
}
