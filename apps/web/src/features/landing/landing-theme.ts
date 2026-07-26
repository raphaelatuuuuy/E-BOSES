// apps/web/src/features/landing/landing-theme.ts
export const CANVAS = "#07070b"
export const INK = "#f5f2ec"
export const ACCENT = "#ff5003"

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/** Heuristic: skip three.js on devices likely to jank. */
export function isLowEndDevice(): boolean {
  if (typeof navigator === "undefined") return false
  const nav = navigator as Navigator & { deviceMemory?: number }
  const cores = nav.hardwareConcurrency ?? 8
  const memory = nav.deviceMemory ?? 8
  return cores <= 4 || memory <= 4
}

/** Shared gsap.matchMedia() breakpoint conditions. */
export const MM = {
  desktop: "(min-width: 768px) and (prefers-reduced-motion: no-preference)",
  mobile: "(max-width: 767px) and (prefers-reduced-motion: no-preference)",
  reduced: "(prefers-reduced-motion: reduce)",
} as const
