import { apiClient } from './client'
import type {
  CustomFilterCreate,
  CustomFilterOut,
  FilterTestResult,
  CustomObjectCreate,
  CustomObjectOut,
} from './types'

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
