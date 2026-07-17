import { type ReactNode, useState } from "react"
import { Navigate, Route, Routes, useNavigate } from "react-router-dom"
import { LoaderCircle } from "lucide-react"
import { toast } from "sonner"

import AccountOtpVerificationPage from "@/features/auth/account-otp-verification"
import { confirmPasswordReset, verifyPasswordReset } from "@/features/auth/api"
import { AuthSessionProvider, getStatusPath, useAuthSession } from "@/features/auth/auth-session"
import ForgotPasswordPage from "@/features/auth/forgot-password"
import NewPasswordPage from "@/features/auth/new-password"
import OtpVerificationPage from "@/features/auth/otp-verification"
import SignInPage from "@/features/auth/sign-in"
import SignUpPage from "@/features/auth/sign-up"
import DashboardLayout from "@/features/dashboard/dashboard"
import AdminPage from "@/features/dashboard/pages/admin"
import AlertsMapPage from "@/features/dashboard/pages/alerts-map"
import OnboardingPage from "@/features/onboarding/onboarding-page"
import OfficialOnboardingPage from "@/features/onboarding/official-onboarding-page"
import ResponderOnboardingPage from "@/features/onboarding/responder-onboarding-page"
import FeedPage from "@/features/dashboard/pages/feed"
import EmergenciesPage from "@/features/dashboard/pages/emergencies"
import HomePage from "@/features/dashboard/pages/home"
import ProfilePage from "@/features/dashboard/pages/profile"
import ReportsPage from "@/features/dashboard/pages/reports"
import SettingsPage from "@/features/dashboard/pages/settings"
import NotificationsPage from "@/features/dashboard/pages/notifications"
import EmergencyHistoryPage from "@/features/dashboard/pages/emergency-history"
import OcrConfigurationPage from "@/features/ocr/ocr-configuration-page"
import OcrTemplateBuilderPage from "@/features/ocr/ocr-template-builder-page"
import VerificationQueuePage from "@/features/ocr/verification-queue-page"
import ConcernClassificationPage from "@/features/classification/concern-classification-page"
import LandingPage from "@/features/landing/landing-page"
import { getAccessToken } from "@/lib/api"

function ProtectedDashboard() {
  const { loading, user } = useAuthSession()

  if (loading && !user) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/sign-in" replace />
  }

  const canEnterApp = user.status === "verified"
  if (!canEnterApp) {
    return <Navigate to={getStatusPath(user.status)} replace />
  }

  if (!user.is_onboarded) {
    return <Navigate to="/onboarding" replace />
  }

  return <DashboardLayout />
}

function ProtectedOnboarding() {
  const { loading, user } = useAuthSession()

  if (loading && !user) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/sign-in" replace />
  }

  const canEnterApp = user.status === "verified"
  if (!canEnterApp) {
    return <Navigate to={getStatusPath(user.status)} replace />
  }

  if (user.is_onboarded) {
    return <Navigate to="/dashboard" replace />
  }

  const isOfficial = user.role === "barangay_official" || user.is_staff || user.is_superuser
  const isResponder = user.role === "first_responder"
  if (isResponder) return <ResponderOnboardingPage />
  if (isOfficial) return <OfficialOnboardingPage />
  return <OnboardingPage />
}

function DashboardIndex() {
  const { user } = useAuthSession()
  const isOfficial = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser
  const isResponder = user?.role === "first_responder"
  return <Navigate to={isOfficial ? "/dashboard/alerts-map" : isResponder ? "/dashboard/emergencies" : "/dashboard/home"} replace />
}

function ResidentRoute({ children }: { children: ReactNode }) {
  const { user } = useAuthSession()
  return user?.role === "resident" ? children : <Navigate to="/dashboard" replace />
}

function OfficialRoute({ children }: { children: ReactNode }) {
  const { user } = useAuthSession()
  return user?.role === "barangay_official" || user?.is_staff || user?.is_superuser ? children : <Navigate to="/dashboard" replace />
}

function EmergencyOpsRoute({ children }: { children: ReactNode }) {
  const { user } = useAuthSession()
  const allowed = user?.role === "barangay_official" || user?.role === "first_responder" || user?.is_staff || user?.is_superuser
  return allowed ? children : <Navigate to="/dashboard" replace />
}

function AppRoutes() {
  const navigate = useNavigate()
  const { setAuthenticatedUser } = useAuthSession()
  const [resetIdentifier, setResetIdentifier] = useState(() => window.sessionStorage.getItem("eboses-reset-identifier") ?? "")
  const [resetToken, setResetToken] = useState(() => window.sessionStorage.getItem("eboses-reset-token") ?? "")

  return (
    <Routes>
      {/* Landing page at root */}
      <Route path="/" element={<LandingPage />} />

      {/* Dashboard routes */}
      <Route path="/dashboard" element={<ProtectedDashboard />}>
        <Route index element={<DashboardIndex />} />
        <Route path="home" element={<ResidentRoute><HomePage /></ResidentRoute>} />
        <Route path="feed" element={<ResidentRoute><FeedPage /></ResidentRoute>} />
        <Route path="emergencies" element={<EmergencyOpsRoute><EmergenciesPage /></EmergencyOpsRoute>} />
        <Route path="alerts-map" element={<OfficialRoute><AlertsMapPage /></OfficialRoute>} />
        <Route path="admin" element={<OfficialRoute><AdminPage /></OfficialRoute>} />
        <Route path="verification-queue" element={<OfficialRoute><VerificationQueuePage /></OfficialRoute>} />
        <Route path="ocr-templates" element={<OfficialRoute><OcrTemplateBuilderPage /></OfficialRoute>} />
        <Route path="ocr-configuration" element={<OfficialRoute><OcrConfigurationPage /></OfficialRoute>} />
        <Route path="concern-classification" element={<OfficialRoute><ConcernClassificationPage /></OfficialRoute>} />
        <Route path="reports" element={<ResidentRoute><ReportsPage /></ResidentRoute>} />
        <Route path="reports/:reportId" element={<ResidentRoute><ReportsPage /></ResidentRoute>} />
        <Route path="notifications" element={<ResidentRoute><NotificationsPage /></ResidentRoute>} />
        <Route path="emergency-history" element={<ResidentRoute><EmergencyHistoryPage /></ResidentRoute>} />
        <Route path="profile" element={<ResidentRoute><ProfilePage /></ResidentRoute>} />
        <Route path="settings" element={<ResidentRoute><SettingsPage /></ResidentRoute>} />
      </Route>

      {/* Onboarding */}
      <Route path="/onboarding" element={<ProtectedOnboarding />} />

      {/* Legacy account-pending URL → continue into app flow */}
      <Route path="/account-pending" element={<Navigate to="/onboarding" replace />} />

      {/* Auth routes */}
      <Route path="/sign-in" element={
        <SignInPage
          onBack={() => navigate("/")}
          onForgotPassword={() => navigate("/forgot-password")}
          onSignUp={() => navigate("/sign-up")}
          onSuccess={(user, access) => {
            setAuthenticatedUser(user, access)
            navigate(getStatusPath(user.status, { isOnboarded: user.is_onboarded }))
          }}
        />
      } />
      <Route path="/sign-up" element={
        <SignUpPage
          onBack={() => navigate("/")}
          onSignIn={() => navigate("/sign-in")}
          onSuccess={(user, access) => {
            setAuthenticatedUser(user, access)
            navigate(getStatusPath(user.status, { isOnboarded: user.is_onboarded }))
          }}
        />
      } />
      <Route path="/sign-up-otp" element={
        <AccountOtpVerificationPage
          onBack={() => navigate("/sign-up")}
          onSuccess={(user) => {
            const access = getAccessToken()
            if (access) setAuthenticatedUser(user, access)
            navigate(getStatusPath(user.status, { isOnboarded: user.is_onboarded }))
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
          title="Reset password code sent"
          description="If you have an account, we've sent a reset password link to"
          recipientHint={window.sessionStorage.getItem("eboses-reset-identifier") ?? "your email"}
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
              throw new Error("Invalid or expired code. Request a new one.")
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
              throw new Error("Could not reset password. Link may have expired. Try again.")
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
