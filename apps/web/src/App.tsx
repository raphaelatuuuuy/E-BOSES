import { lazy, Suspense, type ReactNode, useState } from "react"
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { LoaderCircle } from "lucide-react"
import { toast } from "sonner"

import { confirmPasswordReset, requestPasswordReset, verifyPasswordReset } from "@/features/auth/api"
import { AuthSessionProvider, getStatusPath, useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import DashboardLayout from "@/features/dashboard/dashboard"
import { getAccessToken } from "@/lib/api"
import { SystemStatusProvider, SystemTicker, useSystemStatus } from "@/features/dashboard/components/system-banner"
import { MaintenancePage } from "@/features/dashboard/pages/maintenance"

const AccountInactivePage = lazy(() => import("@/features/auth/account-inactive"))
const AccountPendingPage = lazy(() => import("@/features/auth/account-pending"))
const AccountOtpVerificationPage = lazy(() => import("@/features/auth/account-otp-verification"))
const ForgotPasswordPage = lazy(() => import("@/features/auth/forgot-password"))
const NewPasswordPage = lazy(() => import("@/features/auth/new-password"))
const OtpVerificationPage = lazy(() => import("@/features/auth/otp-verification"))
const SignInPage = lazy(() => import("@/features/auth/sign-in"))
const SignUpPage = lazy(() => import("@/features/auth/sign-up"))
const AlertsMapPage = lazy(() => import("@/features/dashboard/pages/alerts-map"))
const ResidentAlertsMapPage = lazy(() => import("@/features/dashboard/pages/resident-alerts-map"))
const OnboardingPage = lazy(() => import("@/features/onboarding/onboarding-page"))
const OfficialOnboardingPage = lazy(() => import("@/features/onboarding/official-onboarding-page"))
const ResponderOnboardingPage = lazy(() => import("@/features/onboarding/responder-onboarding-page"))
const EmergenciesPage = lazy(() => import("@/features/dashboard/pages/emergencies"))
const HomePage = lazy(() => import("@/features/dashboard/pages/home"))
const OfficialOverviewPage = lazy(() => import("@/features/dashboard/pages/official-overview"))
const ProfilePage = lazy(() => import("@/features/dashboard/pages/profile"))
const ResponderDispatchPage = lazy(() => import("@/features/dashboard/pages/responder-dispatch"))
const ResponderProfilePage = lazy(() => import("@/features/dashboard/pages/responder-profile"))
const ResponderShiftPage = lazy(() => import("@/features/dashboard/pages/responder-shift"))
const ReportsPage = lazy(() => import("@/features/dashboard/pages/reports"))
const NotificationsPage = lazy(() => import("@/features/dashboard/pages/notifications"))
const EmergencyHistoryPage = lazy(() => import("@/features/dashboard/pages/emergency-history"))
const OfficialIdProofWorkspacePage = lazy(() => import("@/features/dashboard/pages/official-id-proof-workspace"))
const ConcernClassificationPage = lazy(() => import("@/features/classification/concern-classification-page"))
const OfficialConfigurationHubPage = lazy(() => import("@/features/dashboard/pages/official-configuration-hub"))
const OfficialAuditLogPage = lazy(() => import("@/features/dashboard/pages/official-audit-log-page"))
const OfficialUnitsPage = lazy(() => import("@/features/dashboard/pages/official-units-page"))
const OfficialRolesPage = lazy(() => import("@/features/dashboard/pages/official-roles-page"))
const NotFoundPage = lazy(() => import("@/features/dashboard/pages/not-found"))
const OfficialUsersManagePage = lazy(() => import("@/features/dashboard/pages/official-users-manage-page"))
const OfficialCategoriesPage = lazy(() => import("@/features/dashboard/pages/official-categories-page"))
const OfficialDispatchRulesPage = lazy(() => import("@/features/dashboard/pages/official-dispatch-rules-page"))
const OfficialCoverageAreaPage = lazy(() => import("@/features/dashboard/pages/official-coverage-area-page"))
const OfficialCommunityContentPage = lazy(() => import("@/features/dashboard/pages/official-community-content-page"))
const LandingPage = lazy(() => import("@/features/landing/landing-page"))
const HelpPage = lazy(() => import("@/features/help/help-page"))
const HelpCollectionPage = lazy(() => import("@/features/help/help-collection-page"))
const HelpArticlePage = lazy(() => import("@/features/help/help-article-page"))
const ActiveCommunitiesPage = lazy(() => import("@/features/communities/active-communities-page"))
const CreateCommunityPage = lazy(() => import("@/features/landing/pages/create-community-page"))
const BookDemoPage = lazy(() => import("@/features/landing/pages/book-demo-page"))
const AssistantWidget = lazy(() => import("@/features/assistant/assistant-widget"))

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
  return <Navigate to={isResponder ? "/dashboard/responders/dispatch" : isOfficial ? "/dashboard/overview" : "/dashboard/home"} replace />
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
  if (isResponderUser(user)) return <Navigate to="/dashboard/responders/dispatch" replace />
  const isOfficial = isOfficialUser(user)
  if (isOfficial) return <AlertsMapPage />
  // Only residents get the public alerts map; responders own a separate operational map.
  return <ResidentAlertsMapPage />
}

function EmergencyOpsRoute({ children }: { children: ReactNode }) {
  const { user } = useAuthSession()
  if (isOfficialUser(user)) return children
  if (isResponderUser(user)) return <Navigate to="/dashboard/responders/dispatch" replace />
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

function AccountPendingGate() {
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

  if (user.status !== "pending_verification") {
    return (
      <Navigate
        to={getStatusPath(user.status, { isOnboarded: user.is_onboarded })}
        replace
      />
    )
  }

  return <AccountPendingPage />
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
        <Route path="overview" element={<OfficialRoute><OfficialOverviewPage /></OfficialRoute>} />
        <Route path="emergencies" element={<EmergencyOpsRoute><EmergenciesPage /></EmergencyOpsRoute>} />
        <Route path="alerts-map" element={<AlertsMapRoute />} />
        <Route path="admin" element={<OfficialRoute><Navigate to="/dashboard/configuration/users" replace /></OfficialRoute>} />
        <Route path="configuration/verification" element={<OfficialRoute><Navigate to="/dashboard/configuration/id-proof-template" replace /></OfficialRoute>} />
        <Route path="configuration/zones" element={<OfficialRoute><Navigate to="/dashboard/configuration" replace /></OfficialRoute>} />
        <Route path="configuration/privacy" element={<OfficialRoute><Navigate to="/dashboard/configuration/audit-log" replace /></OfficialRoute>} />
        <Route path="verification-queue" element={<OfficialRoute><Navigate to="/dashboard/configuration/id-proof-template" replace /></OfficialRoute>} />
        <Route path="ocr-templates" element={<OfficialRoute><Navigate to="/dashboard/configuration/id-proof-template" replace /></OfficialRoute>} />
        <Route path="concern-classification" element={<OfficialRoute><Navigate to="/dashboard/configuration/classification" replace /></OfficialRoute>} />
        <Route path="configuration" element={<OfficialRoute><OfficialConfigurationHubPage /></OfficialRoute>} />
        <Route path="configuration/units" element={<OfficialRoute><OfficialUnitsPage /></OfficialRoute>} />
        <Route path="configuration/roles" element={<OfficialRoute><OfficialRolesPage /></OfficialRoute>} />
        <Route path="configuration/categories" element={<OfficialRoute><OfficialCategoriesPage /></OfficialRoute>} />
        <Route path="configuration/routing" element={<OfficialRoute><Navigate to="/dashboard/configuration/categories" replace /></OfficialRoute>} />
        <Route path="configuration/dispatch" element={<OfficialRoute><OfficialDispatchRulesPage /></OfficialRoute>} />
        <Route path="configuration/coverage" element={<OfficialRoute><OfficialCoverageAreaPage /></OfficialRoute>} />
        <Route path="configuration/id-proof-template" element={<OfficialRoute><OfficialIdProofWorkspacePage /></OfficialRoute>} />
        <Route path="configuration/classification" element={<OfficialRoute><ConcernClassificationPage /></OfficialRoute>} />
        <Route path="configuration/users" element={<OfficialRoute><OfficialUsersManagePage /></OfficialRoute>} />
        <Route path="configuration/audit-log" element={<OfficialRoute><OfficialAuditLogPage /></OfficialRoute>} />
        <Route path="configuration/privacy-requests" element={<OfficialRoute><Navigate to="/dashboard/configuration/audit-log" replace /></OfficialRoute>} />
        <Route path="community-content" element={<OfficialRoute><OfficialCommunityContentPage /></OfficialRoute>} />
        <Route path="responders" element={<ResponderRoute><Navigate to="/dashboard/responders/dispatch" replace /></ResponderRoute>} />
        <Route path="responders/dispatch" element={<ResponderRoute><ResponderDispatchPage /></ResponderRoute>} />
        <Route path="responders/map" element={<Navigate to="/dashboard/responders/dispatch" replace />} />
        <Route path="responders/shift" element={<ResponderRoute><ResponderShiftPage /></ResponderRoute>} />
        <Route path="responders/profile" element={<ResponderRoute><ResponderProfilePage /></ResponderRoute>} />
        <Route path="reports" element={<ConcernWorkspaceRoute />} />
        <Route path="reports/:reportId" element={<ConcernWorkspaceRoute />} />
        <Route path="notifications" element={<StaffProfileRoute><NotificationsPage /></StaffProfileRoute>} />
        <Route path="emergency-history" element={<ResidentRoute><EmergencyHistoryPage /></ResidentRoute>} />
        <Route path="profile" element={<StaffProfileRoute><ProfilePage /></StaffProfileRoute>} />
        <Route path="settings" element={<Navigate to="/dashboard" replace />} />
      </Route>

      {/* Onboarding */}
      <Route path="/onboarding" element={<ProtectedOnboarding />} />

      {/* Verification pending — waiting-for-approval screen */}
      <Route path="/account-pending" element={<AccountPendingGate />} />

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
          onResend={async () => {
            const identifier = resetIdentifier || window.sessionStorage.getItem("eboses-reset-identifier") || ""
            if (!identifier) {
              throw new Error("Go back and enter your email before requesting another code.")
            }
            await requestPasswordReset({ identifier, channel: "email" })
          }}
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

      <Route path="/privacy" element={<Navigate to="/help/a/privacy-policy" replace />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/help/c/:collectionSlug" element={<HelpCollectionPage />} />
      <Route path="/help/a/:articleSlug" element={<HelpArticlePage />} />
      <Route path="/communities" element={<ActiveCommunitiesPage />} />
      <Route path="/create-community" element={<CreateCommunityPage />} />
      <Route path="/book-demo" element={<BookDemoPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

const ASSISTANT_PATHS = [
  "/",
  "/sign-in",
  "/sign-up",
  "/sign-up-otp",
  "/forgot-password",
  "/forgot-password-otp",
  "/new-password",
  "/communities",
  "/create-community",
  "/book-demo",
]

function AssistantMount() {
  const { pathname } = useLocation()
  const enabled = ASSISTANT_PATHS.includes(pathname) || pathname.startsWith("/help")
  if (!enabled) return null
  return (
    <Suspense fallback={null}>
      <AssistantWidget onDark={pathname === "/"} />
    </Suspense>
  )
}

function PageLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
    </div>
  )
}

/**
 * Maintenance locks residents out but never officials, and never the landing
 * page: someone arriving mid-window still needs to see the hotlines.
 */
function MaintenanceGate({ children }: { children: ReactNode }) {
  const { status } = useSystemStatus()
  const { user } = useAuthSession()
  const location = useLocation()

  const staff = user?.role === "barangay_official"
  const exempt =
    location.pathname === "/" ||
    location.pathname.startsWith("/help") ||
    location.pathname === "/communities" ||
    location.pathname === "/create-community" ||
    location.pathname === "/book-demo"

  if (status?.maintenance && !staff && !exempt) {
    return <MaintenancePage />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <AuthSessionProvider>
      <SystemStatusProvider>
        <SystemTicker />
        <MaintenanceGate>
          <Suspense fallback={<PageLoader />}>
            <AppRoutes />
          </Suspense>
        </MaintenanceGate>
        <AssistantMount />
      </SystemStatusProvider>
    </AuthSessionProvider>
  )
}
