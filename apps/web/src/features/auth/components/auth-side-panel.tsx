import { Link } from "react-router-dom"
import { useEffect, useState } from "react"
import { useAuthPanelRotation } from "@/features/auth/hooks/use-auth-panel-rotation"

export function AuthSidePanel() {
  const { slide, total, current, next } = useAuthPanelRotation()
  const [animate, setAnimate] = useState(true)
  const [prevCurrent, setPrevCurrent] = useState(current)

  // Restart the crossfade when the carousel advances: reset the animation
  // during render (React's "adjusting state when a prop changes" pattern)
  // instead of a synchronous setState inside an effect.
  if (current !== prevCurrent) {
    setPrevCurrent(current)
    setAnimate(false)
  }
  useEffect(() => {
    if (!animate) requestAnimationFrame(() => setAnimate(true))
  }, [animate])

  return (
    <section className="relative hidden flex-col overflow-hidden lg:flex lg:h-full lg:min-h-screen">
      {/* Brand — top left of carousel (desktop / laptop) */}
      <Link
        to="/"
        className="absolute left-0 top-0 z-10 flex items-center gap-2 px-8 py-6 md:px-10"
        aria-label="Boses — back to landing page"
      >
        <img src="/contents/logo.webp" alt="E-Boses" className="h-9 w-auto md:h-10" />
        <span className="font-heading text-xl font-bold text-primary md:text-2xl">Boses</span>
      </Link>

      {/* Image area */}
      <div className="relative flex-1 overflow-hidden">
        <div
          className={`h-full w-full bg-contain bg-bottom bg-no-repeat transition-opacity duration-700 ${
            animate ? "opacity-100" : "opacity-0"
          }`}
          style={{ backgroundImage: `url(${slide.image})` }}
        />
      </div>

      {/* Text area */}
      <div className="flex flex-col items-center gap-3 p-8 text-center md:p-10">
        <h2
          className={`font-heading text-balance text-3xl leading-tight text-foreground transition-all duration-700 md:text-4xl font-medium ${
            animate ? "opacity-100" : "opacity-0"
          }`}
        >
          {slide.headline}
        </h2>
        <p
          className={`text-base text-muted-foreground transition-all duration-700 ${
            animate ? "opacity-100" : "opacity-0"
          }`}
        >
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