/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect */
import * as React from "react"

import { getMe, type AuthUser, type UserStatus } from "@/features/auth/api"
import { clearAuthTokens, getAccessToken, setAuthTokens } from "@/lib/api"

interface AuthSessionContextValue {
  user: AuthUser | null
  loading: boolean
  setAuthenticatedUser: (user: AuthUser, access: string, refresh: string) => void
  refreshUser: () => Promise<AuthUser | null>
  signOut: () => void
}

const AuthSessionContext = React.createContext<AuthSessionContextValue | null>(null)

export function getStatusPath(status: UserStatus) {
  if (status === "pending_otp") return "/sign-up-otp"
  if (status === "pending_profile") return "/sign-up"
  if (status === "pending_verification") return "/account-pending"
  if (status === "rejected" || status === "suspended") return "/sign-in"
  return "/dashboard"
}

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null)
  const [loading, setLoading] = React.useState(() => Boolean(getAccessToken()))

  const refreshUser = React.useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null)
      setLoading(false)
      return null
    }

    try {
      const nextUser = await getMe()
      setUser(nextUser)
      return nextUser
    } catch {
      clearAuthTokens()
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refreshUser()
  }, [refreshUser])

  const setAuthenticatedUser = React.useCallback((nextUser: AuthUser, access: string, refresh: string) => {
    setAuthTokens(access, refresh)
    setUser(nextUser)
    setLoading(false)
  }, [])

  const signOut = React.useCallback(() => {
    clearAuthTokens()
    setUser(null)
    setLoading(false)
  }, [])

  return (
    <AuthSessionContext.Provider value={{ user, loading, setAuthenticatedUser, refreshUser, signOut }}>
      {children}
    </AuthSessionContext.Provider>
  )
}

export function useAuthSession() {
  const context = React.useContext(AuthSessionContext)
  if (!context) {
    throw new Error("useAuthSession must be used inside AuthSessionProvider.")
  }
  return context
}
