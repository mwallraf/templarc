import { apiClient } from './client'
import type {
  ApiKeyCreate,
  ApiKeyCreatedOut,
  ApiKeyOut,
  CustomFilterCreate,
  CustomFilterOut,
  FilterTestResult,
  CustomObjectCreate,
  CustomObjectOut,
  CustomMacroCreate,
  CustomMacroOut,
  DuplicatesReport,
  PromoteRequest,
  PromoteReport,
  AISettingsOut,
} from './types'

// ── API Keys ────────────────────────────────────────────────────────────────

export const listApiKeys = () =>
  apiClient.get<ApiKeyOut[]>('/auth/api-keys').then((r) => r.data)

export const createApiKey = (data: ApiKeyCreate) =>
  apiClient.post<ApiKeyCreatedOut>('/auth/api-keys', data).then((r) => r.data)

export const deleteApiKey = (id: number) =>
  apiClient.delete(`/auth/api-keys/${id}`)

export const listFilters = (params?: { scope?: string; project_id?: number }) =>
  apiClient.get<CustomFilterOut[]>('/admin/filters', { params }).then((r) => r.data)

export const createFilter = (data: CustomFilterCreate) =>
  apiClient.post<CustomFilterOut>('/admin/filters', data).then((r) => r.data)

export const testFilter = (code: string, test_input = 'test_value') =>
  apiClient
    .post<FilterTestResult>('/admin/filters/test', { code, test_input })
    .then((r) => r.data)

export const deleteFilter = (id: number) =>
  apiClient
    .delete<{ id: number; used_in_templates: string[] }>(`/admin/filters/${id}`)
    .then((r) => r.data)

export const listObjects = (params?: { project_id?: number }) =>
  apiClient.get<CustomObjectOut[]>('/admin/objects', { params }).then((r) => r.data)

export const createObject = (data: CustomObjectCreate) =>
  apiClient.post<CustomObjectOut>('/admin/objects', data).then((r) => r.data)

export const deleteObject = (id: number) =>
  apiClient.delete<{ id: number }>(`/admin/objects/${id}`).then((r) => r.data)

export const listMacros = (params?: { scope?: string; project_id?: number }) =>
  apiClient.get<CustomMacroOut[]>('/admin/macros', { params }).then((r) => r.data)

export const createMacro = (data: CustomMacroCreate) =>
  apiClient.post<CustomMacroOut>('/admin/macros', data).then((r) => r.data)

export const deleteMacro = (id: number) =>
  apiClient.delete<{ id: number }>(`/admin/macros/${id}`).then((r) => r.data)

// ── AI Settings ─────────────────────────────────────────────────────────────

export const getAISettings = () =>
  apiClient.get<AISettingsOut>('/settings/ai').then((r) => r.data)

export const findDuplicateParameters = (project_id?: number) =>
  apiClient
    .get<DuplicatesReport>('/admin/parameters/duplicates', { params: project_id ? { project_id } : undefined })
    .then((r) => r.data)

export const promoteParameter = (data: PromoteRequest) =>
  apiClient.post<PromoteReport>('/admin/parameters/promote', data).then((r) => r.data)
