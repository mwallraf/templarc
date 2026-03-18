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
  orgRole: string
  isPlatformAdmin: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  isOrgAdmin: boolean
  isPlatformAdmin: boolean
  orgRole: string
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

function extractRoleFromPayload(payload: Record<string, unknown>): { orgRole: string; isPlatformAdmin: boolean } {
  // Handle both new tokens (org_role) and old tokens (is_admin boolean)
  if (payload.org_role) {
    return {
      orgRole: payload.org_role as string,
      isPlatformAdmin: Boolean(payload.is_platform_admin),
    }
  }
  // backward-compat: old JWT had is_admin boolean
  return {
    orgRole: payload.is_admin ? 'org_admin' : 'member',
    isPlatformAdmin: false,
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
  const { orgRole, isPlatformAdmin } = extractRoleFromPayload(payload ?? {})
  return { username: (payload?.sub as string) ?? '', orgRole, isPlatformAdmin }
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
      const { orgRole, isPlatformAdmin } = extractRoleFromPayload(payload ?? {})
      setUser({ username, orgRole, isPlatformAdmin })
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isOrgAdmin: user?.isPlatformAdmin || user?.orgRole === 'org_owner' || user?.orgRole === 'org_admin' || false,
      isPlatformAdmin: user?.isPlatformAdmin ?? false,
      orgRole: user?.orgRole ?? 'member',
      isLoading,
      login,
      logout,
    }),
    [user, isLoading, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
