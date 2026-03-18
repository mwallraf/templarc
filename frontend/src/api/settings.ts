import { getToken } from './client'

const API_BASE = (import.meta.env.VITE_API_URL ?? '/api') as string

export interface AISettingsSource {
  provider: string  // "db" | "env"
  api_key: string   // "db" | "env" | "none"
  model: string     // "db" | "env"
  base_url: string  // "db" | "env"
}

export interface AISettingsOut {
  provider: string
  model: string
  base_url: string
  api_key_configured: boolean
  source: AISettingsSource
}

export interface AISettingsUpdate {
  provider?: string | null
  api_key?: string | null
  model?: string | null
  base_url?: string | null
}

export interface AITestResult {
  enabled: boolean
  provider: string | null
  model: string | null
  error: string | null
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

export async function getAISettings(): Promise<AISettingsOut> {
  const res = await fetch(`${API_BASE}/settings/ai`, { headers: authHeaders() })
  if (!res.ok) throw new Error('Failed to fetch AI settings')
  return res.json()
}

export async function updateAISettings(data: AISettingsUpdate): Promise<AISettingsOut> {
  const res = await fetch(`${API_BASE}/settings/ai`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Save failed' }))
    throw new Error(err.detail ?? 'Save failed')
  }
  return res.json()
}

export async function testAISettings(): Promise<AITestResult> {
  const res = await fetch(`${API_BASE}/settings/ai/test`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('Test request failed')
  return res.json()
}

// ── Email / SMTP ─────────────────────────────────────────────────────────────

export interface EmailSettingsSource {
  host: string   // "db" | "env"
  port: string   // "db" | "env"
  user: string   // "db" | "env"
  from_: string  // "db" | "env"
}

export interface EmailSettingsOut {
  host: string
  port: number
  user: string
  from_: string
  password_configured: boolean
  source: EmailSettingsSource
}

export interface EmailSettingsUpdate {
  host?: string | null
  port?: number | null
  user?: string | null
  password?: string | null
  from_?: string | null
}

export interface EmailTestResult {
  success: boolean
  error: string | null
}

export async function getEmailSettings(): Promise<EmailSettingsOut> {
  const res = await fetch(`${API_BASE}/settings/email`, { headers: authHeaders() })
  if (!res.ok) throw new Error('Failed to fetch email settings')
  return res.json()
}

export async function updateEmailSettings(data: EmailSettingsUpdate): Promise<EmailSettingsOut> {
  const res = await fetch(`${API_BASE}/settings/email`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Save failed' }))
    throw new Error(err.detail ?? 'Save failed')
  }
  return res.json()
}

export async function testEmailSettings(): Promise<EmailTestResult> {
  const res = await fetch(`${API_BASE}/settings/email/test`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('Test request failed')
  return res.json()
}
