import { getToken } from './client'

const API_BASE = (import.meta.env.VITE_API_URL ?? '/api') as string

export interface AIGenerateRequest {
  prompt: string
  registered_params?: string[]
  custom_filters?: string[]
  existing_body?: string
}

export interface AIStatus {
  enabled: boolean
  provider: string | null
  model: string | null
  error: string | null
}

/** Check whether the AI assistant is configured on the server. */
export async function getAIStatus(): Promise<AIStatus> {
  const token = getToken()
  const res = await fetch(`${API_BASE}/ai/status`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('Failed to fetch AI status')
  return res.json()
}

/**
 * Stream Jinja2 template body tokens from the AI assistant.
 *
 * Yields plain text chunks as they arrive. Each `data:` SSE line carries
 * a JSON-encoded string. The stream ends when `data: [DONE]` is received.
 *
 * Throws if the server returns an error status or streams an `__error__` event.
 */
export async function* streamAIGenerate(
  request: AIGenerateRequest,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const token = getToken()
  const response = await fetch(`${API_BASE}/ai/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'AI generation failed' }))
    throw new Error(err.detail ?? 'AI generation failed')
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue

      let parsed: unknown
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }

      // Server-side error surfaced as a special event
      if (typeof parsed === 'object' && parsed !== null && '__error__' in parsed) {
        throw new Error((parsed as { __error__: string }).__error__)
      }

      if (typeof parsed === 'string') {
        yield parsed
      }
    }
  }
}
