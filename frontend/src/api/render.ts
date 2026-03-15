import { apiClient } from './client'
import type {
  FormDefinitionOut,
  RenderRequest,
  RenderOut,
  OnChangeRequest,
  RenderHistoryOut,
  RenderHistoryListOut,
  ReRenderRequest,
  RenderPresetOut,
  RenderPresetCreate,
} from './types'

export async function resolveParams(templateId: number): Promise<FormDefinitionOut> {
  const res = await apiClient.get<FormDefinitionOut>(`/templates/${templateId}/resolve-params`)
  return res.data
}

export async function renderTemplate(
  templateId: number,
  data: RenderRequest,
  options?: { persist?: boolean; user?: string },
): Promise<RenderOut> {
  const res = await apiClient.post<RenderOut>(`/templates/${templateId}/render`, data, {
    params: options,
  })
  return res.data
}

export async function onChangeParam(
  templateId: number,
  paramName: string,
  data: OnChangeRequest,
): Promise<Record<string, unknown>> {
  const res = await apiClient.post<Record<string, unknown>>(
    `/templates/${templateId}/on-change/${paramName}`,
    data,
  )
  return res.data
}

export async function listRenderHistory(params?: {
  template_id?: number
  date_from?: string
  date_to?: string
  search?: string
  display_label?: string
  rendered_by_me?: boolean
  grouped?: boolean
  limit?: number
  offset?: number
}): Promise<RenderHistoryListOut> {
  const res = await apiClient.get<RenderHistoryListOut>('/render-history', { params })
  return res.data
}

export async function getRenderHistory(historyId: number): Promise<RenderHistoryOut> {
  const res = await apiClient.get<RenderHistoryOut>(`/render-history/${historyId}`)
  return res.data
}

export async function reRender(
  historyId: number,
  data: ReRenderRequest,
  user?: string,
): Promise<RenderOut> {
  const res = await apiClient.post<RenderOut>(
    `/render-history/${historyId}/re-render`,
    data,
    { params: { user } },
  )
  return res.data
}

export async function listPresets(templateId: number): Promise<RenderPresetOut[]> {
  const res = await apiClient.get<RenderPresetOut[]>(`/templates/${templateId}/presets`)
  return res.data
}

export async function createPreset(
  templateId: number,
  data: RenderPresetCreate,
): Promise<RenderPresetOut> {
  const res = await apiClient.post<RenderPresetOut>(`/templates/${templateId}/presets`, data)
  return res.data
}

export async function deletePreset(templateId: number, presetId: number): Promise<void> {
  await apiClient.delete(`/templates/${templateId}/presets/${presetId}`)
}
