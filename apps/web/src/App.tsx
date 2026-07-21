import { type ReactNode, useState } from "react"
import { Navigate, Route, Routes, useNavigate } from "react-router-dom"
import { LoaderCircle } from "lucide-react"
import { toast } from "sonner"

import AccountInactivePage from "@/features/auth/account-inactive"
import AccountOtpVerificationPage from "@/features/auth/account-otp-verification"
import { confirmPasswordReset, verifyPasswordReset } from "@/features/auth/api"
import { AuthSessionProvider, getStatusPath, useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import ForgotPasswordPage from "@/features/auth/forgot-password"
import NewPasswordPage from "@/features/auth/new-password"
import OtpVerificationPage from "@/features/auth/otp-verification"
import SignInPage from "@/features/auth/sign-in"
import SignUpPage from "@/features/auth/sign-up"
import DashboardLayout from "@/features/dashboard/dashboard"
import AlertsMapPage from "@/features/dashboard/pages/alerts-map"
import ResidentAlertsMapPage from "@/features/dashboard/pages/resident-alerts-map"
import OnboardingPage from "@/features/onboarding/onboarding-page"
import OfficialOnboardingPage from "@/features/onboarding/official-onboarding-page"
import ResponderOnboardingPage from "@/features/onboarding/responder-onboarding-page"
import FeedPage from "@/features/dashboard/pages/feed"
import EmergenciesPage from "@/features/dashboard/pages/emergencies"
import HomePage from "@/features/dashboard/pages/home"
import ProfilePage from "@/features/dashboard/pages/profile"
import ResponderMapPage from "@/features/dashboard/pages/responder-map"
import ResponderProfilePage from "@/features/dashboard/pages/responder-profile"
import ResponderShiftPage from "@/features/dashboard/pages/responder-shift"
import ReportsPage from "@/features/dashboard/pages/reports"
import SettingsPage from "@/features/dashboard/pages/settings"
import ChangePasswordPage from "@/features/dashboard/pages/change-password"
import AccountReverifyNamePage from "@/features/dashboard/pages/account-reverify-name"
import AccountReverifyPhonePage from "@/features/dashboard/pages/account-reverify-phone"
import AccountReverifyEmailPage from "@/features/dashboard/pages/account-reverify-email"
import NotificationsPage from "@/features/dashboard/pages/notifications"
import EmergencyHistoryPage from "@/features/dashboard/pages/emergency-history"
import OfficialIdProofWorkspacePage from "@/features/dashboard/pages/official-id-proof-workspace"
import OcrConfigurationPage from "@/features/ocr/ocr-configuration-page"
import ConcernClassificationPage from "@/features/classification/concern-classification-page"
import OfficialUsersPage from "@/features/dashboard/pages/official-users-page"
import OfficialCommunityContentPage from "@/features/dashboard/pages/official-community-content-page"
import OfficialMapDispatchPolicyPage from "@/features/dashboard/pages/official-map-dispatch-policy-page"
import OfficialPrivacyRequestsPage from "@/features/dashboard/pages/official-privacy-requests-page"
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

  const isResponder = isResponderUser(user)
  const isOfficial = isOfficialUser(user)
  if (isResponder) return <ResponderOnboardingPage />
  if (isOfficial) return <OfficialOnboardingPage />
  return <OnboardingPage />
}

function DashboardIndex() {
  const { user } = useAuthSession()
  const isResponder = isResponderUser(user)
  const isOfficial = isOfficialUser(user)
  return <Navigate to={isResponder ? "/dashboard/responders/map" : isOfficial ? "/dashboard/alerts-map" : "/dashboard/home"} replace />
}

function ResidentRoute({ children }: { children: ReactNode }) {
  const { user } = useAuthSession()
  return user?.role === "resident" ? children : <Navigate to="/dashboard" replace />
}

function OfficialRoute({ children }: { children: ReactNode }) {
  const { user } = useAuthSession()
  return isOfficialUser(user) ? children : <Navigate to="/dashboard" replace />
}

function ResponderRoute({ children }: { children: ReactNode }) {
  const { user } = useAuthSession()
  return isResponderUser(user) ? children : <Navigate to="/dashboard" replace />
}

function StaffProfileRoute({ children }: { children: ReactNode }) {
  const { user } = useAuthSession()
  const allowed =
    user?.role === "resident" ||
    user?.role === "barangay_official" ||
    user?.role === "first_responder" ||
    user?.is_staff ||
    user?.is_superuser
  return allowed ? children : <Navigate to="/dashboard" replace />
}

function ConcernWorkspaceRoute() {
  const { user } = useAuthSession()
  const allowed = user?.role === "resident" || isOfficialUser(user)
  return allowed ? <ReportsPage /> : <Navigate to="/dashboard" replace />
}

function AlertsMapRoute() {
  const { user, loading } = useAuthSession()
  // Wait for session so we never bounce residents away while user is still null.
  if (loading && !user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!user) return <Navigate to="/sign-in" replace />
  if (isResponderUser(user)) return <Navigate to="/dashboard/responders/map" replace />
  const isOfficial = isOfficialUser(user)
  if (isOfficial) return <AlertsMapPage />
  // Only residents get the public alerts map; responders own a separate operational map.
  return <ResidentAlertsMapPage />
}

function EmergencyOpsRoute({ children }: { children: ReactNode }) {
  const { user } = useAuthSession()
  if (isOfficialUser(user)) return children
  if (isResponderUser(user)) return <Navigate to="/dashboard/responders/map" replace />
  return <Navigate to="/dashboard" replace />
}

function AccountInactiveGate() {
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

  if (user.status !== "suspended") {
    return (
      <Navigate
        to={getStatusPath(user.status, { isOnboarded: user.is_onboarded })}
        replace
      />
    )
  }

  return <AccountInactivePage />
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
        <Route path="alerts-map" element={<AlertsMapRoute />} />
        <Route path="admin" element={<OfficialRoute><Navigate to="/dashboard/configuration/users" replace /></OfficialRoute>} />
        <Route path="verification-queue" element={<OfficialRoute><Navigate to="/dashboard/configuration/id-proof-template?tab=queue" replace /></OfficialRoute>} />
        <Route path="ocr-templates" element={<OfficialRoute><Navigate to="/dashboard/configuration/id-proof-template?tab=templates" replace /></OfficialRoute>} />
        <Route path="ocr-configuration" element={<OfficialRoute><OcrConfigurationPage /></OfficialRoute>} />
        <Route path="concern-classification" element={<OfficialRoute><Navigate to="/dashboard/configuration/classification" replace /></OfficialRoute>} />
        <Route path="configuration" element={<OfficialRoute><Navigate to="/dashboard/configuration/id-proof-template" replace /></OfficialRoute>} />
        <Route path="configuration/id-proof-template" element={<OfficialRoute><OfficialIdProofWorkspacePage /></OfficialRoute>} />
        <Route path="configuration/classification" element={<OfficialRoute><ConcernClassificationPage /></OfficialRoute>} />
        <Route path="configuration/map-dispatch" element={<OfficialRoute><OfficialMapDispatchPolicyPage /></OfficialRoute>} />
        <Route path="configuration/users" element={<OfficialRoute><OfficialUsersPage /></OfficialRoute>} />
        <Route path="configuration/privacy-requests" element={<OfficialRoute><OfficialPrivacyRequestsPage /></OfficialRoute>} />
        <Route path="community-content" element={<OfficialRoute><OfficialCommunityContentPage /></OfficialRoute>} />
        <Route path="responders" element={<ResponderRoute><Navigate to="/dashboard/responders/map" replace /></ResponderRoute>} />
        <Route path="responders/dispatch" element={<ResponderRoute><Navigate to="/dashboard/responders/map" replace /></ResponderRoute>} />
        <Route path="responders/map" element={<ResponderRoute><ResponderMapPage /></ResponderRoute>} />
        <Route path="responders/shift" element={<ResponderRoute><ResponderShiftPage /></ResponderRoute>} />
        <Route path="responders/profile" element={<ResponderRoute><ResponderProfilePage /></ResponderRoute>} />
        <Route path="reports" element={<ConcernWorkspaceRoute />} />
        <Route path="reports/:reportId" element={<ConcernWorkspaceRoute />} />
        <Route path="notifications" element={<StaffProfileRoute><NotificationsPage /></StaffProfileRoute>} />
        <Route path="emergency-history" element={<ResidentRoute><EmergencyHistoryPage /></ResidentRoute>} />
        <Route path="profile" element={<StaffProfileRoute><ProfilePage /></StaffProfileRoute>} />
        <Route path="settings" element={<ResidentRoute><SettingsPage /></ResidentRoute>} />
        <Route path="settings/change-password" element={<ResidentRoute><ChangePasswordPage /></ResidentRoute>} />
        <Route path="settings/reverify/name" element={<ResidentRoute><AccountReverifyNamePage /></ResidentRoute>} />
        <Route path="settings/reverify/phone" element={<ResidentRoute><AccountReverifyPhonePage /></ResidentRoute>} />
        <Route path="settings/reverify/email" element={<ResidentRoute><AccountReverifyEmailPage /></ResidentRoute>} />
      </Route>

      {/* Onboarding */}
      <Route path="/onboarding" element={<ProtectedOnboarding />} />

      {/* Legacy account-pending URL → continue into app flow */}
      <Route path="/account-pending" element={<Navigate to="/onboarding" replace />} />

      {/* Self-deactivated / suspended — reactivate */}
      <Route path="/account-inactive" element={<AccountInactiveGate />} />

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
