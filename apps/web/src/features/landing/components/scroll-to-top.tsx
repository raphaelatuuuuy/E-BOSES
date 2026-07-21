import { useEffect, useState } from "react"
import { ArrowUp } from "@phosphor-icons/react"

export function ScrollToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const scrollUp = () => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" })
  }

  return (
    <button
      type="button"
      onClick={scrollUp}
      aria-label="Back to top"
      className={`fixed bottom-6 right-6 z-30 flex size-12 items-center justify-center rounded-full bg-[#ff5003] text-white transition-all duration-200 hover:bg-[#d94300] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#020c4e] motion-reduce:transition-none ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <ArrowUp className="size-5" />
    </button>
  )
}
