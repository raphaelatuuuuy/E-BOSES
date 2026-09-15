import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react"

export function useMapFullscreen(
  onResize: () => void,
  onFullscreenChange?: (full: boolean) => void
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const resizeRef = useRef(onResize)
  const notifyRef = useRef(onFullscreenChange)

  useEffect(() => {
    resizeRef.current = onResize
    notifyRef.current = onFullscreenChange
  })

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
      window.setTimeout(() => resizeRef.current(), 250)
    }
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange)
  }, [])

  useEffect(() => {
    if (!expanded) return
    resizeRef.current()
    const timer = window.setTimeout(() => resizeRef.current(), 250)
    return () => window.clearTimeout(timer)
  }, [expanded])

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => setExpanded(false))
      return
    }
    if (expanded) {
      setExpanded(false)
      return
    }
    if (el?.requestFullscreen) {
      void el.requestFullscreen().catch(() => setExpanded(true))
      return
    }
    setExpanded(true)
  }, [expanded])

  const fullView = isFullscreen || expanded

  useEffect(() => {
    notifyRef.current?.(fullView)
  }, [fullView])
  const expandStyle: CSSProperties | undefined =
    fullView && !isFullscreen
      ? {
          position: "fixed",
          inset: 0,
          zIndex: 3000,
          width: "100vw",
          height: "100dvh",
          borderRadius: 0,
        }
      : undefined

  return { wrapRef, fullView, toggleFullscreen, expandStyle }
}
