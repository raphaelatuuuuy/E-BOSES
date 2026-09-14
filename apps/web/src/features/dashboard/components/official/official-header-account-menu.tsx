import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronDownIcon, InboxIcon, LogOutIcon, UserCircleIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { useNotifications } from "@/features/dashboard/components/notification-context"
import {
  OfficialNotificationsDialog,
  OfficialProfileDialog,
} from "@/features/dashboard/components/official/official-account-dialogs"
import { openSettingsDialog } from "@/features/dashboard/components/settings/settings-event"
import { displayUnit } from "@/features/dashboard/lib/position"

/**
 * Account menu for the official desktop header — the same personal surfaces
 * the sidebar account block offers (profile / notifications / sign out),
 * re-homed into the header now that the official shell hides the rail's
 * account block (`hideAccountBlock`). Sits on the navy→orange header
 * gradient, so the trigger reads as white-on-gradient while the dropdown is
 * a plain white card.
 */
export function OfficialHeaderAccountMenu() {
  const navigate = useNavigate()
  const { user, signOut } = useAuthSession()
  const { unreadCount } = useNotifications()

  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const avatarInitials = initials(user?.full_name || "Account").charAt(0)
  const unitLabel = displayUnit(user)

  // Close the dropdown when clicking anywhere outside it.
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [menuOpen])

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      navigate("/sign-in", { replace: true })
    } finally {
      setSigningOut(false)
    }
  }

  const itemClass = cn(
    "flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[12.5px] font-medium leading-none",
    "text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900",
  )
  const iconClass = "size-4 shrink-0 text-neutral-500"

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((current) => !current)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3 text-left transition-colors hover:bg-black/10"
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            "bg-white/15 text-[14px] font-bold text-white ring-1 ring-white/30",
          )}
        >
          {avatarInitials}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="max-w-44 truncate text-[12.5px] font-bold leading-tight text-white">
            {user?.full_name || "Account"}
          </span>
          <span className="max-w-44 truncate text-[10.5px] font-semibold leading-tight text-white/70">
            {unitLabel}
          </span>
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-white/70 transition-transform duration-150",
            menuOpen && "rotate-180",
          )}
          strokeWidth={2}
        />
      </button>

      {menuOpen ? (
        <ul
          role="menu"
          className={cn(
            "absolute right-0 top-[calc(100%+10px)] z-[1200] flex w-56 flex-col gap-0.5 rounded-xl bg-white p-3",
            "text-neutral-900 shadow-[0_14px_35px_rgba(15,23,42,0.16)] ring-1 ring-neutral-200/80",
          )}
        >
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                setProfileOpen(true)
              }}
              className={itemClass}
            >
              <UserCircleIcon className={iconClass} strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate text-left font-medium">
                View profile
              </span>
            </button>
          </li>

          <li>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                setNotificationsOpen(true)
              }}
              className={itemClass}
            >
              <InboxIcon className={iconClass} strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate text-left font-medium">
                Notifications
              </span>
              {unreadCount > 0 ? (
                <span
                  className="size-2.5 shrink-0 rounded-full bg-brand-orange"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          </li>

          <li>
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className={cn(
                itemClass,
                "bg-brand-orange text-white hover:bg-brand-orange-strong hover:text-white disabled:opacity-60",
              )}
            >
              <LogOutIcon className="size-4 shrink-0 text-white" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 whitespace-nowrap text-left font-medium">
                {signingOut ? "Signing out…" : "Sign out"}
              </span>
            </button>
          </li>
        </ul>
      ) : null}

      {/* Same role dialogs the sidebar account block mounts. */}
      <OfficialProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        onOpenSettings={(closeDialog) => {
          closeDialog()
          openSettingsDialog()
        }}
      />
      <OfficialNotificationsDialog open={notificationsOpen} onOpenChange={setNotificationsOpen} />
    </div>
  )
}
