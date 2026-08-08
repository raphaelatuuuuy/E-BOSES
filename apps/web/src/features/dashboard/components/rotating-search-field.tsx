import { useEffect, useState } from "react"
import { SearchIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/** Cycles like Nextdoor “Search for Handyman” → next word fades up */
const SEARCH_WORDS = [
  "concerns",
  "reports",
  "flooding",
  "roads",
  "neighbors",
  "announcements",
  "streetlights",
  "garbage",
] as const

/** Longest word — reserves width so rotating text never clips */
const LONGEST_WORD = SEARCH_WORDS.reduce((a, b) => (a.length >= b.length ? a : b), SEARCH_WORDS[0])

const CYCLE_MS = 2400

/** Shared text metrics so overlay lines up with typed input text */
const TEXT =
  "text-[15px] leading-none font-normal tracking-normal"

type RotatingSearchFieldProps = {
  value: string
  onChange: (value: string) => void
  className?: string
  inputClassName?: string
  maxWidth?: number | string
}

/**
 * Nextdoor-style pill search: “Search for ” + rotating bold word.
 * Overlay uses the same height/padding as the input so text stays aligned.
 */
export function RotatingSearchField({
  value,
  onChange,
  className,
  inputClassName,
  maxWidth = 420,
}: RotatingSearchFieldProps) {
  const [index, setIndex] = useState(0)
  const [focused, setFocused] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    function onMq() {
      setReduceMotion(mq.matches)
    }
    mq.addEventListener("change", onMq)
    return () => mq.removeEventListener("change", onMq)
  }, [])

  useEffect(() => {
    if (value.trim() || focused) return

    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % SEARCH_WORDS.length)
    }, CYCLE_MS)

    return () => window.clearInterval(id)
  }, [value, focused])

  const showHint = !value.trim() && !focused
  const word = SEARCH_WORDS[index]

  return (
    <div
      className={cn("relative mx-auto w-full", className)}
      style={{ maxWidth }}
    >
      <style>{`
        @keyframes eboses-search-word {
          0% {
            opacity: 0;
            transform: translate3d(0, 100%, 0);
          }
          12% {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
          80% {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
          100% {
            opacity: 0;
            transform: translate3d(0, -100%, 0);
          }
        }
      `}</style>

      <div className="relative h-11">
        <SearchIcon
          className="pointer-events-none absolute left-3.5 top-1/2 z-[2] size-7 -translate-y-1/2 text-neutral-600"
          strokeWidth={2.25}
          aria-hidden
        />

        {/*
          Placeholder overlay mirrors input box model:
          h-11 + pl-11 + pr-4 + flex items-center → same baseline as typed text
        */}
        {showHint ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-[1] flex items-center pl-11 pr-4",
              TEXT,
              "text-neutral-500",
            )}
            aria-hidden
          >
            <span className="flex items-center whitespace-nowrap">
              <span className="shrink-0">Search for&nbsp;</span>
              {/* Fixed-height clip window; word centered vertically inside */}
              <span className="relative inline-flex h-[1.25rem] items-center overflow-hidden">
                {/* Width sizer (same weight as animated word) */}
                <span
                  className="invisible whitespace-nowrap font-semibold"
                  aria-hidden
                >
                  {LONGEST_WORD}
                </span>
                <span
                  key={word}
                  className="absolute left-0 top-0 flex h-full w-full items-center whitespace-nowrap font-semibold text-neutral-900"
                  style={
                    reduceMotion
                      ? undefined
                      : {
                          animation: `eboses-search-word ${CYCLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both`,
                          willChange: "transform, opacity",
                          backfaceVisibility: "hidden",
                        }
                  }
                >
                  {word}
                </span>
              </span>
            </span>
          </div>
        ) : null}

        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={focused && !value ? "Search…" : ""}
          aria-label="Search feed"
          className={cn(
            "absolute inset-0 h-11 w-full rounded-full border-[1.5px] border-solid border-card-line-strong bg-white pl-11 pr-4",
            TEXT,
            "text-neutral-900 caret-neutral-900 shadow-none outline-none",
            "placeholder:text-neutral-500",
            "focus:border-[1.5px] focus:border-neutral-400 focus:ring-0",
            "[&::-webkit-search-cancel-button]:appearance-none",
            inputClassName,
          )}
        />
      </div>
    </div>
  )
}