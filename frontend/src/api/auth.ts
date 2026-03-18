import { apiClient } from './client'
import type { LoginRequest, TokenResponse, SecretCreate, SecretOut, UserOut, UserCreate, UserUpdate, MeOut, MeUpdate } from './types'

export async function login(data: LoginRequest): Promise<TokenResponse> {
  const form = new URLSearchParams()
  form.set('username', data.username)
  form.set('password', data.password)
  const res = await apiClient.post<TokenResponse>('/auth/token', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return res.data
}

export async function listSecrets(): Promise<SecretOut[]> {
  const res = await apiClient.get<SecretOut[]>('/auth/secrets')
  return res.data
}

export async function createSecret(data: SecretCreate): Promise<SecretOut> {
  const res = await apiClient.post<SecretOut>('/auth/secrets', data)
  return res.data
}

export async function deleteSecret(secretId: number): Promise<void> {
  await apiClient.delete(`/auth/secrets/${secretId}`)
}

export async function listUsers(): Promise<UserOut[]> {
  const res = await apiClient.get<UserOut[]>('/auth/users')
  return res.data
}

export async function createUser(data: UserCreate): Promise<UserOut> {
  const res = await apiClient.post<UserOut>('/auth/users', data)
  return res.data
}

export async function updateUser(userId: string, data: UserUpdate): Promise<UserOut> {
  const res = await apiClient.patch<UserOut>(`/auth/users/${userId}`, data)
  return res.data
}

export async function deleteUser(userId: string): Promise<void> {
  await apiClient.delete(`/auth/users/${userId}`)
}

export async function getMe(): Promise<MeOut> {
  const res = await apiClient.get<MeOut>('/auth/me')
  return res.data
}

export async function updateMe(data: MeUpdate): Promise<MeOut> {
  const res = await apiClient.patch<MeOut>('/auth/me', data)
  return res.data
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  const res = await apiClient.post<{ message: string }>('/auth/forgot-password', { email })
  return res.data
}

export async function resetPassword(token: string, new_password: string): Promise<{ message: string }> {
  const res = await apiClient.post<{ message: string }>('/auth/reset-password', { token, new_password })
  return res.data
}
