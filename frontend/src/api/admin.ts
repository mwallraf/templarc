import { apiClient } from './client'
import type {
  ApiKeyCreate,
  ApiKeyCreatedOut,
  ApiKeyOut,
  CustomFilterCreate,
  CustomFilterOut,
  CustomFilterUpdate,
  FilterTestResult,
  CustomObjectCreate,
  CustomObjectOut,
  CustomObjectUpdate,
  CustomMacroCreate,
  CustomMacroOut,
  CustomMacroUpdate,
  DuplicatesReport,
  PromoteRequest,
  PromoteReport,
  AISettingsOut,
  GitRemoteStatusOut,
  GitRemoteActionOut,
  GitRemoteTestOut,
  RenderWebhookCreate,
  RenderWebhookUpdate,
  RenderWebhookOut,
  RenderWebhookListOut,
  WebhookTestResult,
  ProjectMembershipCreate,
  ProjectMembershipOut,
  ProjectMembershipsListOut,
  OrgSettingsOut,
  OrgSettingsPatch,
  OrgStatsOut,
  WebhookDeliveryListOut,
} from './types'

// ── API Keys ────────────────────────────────────────────────────────────────

export const listApiKeys = () =>
  apiClient.get<ApiKeyOut[]>('/auth/api-keys').then((r) => r.data)

export const createApiKey = (data: ApiKeyCreate) =>
  apiClient.post<ApiKeyCreatedOut>('/auth/api-keys', data).then((r) => r.data)

export const deleteApiKey = (id: number) =>
  apiClient.delete(`/auth/api-keys/${id}`)

export const listFilters = (params?: { scope?: string; project_id?: string }) =>
  apiClient.get<CustomFilterOut[]>('/admin/filters', { params }).then((r) => r.data)

export const createFilter = (data: CustomFilterCreate) =>
  apiClient.post<CustomFilterOut>('/admin/filters', data).then((r) => r.data)

export const testFilter = (code: string, test_input = 'test_value') =>
  apiClient
    .post<FilterTestResult>('/admin/filters/test', { code, test_input })
    .then((r) => r.data)

export const updateFilter = (id: number, data: CustomFilterUpdate) =>
  apiClient.put<CustomFilterOut>(`/admin/filters/${id}`, data).then((r) => r.data)

export const deleteFilter = (id: number) =>
  apiClient
    .delete<{ id: number; used_in_templates: string[] }>(`/admin/filters/${id}`)
    .then((r) => r.data)

export const listObjects = (params?: { project_id?: string }) =>
  apiClient.get<CustomObjectOut[]>('/admin/objects', { params }).then((r) => r.data)

export const createObject = (data: CustomObjectCreate) =>
  apiClient.post<CustomObjectOut>('/admin/objects', data).then((r) => r.data)

export const updateObject = (id: number, data: CustomObjectUpdate) =>
  apiClient.put<CustomObjectOut>(`/admin/objects/${id}`, data).then((r) => r.data)

export const deleteObject = (id: number) =>
  apiClient.delete<{ id: number }>(`/admin/objects/${id}`).then((r) => r.data)

export const listMacros = (params?: { scope?: string; project_id?: string }) =>
  apiClient.get<CustomMacroOut[]>('/admin/macros', { params }).then((r) => r.data)

export const createMacro = (data: CustomMacroCreate) =>
  apiClient.post<CustomMacroOut>('/admin/macros', data).then((r) => r.data)

export const updateMacro = (id: number, data: CustomMacroUpdate) =>
  apiClient.put<CustomMacroOut>(`/admin/macros/${id}`, data).then((r) => r.data)

export const deleteMacro = (id: number) =>
  apiClient.delete<{ id: number }>(`/admin/macros/${id}`).then((r) => r.data)

// ── AI Settings ─────────────────────────────────────────────────────────────

export const getAISettings = () =>
  apiClient.get<AISettingsOut>('/settings/ai').then((r) => r.data)

export const findDuplicateParameters = (project_id?: string) =>
  apiClient
    .get<DuplicatesReport>('/admin/parameters/duplicates', { params: project_id ? { project_id } : undefined })
    .then((r) => r.data)

export const promoteParameter = (data: PromoteRequest) =>
  apiClient.post<PromoteReport>('/admin/parameters/promote', data).then((r) => r.data)

// ── Remote Git ───────────────────────────────────────────────────────────────

export const getRemoteStatus = (projectId: string) =>
  apiClient.get<GitRemoteStatusOut>(`/admin/git-remote/${projectId}/status`).then((r) => r.data)

export const cloneRemote = (projectId: string) =>
  apiClient.post<GitRemoteActionOut>(`/admin/git-remote/${projectId}/clone`).then((r) => r.data)

export const pullRemote = (projectId: string) =>
  apiClient.post<GitRemoteActionOut>(`/admin/git-remote/${projectId}/pull`).then((r) => r.data)

export const pushRemote = (projectId: string) =>
  apiClient.post<GitRemoteActionOut>(`/admin/git-remote/${projectId}/push`).then((r) => r.data)

export const testRemoteConnection = (projectId: string) =>
  apiClient.post<GitRemoteTestOut>(`/admin/git-remote/${projectId}/test`).then((r) => r.data)

// ── Render Webhooks ───────────────────────────────────────────────────────────

export const listWebhooks = (params?: { project_id?: string; template_id?: string; is_active?: boolean }) =>
  apiClient.get<RenderWebhookListOut>('/webhooks', { params }).then((r) => r.data)

export const createWebhook = (data: RenderWebhookCreate) =>
  apiClient.post<RenderWebhookOut>('/webhooks', data).then((r) => r.data)

export const getWebhook = (id: number) =>
  apiClient.get<RenderWebhookOut>(`/webhooks/${id}`).then((r) => r.data)

export const updateWebhook = (id: number, data: RenderWebhookUpdate) =>
  apiClient.put<RenderWebhookOut>(`/webhooks/${id}`, data).then((r) => r.data)

export const deleteWebhook = (id: number) =>
  apiClient.delete(`/webhooks/${id}`)

export const testWebhook = (id: number) =>
  apiClient.post<WebhookTestResult>(`/webhooks/${id}/test`).then((r) => r.data)

// ── Project Memberships ───────────────────────────────────────────────────────

export const listProjectMembers = (projectId: string) =>
  apiClient.get<ProjectMembershipsListOut>(`/catalog/projects/${projectId}/members`).then((r) => r.data)

export const upsertProjectMember = (projectId: string, data: ProjectMembershipCreate) =>
  apiClient.post<ProjectMembershipOut>(`/catalog/projects/${projectId}/members`, data).then((r) => r.data)

export const removeProjectMember = (projectId: string, userId: string) =>
  apiClient.delete(`/catalog/projects/${projectId}/members/${userId}`)

// ── Org Settings & Stats ─────────────────────────────────────────────────────

export const getOrgSettings = () =>
  apiClient.get<OrgSettingsOut>('/admin/org').then((r) => r.data)

export const patchOrgSettings = (data: OrgSettingsPatch) =>
  apiClient.patch<OrgSettingsOut>('/admin/org', data).then((r) => r.data)

export const getOrgStats = () =>
  apiClient.get<OrgStatsOut>('/admin/stats').then((r) => r.data)

// ── Webhook Deliveries ───────────────────────────────────────────────────────

export const getWebhookDeliveries = (webhookId: number, params?: { skip?: number; limit?: number }) =>
  apiClient.get<WebhookDeliveryListOut>(`/admin/webhooks/${webhookId}/deliveries`, { params }).then((r) => r.data)
