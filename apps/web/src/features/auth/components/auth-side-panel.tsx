import { Link } from "react-router-dom"
import { useAuthPanelRotation } from "@/features/auth/hooks/use-auth-panel-rotation"

export function AuthSidePanel() {
  const { slide, total, current, next } = useAuthPanelRotation()

  return (
    <section className="relative hidden flex-col overflow-hidden lg:flex lg:h-full lg:min-h-screen">
      {/* Brand — top left of carousel (desktop / laptop) */}
      <Link
        to="/"
        className="absolute left-0 top-0 z-10 flex items-center gap-2 px-8 py-6 md:px-10"
        aria-label="Boses — back to landing page"
      >
        <img src="/contents/logo.webp" alt="E-Boses" className="h-9 w-auto md:h-10" />
        <span className="text-2xl font-bold text-accent">Boses</span>
      </Link>

      {/* Image area */}
      <div className="relative flex-1 overflow-hidden">
        <div
          key={current}
          className="h-full w-full animate-fade-in bg-contain bg-bottom bg-no-repeat"
          style={{ backgroundImage: `url(${slide.image})` }}
        />
      </div>

      {/* Text area */}
      <div className="flex flex-col items-center gap-3 p-8 text-center md:p-10">
        <h2
          key={`${current}-title`}
          className="font-heading animate-fade-in text-balance text-3xl font-medium leading-tight text-foreground md:text-4xl"
        >
          {slide.headline}
        </h2>
        <p key={`${current}-desc`} className="animate-fade-in text-base text-muted-foreground">
          {slide.description}
        </p>

        {/* Dot indicators */}
        <div className="mt-2 flex items-center gap-2">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={next}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i === current
                  ? "w-8 bg-primary"
                  : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              }`}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  )
}