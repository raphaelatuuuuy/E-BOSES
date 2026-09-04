import { useCallback, useEffect, useRef } from "react"

export function useDebouncedCallback(fn: () => void, delayMs: number) {
  const timer = useRef<number | undefined>(undefined)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  }, [fn])
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current)
    },
    [],
  )
  return useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      fnRef.current()
    }, delayMs)
  }, [delayMs])
}
