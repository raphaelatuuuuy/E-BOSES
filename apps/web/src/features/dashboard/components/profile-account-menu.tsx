import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Link, useNavigate } from "react-router-dom"
import { ChevronDownIcon, LogOutIcon, PlusCircleIcon } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import { RESIDENT_DESKTOP_MIN_PX } from "@/features/dashboard/components/resident-top-bar"

function LetterAvatar({
  letter,
  className,
}: {
  letter: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-[#c5d0e6] font-semibold text-[#2c3a5a]",
        className,
      )}
    >
      {letter}
    </span>
  )
}

function GlyphIcon({ src, className }: { src: string; className?: string }) {
  return (
    <span
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
      aria-hidden
    />
  )
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= RESIDENT_DESKTOP_MIN_PX : true,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${RESIDENT_DESKTOP_MIN_PX}px)`)
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
  return isDesktop
}

/**
 * Account menu:
 * - Desktop: popover under avatar (with chevron badge)
 * - Mobile: avatar only → full-height right sheet (Nextdoor layout, white theme)
 */
export function ProfileAccountMenu({
  placeLabel = "Marikina Heights",
  className,
}: {
  placeLabel?: string
  className?: string
}) {
  const { user, signOut } = useAuthSession()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const displayName = user
    ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident"
    : "Resident"
  const letter = (user?.firstName?.[0] || displayName[0] || "?").toUpperCase()

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      navigate("/sign-in", { replace: true })
    } finally {
      setSigningOut(false)
      setOpen(false)
    }
  }

  function closeAndGo(path: string) {
    setOpen(false)
    navigate(path)
  }

  useEffect(() => {
    if (isDesktop || !open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener("keydown", onKey)
    }
  }, [open, isDesktop])

  // ── Desktop popover ──
  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            "relative flex size-9 shrink-0 items-center justify-center rounded-full outline-none",
            "hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-200",
            className,
          )}
          aria-label="Account menu"
        >
          <LetterAvatar letter={letter} className="size-9 text-[16px]" />
          <span
            className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-neutral-300"
            aria-hidden
          >
            <ChevronDownIcon className="size-2.5 text-neutral-800" strokeWidth={3} />
          </span>
        </PopoverTrigger>

        <PopoverContent
          className="w-[280px] overflow-hidden rounded-2xl border-[1.5px] border-solid border-[#d0d0d0] bg-white p-0 shadow-[0_8px_30px_rgba(15,23,42,0.12)]"
          side="bottom"
        >
          <div className="flex flex-col items-center px-5 pb-4 pt-6 text-center">
            <LetterAvatar letter={letter} className="size-16 text-2xl" />
            <p className="mt-3 text-[16px] font-semibold leading-tight text-neutral-900">
              {displayName}
            </p>
            <p className="mt-1 text-[13px] font-normal text-neutral-500">{placeLabel}</p>
            <Link
              to="/dashboard/profile"
              onClick={() => setOpen(false)}
              className="mt-4 inline-flex h-9 items-center justify-center rounded-full border-[1.5px] border-solid border-[#d0d0d0] bg-white px-5 text-[14px] font-semibold text-neutral-800 no-underline transition-colors hover:bg-neutral-50"
            >
              View profile
            </Link>
          </div>

          <div className="border-t-[1.5px] border-solid border-[#d0d0d0]" />

          <Link
            to="/dashboard/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-5 py-3.5 text-[15px] font-medium text-neutral-800 no-underline transition-colors hover:bg-neutral-50"
          >
            <PlusCircleIcon className="size-5 shrink-0 text-neutral-700" strokeWidth={1.75} />
            Settings
          </Link>

          <div className="border-t-[1.5px] border-solid border-[#d0d0d0]" />

          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left text-[15px] font-medium text-neutral-800 transition-colors hover:bg-neutral-50 disabled:opacity-60"
          >
            <LogOutIcon className="size-5 shrink-0 text-neutral-700" strokeWidth={1.75} />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </PopoverContent>
      </Popover>
    )
  }

  // ── Mobile side panel — match Nextdoor structure / type scale (white theme) ──
  const sheet =
    open && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[240] flex justify-end lg:hidden" role="dialog" aria-modal="true">
            <button
              type="button"
              className="absolute inset-0 bg-black/45"
              aria-label="Close account menu"
              onClick={() => setOpen(false)}
            />
            <aside className="relative flex h-full w-[min(88vw,300px)] flex-col bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.2)]">
              {/* Header — avatar, name, place (Nextdoor spacing) */}
              <div className="px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
                <LetterAvatar letter={letter} className="size-[52px] text-[20px]" />
                <p className="mt-3.5 text-[18px] font-bold leading-tight tracking-tight text-neutral-900">
                  {displayName}
                </p>
                <p className="mt-1 text-[14px] font-normal leading-snug text-neutral-500">
                  {placeLabel}
                </p>
              </div>

              <div className="mx-5 border-t border-neutral-200" />

              {/* Primary rows — glyph + label */}
              <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
                <button
                  type="button"
                  onClick={() => closeAndGo("/dashboard/profile")}
                  className="flex min-h-[48px] w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
                >
                  <GlyphIcon
                    src="/contents/profile.png"
                    className="size-[22px] text-neutral-700"
                  />
                  <span className="text-[16px] font-normal text-neutral-900">My profile</span>
                </button>

                <button
                  type="button"
                  onClick={() => closeAndGo("/dashboard/reports")}
                  className="flex min-h-[48px] w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
                >
                  <GlyphIcon
                    src="/contents/nav-clipboard.png"
                    className="size-[22px] text-neutral-700"
                  />
                  <span className="text-[16px] font-normal text-neutral-900">Reports</span>
                </button>
              </nav>

              {/* Footer — text only, no icons (Nextdoor footer style) */}
              <div className="mt-auto border-t border-neutral-200 px-5 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.5rem))] pt-4">
                <button
                  type="button"
                  onClick={() => closeAndGo("/dashboard/settings")}
                  className="block w-full py-2.5 text-left text-[15px] font-normal text-neutral-600 transition-colors hover:text-neutral-900"
                >
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                  className="block w-full py-2.5 text-left text-[15px] font-normal text-neutral-600 transition-colors hover:text-neutral-900 disabled:opacity-60"
                >
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </aside>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "relative flex size-9 shrink-0 items-center justify-center rounded-full outline-none",
          "hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-200",
          className,
        )}
        aria-label="Account menu"
        aria-expanded={open}
      >
        <LetterAvatar letter={letter} className="size-9 text-[16px]" />
      </button>
      {sheet}
    </>
  )
}
