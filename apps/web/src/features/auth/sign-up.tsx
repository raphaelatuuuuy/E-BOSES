import type { AuthUser } from "@/features/auth/api"
import { SignUpForm } from "@/features/auth/components/sign-up-form"
import { usePageTitle } from "@/hooks/use-page-title"

interface SignUpPageProps {
  onBack?: () => void
  onSignIn?: () => void
  onSuccess?: (user: AuthUser, access: string) => void
}

export default function SignUpPage({ onSignIn, onSuccess }: SignUpPageProps) {
  usePageTitle("Sign Up")

  return <SignUpForm onSignIn={onSignIn} onSuccess={onSuccess} />
}
