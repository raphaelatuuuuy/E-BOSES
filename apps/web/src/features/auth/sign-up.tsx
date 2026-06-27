import { useMemo } from "react"
import { ChevronLeft } from "lucide-react"

import { SignUpForm } from "@/features/auth/components/sign-up-form"

interface SignUpPageProps {
  onSignIn?: () => void
}

const GRADIENTS = [
  "bg-gradient-to-br from-[#020c4e] via-[#1f6c98] to-[#ff8133]",
  "bg-gradient-to-tr from-[#ff5003] via-[#ff8133] to-[#020c4e]",
]

const TAGLINES = [
  "Stronger connections. Smarter communities.",
  "Voices heard. Actions taken.",
  "Every concern heard. Every emergency handled.",
]

export default function SignUpPage({ onSignIn }: SignUpPageProps) {
  const gradient = useMemo(() => GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)], [])
  const tagline = useMemo(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)], [])

  return (
    <main className="grid min-h-svh w-full lg:h-svh lg:grid-cols-[40fr_60fr] lg:overflow-hidden">
      <section className="relative flex flex-col overflow-y-auto p-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:p-10 lg:min-h-0">
        <button
          type="button"
          onClick={onSignIn}
          className="flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-lg">
            <SignUpForm onSignIn={onSignIn} />
          </div>
        </div>
      </section>
      <section
        className="relative hidden overflow-hidden lg:block lg:h-svh"
        aria-hidden="true"
      >
        <div
          className={`absolute inset-0 ${gradient} animate-[gradientShift_8s_ease_infinite]`}
          style={{ backgroundSize: "200% 200%" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-10">
          <h2 className="font-serif text-balance text-3xl leading-tight text-white md:text-4xl">
            {tagline}
          </h2>
        </div>
      </section>
    </main>
  )
}
