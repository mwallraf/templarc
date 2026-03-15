import { apiClient } from './client'

export interface SandboxRenderRequest {
  template: string
  context?: Record<string, unknown> | null
}

export interface SandboxRenderResult {
  output: string
  error: string | null
}

export interface SandboxLintResult {
  ok: boolean
  error: string | null
  line: number | null
  col: number | null
}

export const sandboxRender = (data: SandboxRenderRequest) =>
  apiClient.post<SandboxRenderResult>('/sandbox/render', data).then((r) => r.data)

export const sandboxLint = (template: string) =>
  apiClient.post<SandboxLintResult>('/sandbox/lint', { template }).then((r) => r.data)
