import { apiClient } from './client'
import type {
  ParameterOut,
  ParameterCreate,
  ParameterUpdate,
  ParameterOptionOut,
  ParameterOptionCreate,
  PaginatedResponse,
  ParameterScope,
} from './types'

export async function listParameters(params?: {
  scope?: ParameterScope
  organization_id?: string
  project_id?: string
  template_id?: string
  search?: string
  include_inactive?: boolean
  page?: number
  page_size?: number
}): Promise<PaginatedResponse<ParameterOut>> {
  const res = await apiClient.get<PaginatedResponse<ParameterOut>>('/parameters', { params })
  return res.data
}

export async function getParameter(parameterId: number): Promise<ParameterOut> {
  const res = await apiClient.get<ParameterOut>(`/parameters/${parameterId}`)
  return res.data
}

export async function createParameter(data: ParameterCreate): Promise<ParameterOut> {
  const res = await apiClient.post<ParameterOut>('/parameters', data)
  return res.data
}

export async function updateParameter(
  parameterId: number,
  data: ParameterUpdate,
): Promise<ParameterOut> {
  const res = await apiClient.put<ParameterOut>(`/parameters/${parameterId}`, data)
  return res.data
}

export async function deleteParameter(parameterId: number): Promise<void> {
  await apiClient.delete(`/parameters/${parameterId}`)
}

export async function listParameterOptions(parameterId: number): Promise<ParameterOptionOut[]> {
  const res = await apiClient.get<ParameterOptionOut[]>(`/parameters/${parameterId}/options`)
  return res.data
}

export async function createParameterOption(
  parameterId: number,
  data: ParameterOptionCreate,
): Promise<ParameterOptionOut> {
  const res = await apiClient.post<ParameterOptionOut>(`/parameters/${parameterId}/options`, data)
  return res.data
}

export async function deleteParameterOption(
  parameterId: number,
  optionId: number,
): Promise<void> {
  await apiClient.delete(`/parameters/${parameterId}/options/${optionId}`)
}
