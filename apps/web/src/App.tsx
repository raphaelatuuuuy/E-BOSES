import { useState } from "react"

import ForgotPasswordPage from "@/features/auth/forgot-password"
import OtpVerificationPage from "@/features/auth/otp-verification"
import SignInPage from "@/features/auth/sign-in"
import SignUpPage from "@/features/auth/sign-up"

type Page =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "sign-up-otp"
  | "forgot-password-otp"

function App() {
  const [page, setPage] = useState<Page>("sign-in")

  switch (page) {
    case "sign-up":
      return (
        <SignUpPage
          onSignIn={() => setPage("sign-in")}
          onSuccess={() => {
            setPage("sign-up-otp")
          }}
        />
      )
    case "forgot-password":
      return (
        <ForgotPasswordPage
          onBack={() => setPage("sign-in")}
          onSuccess={() => {
            setPage("forgot-password-otp")
          }}
        />
      )
    case "sign-up-otp":
      return (
        <OtpVerificationPage
          title="Verify your account"
          description="Enter the 6-digit verification code we sent to"
          recipientHint="your phone"
          actionLabel="Verify code"
          resendStorageKey="eboses-sign-up-otp-resend-expiry"
          onBack={() => setPage("sign-up")}
        />
      )
    case "forgot-password-otp":
      return (
        <OtpVerificationPage
          title="Verify your reset request"
          description="Enter the 6-digit code we sent to"
          recipientHint="your email"
          actionLabel="Continue"
          resendStorageKey="eboses-forgot-password-otp-resend-expiry"
          onBack={() => setPage("forgot-password")}
        />
      )
    case "sign-in":
    default:
      return (
        <SignInPage
          onSignUp={() => setPage("sign-up")}
          onForgotPassword={() => setPage("forgot-password")}
        />
      )
  }
}

export default App
