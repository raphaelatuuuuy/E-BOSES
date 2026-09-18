"use client"

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react"

import { cn } from "@workspace/ui/lib/utils"

const MIN_SCALE = 0.55

/**
 * Fixed-height location pill shared by the SOS maps. The height never changes
 * (matches the 69px side circles); when the street text would overflow, the
 * content scales down so everything stays visible instead of growing the pill.
 */
export function SosPill({
  title,
  subtitle,
  onClick,
  disabled,
}: {
  title: string
  subtitle?: string
  onClick?: () => void
  disabled?: boolean
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const measure = () => {
      const available = outer.clientHeight
      const needed = inner.scrollHeight
      if (!available || !needed) return
      setScale((prev) => {
        const next = Math.max(
          MIN_SCALE,
          Math.min(1, available / needed)
        )
        return Math.abs(next - prev) < 0.01 ? prev : next
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [title, subtitle])

  const innerStyle: CSSProperties = {
    transform: scale < 1 ? `scale(${scale})` : undefined,
  }

  const className = cn(
    "pointer-events-auto flex h-[69px] min-w-0 flex-1",
    "max-w-[min(100%,340px)] flex-col items-center justify-center overflow-hidden",
    "rounded-full border border-neutral-200 bg-white px-7 text-center",
    "shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform",
    onClick
      ? disabled
        ? "cursor-not-allowed opacity-60"
        : "hover:scale-[1.02] active:scale-[0.99]"
      : ""
  )

  const content = (
    <div ref={outerRef} className="flex h-full w-full flex-col items-center justify-center overflow-hidden">
      <div
        ref={innerRef}
        style={innerStyle}
        className="flex w-full flex-col items-center justify-center"
      >
        <span className="text-[16px] leading-tight font-semibold text-neutral-900">
          {title}
        </span>
        {subtitle ? (
          <span className="mt-0.5 line-clamp-1 text-[12px] leading-snug font-medium break-words text-neutral-500">
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={className}
      >
        {content}
      </button>
    )
  }
  return (
    <p role="status" className={cn(className, "pointer-events-none")}>
      {content}
    </p>
  )
}
