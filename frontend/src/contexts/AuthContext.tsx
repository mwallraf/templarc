import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { login as apiLogin } from '../api/auth'
import type { LoginRequest } from '../api/types'
import { getToken, setToken } from '../api/client'

interface AuthUser {
  username: string
}

interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (data: LoginRequest) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(atob(payload))
  } catch {
    return null
  }
}

function restoreUserFromToken(): AuthUser | null {
  const token = getToken()
  if (!token) return null
  const payload = parseJwtPayload(token)
  const exp = payload?.exp as number | undefined
  if (!exp || exp * 1000 <= Date.now()) {
    setToken(null) // clear expired token
    return null
  }
  return { username: (payload?.sub as string) ?? '' }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(restoreUserFromToken)
  const [isLoading, setIsLoading] = useState(false)

  // Listen for 401s from the axios interceptor
  useEffect(() => {
    function handleUnauthorized() {
      setUser(null)
    }
    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized)
  }, [])

  const login = useCallback(async (data: LoginRequest) => {
    setIsLoading(true)
    try {
      const response = await apiLogin(data)
      setToken(response.access_token)
      const payload = parseJwtPayload(response.access_token)
      const username = (payload?.sub as string) ?? data.username
      setUser({ username })
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, isAuthenticated: !!user, isLoading, login, logout }),
    [user, isLoading, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
