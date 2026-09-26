import { useEffect } from "react"

export function shouldSkipPoll() {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  )
}

export function useVisibilityRefresh(onVisible: () => void) {
  useEffect(() => {
    if (typeof document === "undefined") return
    const handler = () => {
      if (document.visibilityState === "visible") onVisible()
    }
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }, [onVisible])
}
