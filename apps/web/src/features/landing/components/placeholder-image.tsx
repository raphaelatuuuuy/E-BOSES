import { ImageSquare } from "@phosphor-icons/react"

const TONES = {
  light: "from-[#dfe6f2] to-[#c3cfe6] text-[#020c4e]/35",
  dark: "from-[#0a1f63] to-[#123a8f] text-white/40",
  navy: "from-[#020c4e] to-[#1f6c98] text-white/40",
} as const

type PlaceholderImageProps = {
  label?: string
  tone?: keyof typeof TONES
  className?: string
  iconClassName?: string
}

export function PlaceholderImage({
  label,
  tone = "light",
  className = "",
  iconClassName = "size-8",
}: PlaceholderImageProps) {
  return (
    <div
      className={`relative flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br ${TONES[tone]} ${className}`}
      role="img"
      aria-label={label ? `${label} (placeholder image)` : "Placeholder image"}
    >
      <ImageSquare className={iconClassName} />
      {label ? (
        <span className="px-3 text-center text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </span>
      ) : null}
    </div>
  )
}
