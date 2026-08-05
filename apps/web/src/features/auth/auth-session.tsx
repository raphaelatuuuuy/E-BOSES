/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect */
import * as React from "react"

import { getMe, type AuthUser, type UserStatus } from "@/features/auth/api"
import { ApiError, clearAuthTokens, getAccessToken, logoutSession, refreshSession, setAuthTokens } from "@/lib/api"

interface AuthSessionContextValue {
  user: AuthUser | null
  loading: boolean
  setAuthenticatedUser: (user: AuthUser, access: string) => void
  refreshUser: () => Promise<AuthUser | null>
  signOut: () => Promise<void>
}

const AuthSessionContext = React.createContext<AuthSessionContextValue | null>(null)

export function getStatusPath(status: UserStatus, options?: { isOnboarded?: boolean }) {
  if (status === "pending_otp") return "/sign-up-otp"
  if (status === "pending_profile") return "/sign-up"
  if (status === "rejected") return "/sign-in"
  // Self-deactivated / suspended accounts land on reactivate screen (not hard-blocked at login).
  if (status === "suspended") return "/account-inactive"
  // Verification is still in progress — the resident waits on the approval screen
  // until an official decides the case. ProtectedOnboarding/Dashboard only admit
  // verified users, so sending pending_verification there would redirect-loop.
  if (status === "pending_verification") return "/account-pending"
  // Verified users finish onboarding once, then enter the dashboard.
  if (status === "verified" && options?.isOnboarded === false) return "/onboarding"
  return "/dashboard"
}

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null)
  const [loading, setLoading] = React.useState(true)
  const userRef = React.useRef<AuthUser | null>(null)

  React.useEffect(() => {
    userRef.current = user
  }, [user])

  const clearSession = React.useCallback(() => {
    clearAuthTokens()
    setUser(null)
  }, [])

  const refreshUser = React.useCallback(async () => {
    const showBlockingLoader = !userRef.current
    if (showBlockingLoader) {
      setLoading(true)
    }
    try {
      if (!getAccessToken()) {
        const session = await refreshSession()
        if (session) {
          setUser(session.user as AuthUser)
          return session.user as AuthUser
        }
        return null
      }

      const nextUser = await getMe()
      setUser(nextUser)
      return nextUser
    } catch (error) {
      // 5xx / network errors — transient, don't wipe the session
      if (error instanceof ApiError && error.status >= 500) {
        return null
      }
      clearSession()
      return null
    } finally {
      setLoading(false)
    }
  }, [clearSession])

  React.useEffect(() => {
    void refreshUser()
  }, [refreshUser])

  const setAuthenticatedUser = React.useCallback((nextUser: AuthUser, access: string) => {
    setAuthTokens(access)
    setUser(nextUser)
    setLoading(false)
  }, [])

  const signOut = React.useCallback(async () => {
    setLoading(true)
    try {
      await logoutSession()
    } finally {
      clearSession()
      setLoading(false)
    }
  }, [clearSession])

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
