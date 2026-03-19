import { apiClient } from './client'
import type { HealthOut } from './types'

export const getHealth = (): Promise<{ status: string; version: string; uptime_seconds: number }> =>
  fetch('/api/health').then(r => r.json())

export const getHealthDetail = (): Promise<HealthOut> =>
  apiClient.get<HealthOut>('/health/detail').then(r => r.data)
