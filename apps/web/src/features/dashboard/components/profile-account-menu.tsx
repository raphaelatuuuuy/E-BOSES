import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChevronDownIcon, LogOutIcon, PlusCircleIcon } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"

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

/**
 * Nextdoor-style account menu: avatar + chevron badge (no open animation).
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
        {/* Chevron badge — static, no rotate animation */}
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
