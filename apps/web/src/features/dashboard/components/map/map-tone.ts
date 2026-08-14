export type MapTone = "light" | "dark"

export const MAP_SURFACE: Record<MapTone, string> = {
  light: "border-neutral-200 bg-white/95 backdrop-blur",
  dark: "border-white/10 bg-nav-bg/85 backdrop-blur-md",
}

export const MAP_INK: Record<MapTone, string> = {
  light: "text-neutral-900",
  dark: "text-white",
}

export const MAP_MUTED: Record<MapTone, string> = {
  light: "text-neutral-500",
  dark: "text-white/50",
}

export const MAP_HOVER: Record<MapTone, string> = {
  light: "hover:bg-neutral-100",
  dark: "hover:bg-white/10",
}

export const MAP_LINE: Record<MapTone, string> = {
  light: "border-neutral-200",
  dark: "border-white/10",
}
