import axios from 'axios'

const TOKEN_KEY = 'templarc_token'

// Restore token from localStorage on module load
let _accessToken: string | null = localStorage.getItem(TOKEN_KEY)

export function setToken(token: string | null) {
  _accessToken = token
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
}

export function getToken() {
  return _accessToken
}

// VITE_API_URL — set this to override the API base URL (e.g. https://api.example.com).
// Omit (or leave empty) to use the Vite dev proxy (/api → localhost:8000).
const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use((config) => {
  if (_accessToken) {
    config.headers.Authorization = `Bearer ${_accessToken}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      setToken(null)
      // Let AuthContext handle redirect via React state
      window.dispatchEvent(new CustomEvent('auth:unauthorized'))
    }
    return Promise.reject(error)
  },
)
