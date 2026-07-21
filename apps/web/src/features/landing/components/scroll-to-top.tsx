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
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <button
      type="button"
      onClick={scrollUp}
      aria-label="Back to top"
      className={`fixed bottom-6 right-6 z-[90] flex size-12 items-center justify-center rounded-full bg-[#ff8133] text-white shadow-lg shadow-[#ff8133]/30 transition-all duration-300 hover:bg-[#ff5003] hover:scale-110 active:scale-95 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <ArrowUp className="size-5" />
    </button>
  )
}
