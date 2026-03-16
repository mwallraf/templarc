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
  project_id?: string
  active_only?: boolean
}): Promise<TemplateOut[]> {
  const res = await apiClient.get<TemplateOut[]>('/templates', { params })
  return res.data
}

export async function getTemplate(templateId: string): Promise<TemplateOut> {
  const res = await apiClient.get<TemplateOut>(`/templates/${templateId}`)
  return res.data
}

export async function createTemplate(data: TemplateCreate): Promise<TemplateOut> {
  const res = await apiClient.post<TemplateOut>('/templates', data)
  return res.data
}

export async function updateTemplate(
  templateId: string,
  data: TemplateUpdate,
): Promise<TemplateUpdateOut> {
  const res = await apiClient.put<TemplateUpdateOut>(`/templates/${templateId}`, data)
  return res.data
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await apiClient.delete(`/templates/${templateId}`)
}

export async function getTemplateVariables(templateId: string): Promise<VariableRefOut[]> {
  const res = await apiClient.get<VariableRefOut[]>(`/templates/${templateId}/variables`)
  return res.data
}

export async function getTemplateContent(templateId: string): Promise<string> {
  const res = await apiClient.get<string>(`/templates/${templateId}/content`, {
    responseType: 'text',
  })
  return res.data
}

export async function getTemplateDatasources(templateId: string): Promise<Record<string, unknown>[]> {
  const res = await apiClient.get<Record<string, unknown>[]>(`/templates/${templateId}/datasources`)
  return res.data
}

export async function getInheritanceChain(templateId: string): Promise<InheritanceChainItem[]> {
  const res = await apiClient.get<InheritanceChainItem[]>(
    `/templates/${templateId}/inheritance-chain`,
  )
  return res.data
}

export async function uploadTemplate(
  file: File,
  projectId: string,
  author = '',
): Promise<TemplateUploadOut> {
  const form = new FormData()
  form.append('file', file)
  form.append('project_id', String(projectId))
  if (author) form.append('author', author)
  const res = await apiClient.post<TemplateUploadOut>('/templates/upload', form)
  return res.data
}

export async function gitSyncStatus(projectId: string): Promise<SyncStatusReport> {
  const res = await apiClient.get<SyncStatusReport>(`/admin/git-sync/${projectId}/status`)
  return res.data
}

export async function gitSyncApply(projectId: string, request: GitSyncRequest): Promise<SyncReport> {
  const res = await apiClient.post<SyncReport>(`/admin/git-sync/${projectId}`, request)
  return res.data
}
