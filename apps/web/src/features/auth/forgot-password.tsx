import { useMemo } from "react"
import { ChevronLeft } from "lucide-react"

import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form"

interface ForgotPasswordPageProps {
  onBack?: () => void
}

const GRADIENTS = [
  "bg-gradient-to-br from-[#020c4e] via-[#1f6c98] to-[#ff8133]",
  "bg-gradient-to-tr from-[#ff5003] via-[#ff8133] to-[#020c4e]",
]

export default function ForgotPasswordPage({
  onBack,
}: ForgotPasswordPageProps) {
  const gradient = useMemo(() => GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)], [])

  return (
    <main className="grid min-h-svh w-full lg:grid-cols-[40fr_60fr]">
      <section className="relative flex flex-col p-6 md:p-10 overflow-y-auto">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-lg">
            <ForgotPasswordForm onBack={onBack} />
          </div>
        </div>
      </section>
      <section
        className="relative hidden h-full min-h-screen lg:block overflow-hidden"
        aria-hidden="true"
      >
        <div
          className={`absolute inset-0 ${gradient} animate-[gradientShift_8s_ease_infinite]`}
          style={{ backgroundSize: "200% 200%" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-10">
          <h2 className="font-serif text-balance text-3xl leading-tight text-white md:text-4xl">
            Stronger connections. Smarter communities.
          </h2>
        </div>
      </section>
    </main>
  )
}
