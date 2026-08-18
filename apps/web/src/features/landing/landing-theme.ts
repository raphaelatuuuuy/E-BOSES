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

/** Shared gsap.matchMedia() breakpoint conditions. */
export const MM = {
  desktop: "(min-width: 768px) and (prefers-reduced-motion: no-preference)",
  mobile: "(max-width: 767px) and (prefers-reduced-motion: no-preference)",
  reduced: "(prefers-reduced-motion: reduce)",
} as const
