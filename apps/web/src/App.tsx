import { useState } from "react"

import ForgotPasswordPage from "@/features/auth/forgot-password"
import LoginPage from "@/features/auth/sign-in"
import SignUpPage from "@/features/auth/sign-up"

type Page = "sign-in" | "sign-up" | "forgot-password"

export default function App() {
  const [page, setPage] = useState<Page>("sign-in")

  switch (page) {
    case "sign-up":
      return <SignUpPage onSignIn={() => setPage("sign-in")} />
    case "forgot-password":
      return <ForgotPasswordPage onBack={() => setPage("sign-in")} />
    default:
      return (
        <LoginPage
          onForgotPassword={() => setPage("forgot-password")}
          onSignUp={() => setPage("sign-up")}
        />
      )
  }
}
