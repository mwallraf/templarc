import { apiClient as api } from './client'
import type {
  FeatureBodyUpdate,
  FeatureCreate,
  FeatureListOut,
  FeatureOut,
  FeatureParameterCreate,
  FeatureParameterOut,
  FeatureUpdate,
  TemplateFeatureOut,
  TemplateFeatureUpdate,
} from './types'

// ── Feature CRUD ────────────────────────────────────────────────────────────

export async function listFeatures(projectId?: number, includeInactive = false): Promise<FeatureListOut> {
  const params: Record<string, unknown> = { include_inactive: includeInactive }
  if (projectId != null) params.project_id = projectId
  const { data } = await api.get('/features', { params })
  return data
}

export async function getFeature(id: number): Promise<FeatureOut> {
  const { data } = await api.get(`/features/${id}`)
  return data
}

export async function createFeature(body: FeatureCreate): Promise<FeatureOut> {
  const { data } = await api.post('/features', body)
  return data
}

export async function updateFeature(id: number, body: FeatureUpdate): Promise<FeatureOut> {
  const { data } = await api.put(`/features/${id}`, body)
  return data
}

export async function deleteFeature(id: number): Promise<void> {
  await api.delete(`/features/${id}`)
}

// ── Feature body (Git) ──────────────────────────────────────────────────────

export async function getFeatureBody(id: number): Promise<{ body: string; snippet_path: string | null }> {
  const { data } = await api.get(`/features/${id}/body`)
  return data
}

export async function updateFeatureBody(id: number, body: FeatureBodyUpdate): Promise<{ snippet_path: string; ok: boolean }> {
  const { data } = await api.put(`/features/${id}/body`, body)
  return data
}

// ── Feature parameters ──────────────────────────────────────────────────────

export async function listFeatureParameters(featureId: number): Promise<FeatureParameterOut[]> {
  const { data } = await api.get(`/features/${featureId}/parameters`)
  return data
}

export async function createFeatureParameter(featureId: number, body: FeatureParameterCreate): Promise<FeatureParameterOut> {
  const { data } = await api.post(`/features/${featureId}/parameters`, body)
  return data
}

export async function updateFeatureParameter(
  featureId: number,
  paramId: number,
  body: Partial<FeatureParameterCreate>,
): Promise<FeatureParameterOut> {
  const { data } = await api.put(`/features/${featureId}/parameters/${paramId}`, body)
  return data
}

export async function deleteFeatureParameter(featureId: number, paramId: number): Promise<void> {
  await api.delete(`/features/${featureId}/parameters/${paramId}`)
}

// ── Template ↔ Feature attachment ───────────────────────────────────────────

export async function listTemplateFeatures(templateId: number): Promise<TemplateFeatureOut[]> {
  const { data } = await api.get(`/features/templates/${templateId}/features`)
  return data
}

export async function attachFeature(
  templateId: number,
  featureId: number,
  isDefault = false,
  sortOrder = 0,
): Promise<TemplateFeatureOut> {
  const { data } = await api.post(
    `/features/templates/${templateId}/features/${featureId}`,
    null,
    { params: { is_default: isDefault, sort_order: sortOrder } },
  )
  return data
}

export async function updateTemplateFeature(
  templateId: number,
  featureId: number,
  body: TemplateFeatureUpdate,
): Promise<TemplateFeatureOut> {
  const { data } = await api.put(`/features/templates/${templateId}/features/${featureId}`, body)
  return data
}

export async function detachFeature(templateId: number, featureId: number): Promise<void> {
  await api.delete(`/features/templates/${templateId}/features/${featureId}`)
}
