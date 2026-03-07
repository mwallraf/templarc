import { apiClient } from './client'
import type {
  TemplateOut,
  TemplateCreate,
  TemplateUpdate,
  TemplateUpdateOut,
  TemplateUploadOut,
  VariableRefOut,
  InheritanceChainItem,
  GitSyncRequest,
  SyncReport,
  SyncStatusReport,
} from './types'

export async function listTemplates(params?: {
  project_id?: number
  active_only?: boolean
}): Promise<TemplateOut[]> {
  const res = await apiClient.get<TemplateOut[]>('/templates', { params })
  return res.data
}

export async function getTemplate(templateId: number): Promise<TemplateOut> {
  const res = await apiClient.get<TemplateOut>(`/templates/${templateId}`)
  return res.data
}

export async function createTemplate(data: TemplateCreate): Promise<TemplateOut> {
  const res = await apiClient.post<TemplateOut>('/templates', data)
  return res.data
}

export async function updateTemplate(
  templateId: number,
  data: TemplateUpdate,
): Promise<TemplateUpdateOut> {
  const res = await apiClient.put<TemplateUpdateOut>(`/templates/${templateId}`, data)
  return res.data
}

export async function deleteTemplate(templateId: number): Promise<void> {
  await apiClient.delete(`/templates/${templateId}`)
}

export async function getTemplateVariables(templateId: number): Promise<VariableRefOut[]> {
  const res = await apiClient.get<VariableRefOut[]>(`/templates/${templateId}/variables`)
  return res.data
}

export async function getTemplateContent(templateId: number): Promise<string> {
  const res = await apiClient.get<string>(`/templates/${templateId}/content`, {
    responseType: 'text',
  })
  return res.data
}

export async function getInheritanceChain(templateId: number): Promise<InheritanceChainItem[]> {
  const res = await apiClient.get<InheritanceChainItem[]>(
    `/templates/${templateId}/inheritance-chain`,
  )
  return res.data
}

export async function uploadTemplate(
  file: File,
  projectId: number,
  author = '',
): Promise<TemplateUploadOut> {
  const form = new FormData()
  form.append('file', file)
  form.append('project_id', String(projectId))
  if (author) form.append('author', author)
  const res = await apiClient.post<TemplateUploadOut>('/templates/upload', form)
  return res.data
}

export async function gitSyncStatus(projectId: number): Promise<SyncStatusReport> {
  const res = await apiClient.get<SyncStatusReport>(`/admin/git-sync/${projectId}/status`)
  return res.data
}

export async function gitSyncApply(projectId: number, request: GitSyncRequest): Promise<SyncReport> {
  const res = await apiClient.post<SyncReport>(`/admin/git-sync/${projectId}`, request)
  return res.data
}
