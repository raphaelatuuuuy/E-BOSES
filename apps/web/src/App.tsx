import { useState } from "react"
import { Navigate, Route, Routes, useNavigate } from "react-router-dom"
import { LoaderCircle } from "lucide-react"
import { toast } from "sonner"

import AccountOtpVerificationPage from "@/features/auth/account-otp-verification"
import AccountPendingPage from "@/features/auth/account-pending"
import { confirmPasswordReset, verifyPasswordReset } from "@/features/auth/api"
import { AuthSessionProvider, getStatusPath, useAuthSession } from "@/features/auth/auth-session"
import ForgotPasswordPage from "@/features/auth/forgot-password"
import NewPasswordPage from "@/features/auth/new-password"
import OtpVerificationPage from "@/features/auth/otp-verification"
import SignInPage from "@/features/auth/sign-in"
import SignUpPage from "@/features/auth/sign-up"
import DashboardLayout from "@/features/dashboard/dashboard"
import FeedPage from "@/features/dashboard/pages/feed"
import HomePage from "@/features/dashboard/pages/home"
import ProfilePage from "@/features/dashboard/pages/profile"
import ReportsPage from "@/features/dashboard/pages/reports"
import SettingsPage from "@/features/dashboard/pages/settings"
import LandingPage from "@/features/landing/landing-page"

function ProtectedDashboard() {
  const { loading, user } = useAuthSession()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/sign-in" replace />
  }

  if (user.status !== "verified") {
    return <Navigate to={getStatusPath(user.status)} replace />
  }

  return <DashboardLayout />
}

function ProtectedPending() {
  const { loading, user } = useAuthSession()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/sign-in" replace />
  }

  if (user.status === "verified") {
    return <Navigate to="/dashboard" replace />
  }

  // Redirect non-pending-verification users to their appropriate path
  if (user.status !== "pending_verification") {
    return <Navigate to={getStatusPath(user.status)} replace />
  }

  return <AccountPendingPage />
}

function AppRoutes() {
  const navigate = useNavigate()
  const { refreshUser, setAuthenticatedUser } = useAuthSession()
  const [resetIdentifier, setResetIdentifier] = useState(() => window.sessionStorage.getItem("eboses-reset-identifier") ?? "")
  const [resetToken, setResetToken] = useState(() => window.sessionStorage.getItem("eboses-reset-token") ?? "")

  return (
    <Routes>
      {/* Landing page at root */}
      <Route path="/" element={<LandingPage />} />

      {/* Dashboard routes */}
      <Route path="/dashboard" element={<ProtectedDashboard />}>
        <Route index element={<Navigate to="/dashboard/home" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="feed" element={<FeedPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      {/* Account pending page */}
      <Route path="/account-pending" element={<ProtectedPending />} />

      {/* Auth routes */}
      <Route path="/sign-in" element={
        <SignInPage
          onBack={() => navigate("/")}
          onForgotPassword={() => navigate("/forgot-password")}
          onSignUp={() => navigate("/sign-up")}
          onSuccess={(user, access) => {
            setAuthenticatedUser(user, access)
            navigate(getStatusPath(user.status))
          }}
        />
      } />
      <Route path="/sign-up" element={
        <SignUpPage
          onBack={() => navigate("/")}
          onSignIn={() => navigate("/sign-in")}
          onSuccess={(user, access) => {
            setAuthenticatedUser(user, access)
            navigate(getStatusPath(user.status))
          }}
        />
      } />
      <Route path="/sign-up-otp" element={
        <AccountOtpVerificationPage
          onBack={() => navigate("/sign-up")}
          onSuccess={async () => {
            const user = await refreshUser()
            navigate(getStatusPath(user?.status ?? "verified"))
          }}
        />
      } />
      <Route path="/forgot-password" element={
        <ForgotPasswordPage
          onBack={() => navigate("/sign-in")}
          onSuccess={(email) => {
            setResetIdentifier(email)
            window.sessionStorage.setItem("eboses-reset-identifier", email)
            navigate("/forgot-password-otp")
          }}
        />
      } />
      <Route path="/forgot-password-otp" element={
        <OtpVerificationPage
          title="Verify your reset request"
          description="Enter the 6-digit code we sent to your email."
          recipientHint=""
          actionLabel="Continue"
          resendStorageKey="eboses-forgot-password-otp-resend-expiry"
          onBack={() => navigate("/forgot-password")}
          onSuccess={async (code) => {
            try {
              const response = await verifyPasswordReset({
                identifier: resetIdentifier || window.sessionStorage.getItem("eboses-reset-identifier") || "",
                channel: "email",
                code,
              })
              setResetToken(response.reset_token)
              window.sessionStorage.setItem("eboses-reset-token", response.reset_token)
              navigate("/new-password")
            } catch {
              toast.error("Invalid or expired reset code. Request a new one.")
            }
          }}
        />
      } />
      <Route path="/new-password" element={
        <NewPasswordPage
          onBack={() => navigate("/sign-in")}
          onSuccess={async (password) => {
            try {
              await confirmPasswordReset({ reset_token: resetToken || window.sessionStorage.getItem("eboses-reset-token") || "", password })
              window.sessionStorage.removeItem("eboses-reset-token")
              window.sessionStorage.removeItem("eboses-reset-identifier")
              navigate("/sign-in")
              toast.success("Password changed", {
                description: "Your password has been updated successfully.",
              })
            } catch {
              toast.error("Could not reset password. Link may have expired. Try again.")
            }
          }}
        />
      } />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthSessionProvider>
      <AppRoutes />
    </AuthSessionProvider>
  )
}
