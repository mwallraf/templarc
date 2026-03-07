import { apiClient } from './client'
import type {
  QuickpadCreate,
  QuickpadListOut,
  QuickpadOut,
  QuickpadRenderOut,
  QuickpadRenderRequest,
  QuickpadUpdate,
  QuickpadVariablesOut,
} from './types'

export const listQuickpads = (): Promise<QuickpadListOut> =>
  apiClient.get<QuickpadListOut>('/quickpads').then((r) => r.data)

export const createQuickpad = (data: QuickpadCreate): Promise<QuickpadOut> =>
  apiClient.post<QuickpadOut>('/quickpads', data).then((r) => r.data)

export const getQuickpad = (id: string): Promise<QuickpadOut> =>
  apiClient.get<QuickpadOut>(`/quickpads/${id}`).then((r) => r.data)

export const updateQuickpad = (id: string, data: QuickpadUpdate): Promise<QuickpadOut> =>
  apiClient.put<QuickpadOut>(`/quickpads/${id}`, data).then((r) => r.data)

export const deleteQuickpad = (id: string): Promise<void> =>
  apiClient.delete(`/quickpads/${id}`).then(() => undefined)

export const getQuickpadVariables = (id: string): Promise<QuickpadVariablesOut> =>
  apiClient.get<QuickpadVariablesOut>(`/quickpads/${id}/variables`).then((r) => r.data)

export const renderQuickpad = (id: string, data: QuickpadRenderRequest): Promise<QuickpadRenderOut> =>
  apiClient.post<QuickpadRenderOut>(`/quickpads/${id}/render`, data).then((r) => r.data)
