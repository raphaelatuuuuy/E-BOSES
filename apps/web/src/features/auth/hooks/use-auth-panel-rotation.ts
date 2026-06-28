import { useMemo } from "react"

const PANEL_VARIANTS = [
  {
    gradient: "bg-gradient-to-br from-[#020c4e] via-[#1f6c98] to-[#ff8133]",
    lines: ["Stronger connections.", "Smarter communities."],
  },
  {
    gradient: "bg-gradient-to-tr from-[#ff5003] via-[#ff8133] to-[#020c4e]",
    lines: ["Voices heard.", "Actions taken."],
  },
  {
    gradient: "bg-gradient-to-br from-[#020c4e] via-[#1f6c98] to-[#ff8133]",
    lines: ["Every concern heard.", "Every emergency handled."],
  },
] as const

export function useAuthPanelRotation() {
  return useMemo(() => {
    const activeVariant =
      PANEL_VARIANTS[Math.floor(Math.random() * PANEL_VARIANTS.length)]

    return {
      gradient: activeVariant.gradient,
      taglineLines: activeVariant.lines,
    }
  }, [])
}
