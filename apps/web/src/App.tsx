import { Navigate, Route, Routes, useNavigate } from "react-router-dom"
import { toast } from "sonner"


import ForgotPasswordPage from "@/features/auth/forgot-password"
import NewPasswordPage from "@/features/auth/new-password"
import OtpVerificationPage from "@/features/auth/otp-verification"
import SignInPage from "@/features/auth/sign-in"
import SignUpPage from "@/features/auth/sign-up"
import DashboardLayout from "@/features/dashboard/dashboard"
import FeedPage from "@/features/dashboard/pages/feed"
import HomePage from "@/features/dashboard/pages/home"
import OfficialsLayout from "@/features/officials/officials-layout"
import AlertsPage from "@/features/officials/pages/alerts"
import AnalyticsPage from "@/features/officials/pages/analytics"
import ConcernsPage from "@/features/officials/pages/concerns"
import OfficialsProfilePage from "@/features/officials/pages/profile"
import OverviewPage from "@/features/officials/pages/overview"
import ProfilePage from "@/features/dashboard/pages/profile"
import ReportsPage from "@/features/dashboard/pages/reports"
import SettingsPage from "@/features/dashboard/pages/settings"

function AuthRoutes() {
  const navigate = useNavigate()

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/sign-in" replace />} />
      <Route
        path="/sign-in"
        element={
          <SignInPage
            onForgotPassword={() => navigate("/forgot-password")}
            onSignUp={() => navigate("/sign-up")}
            onSuccess={() => navigate("/dashboard")}
          />
        }
      />
      <Route
        path="/sign-up"
        element={
          <SignUpPage
            onSignIn={() => navigate("/sign-in")}
            onSuccess={() => navigate("/sign-up-otp")}
          />
        }
      />
      <Route
        path="/sign-up-otp"
        element={
          <OtpVerificationPage
            title="Verify your account"
            description="Enter the 6-digit verification code we sent to your email."
            recipientHint=""
            actionLabel="Verify code"
            resendStorageKey="eboses-sign-up-otp-resend-expiry"
            onBack={() => navigate("/sign-up")}
            onSuccess={() => navigate("/dashboard")}
          />
        }
      />
      <Route
        path="/forgot-password"
        element={
          <ForgotPasswordPage
            onBack={() => navigate("/sign-in")}
            onSuccess={() => navigate("/forgot-password-otp")}
          />
        }
      />
      <Route
        path="/forgot-password-otp"
        element={
          <OtpVerificationPage
            title="Verify your reset request"
            description="Enter the 6-digit code we sent to your email."
            recipientHint=""
            actionLabel="Continue"
            resendStorageKey="eboses-forgot-password-otp-resend-expiry"
            onBack={() => navigate("/forgot-password")}
            onSuccess={() => navigate("/new-password")}
          />
        }
      />
      <Route
        path="/new-password"
        element={
          <NewPasswordPage
            onBack={() => navigate("/sign-in")}
            onSuccess={() => {
              navigate("/sign-in")
              toast.success("Password changed", {
                description: "Your password has been updated successfully.",
              })
            }}
          />
        }
      />
    </Routes>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/dashboard" element={<DashboardLayout />}>
        <Route index element={<Navigate to="/dashboard/home" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="feed" element={<FeedPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="/officials" element={<OfficialsLayout />}>
        <Route index element={<Navigate to="/officials/dashboard" replace />} />
        <Route path="dashboard" element={<OverviewPage />} />
        <Route path="concerns" element={<ConcernsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="profile" element={<OfficialsProfilePage />} />
      </Route>
      <Route path="*" element={<AuthRoutes />} />
    </Routes>
  )
}
