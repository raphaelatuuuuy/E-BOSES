import { useMemo, useState } from "react"

const PANEL_VARIANTS = [
  {
    image: "/contents/marikina-area-1.png",
    lines: ["Stronger connections.", "Smarter communities."],
  },
  {
    image: "/contents/marikina-area-2.png",
    lines: ["Voices heard.", "Actions taken."],
  },
  {
    image: "/contents/marikina-area-3.png",
    lines: ["Every concern heard.", "Every emergency handled."],
  },
] as const

function pickRandomVariant() {
  return PANEL_VARIANTS[Math.floor(Math.random() * PANEL_VARIANTS.length)]
}

export function useAuthPanelRotation() {
  const [variant] = useState(pickRandomVariant)

  return useMemo(
    () => ({
      image: variant.image,
      taglineLines: variant.lines,
    }),
    [variant],
  )
}
