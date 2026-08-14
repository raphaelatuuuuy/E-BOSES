import { Link, useLocation, useNavigate } from "react-router-dom"
import { useState } from "react"
import { BellIcon, ChevronDownIcon, LogOutIcon, UserCircleIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import {
  ResidentNotificationsDialog,
  ResidentProfileDialog,
} from "@/features/dashboard/components/resident/resident-account-dialogs"
import { useNotifications } from "@/features/dashboard/components/notification-context"
import { useOfficialBadges } from "@/features/dashboard/hooks/use-official-badges"
import { useAssignedDispatches } from "@/features/dashboard/hooks/use-assigned-dispatches"
import {
  ResponderNotificationsDialog,
  ResponderProfileDialog,
} from "@/features/dashboard/components/responder/account-dialogs"
import {
  OfficialNotificationsDialog,
  OfficialProfileDialog,
} from "@/features/dashboard/components/official/official-account-dialogs"
import { openSettingsDialog } from "@/features/dashboard/components/settings/settings-event"
import {
  getRoleNav,
  type NavItemConfig,
} from "@/features/dashboard/lib/navigation"
import { displayPosition } from "@/features/dashboard/lib/position"

/**
 * One sidebar for every role, sharing the same column geometry, row
 * treatment, badge language and account block. The resident rail keeps the
 * light surface; official and responder stay on the dark navy palette
 * (`nav-*` tokens / `.staff-dark`). Only item data differs, via `getRoleNav`.
 */

type Tone = "light" | "dark"

function isAlarmItem(itemKey: string, count: number) {
  // Only live emergencies / assigned dispatches earn the alarm treatment.
  return (itemKey === "emergencies" || itemKey === "dispatch") && count > 0
}

function rowClass(tone: Tone, active: boolean, alarm: boolean) {
  return cn(
    // Exact responder row: fixed height + full-width pill, no width collapse.
    "flex h-12 w-full items-center gap-2.5 rounded-2xl px-4 transition-colors duration-150",
    alarm
      ? cn("bg-gradient-to-b from-sos-bright to-sos text-white", "animate-sos-glow-blink")
      : active
        ? tone === "dark"
          ? "bg-nav-active text-nav-text-active"
          : "bg-brand-navy text-white"
        : tone === "dark"
          ? "text-nav-muted hover:bg-nav-raised hover:text-nav-text-active"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-brand-navy",
  )
}

function SidebarRow({
  item,
  tone,
  active,
  badge,
  alarm,
}: {
  item: NavItemConfig
  tone: Tone
  active: boolean
  /** Count of items awaiting attention on that screen. */
  badge?: number
  /** Live work that gets the SOS treatment. */
  alarm?: boolean
}) {
  const Icon = item.icon
  const urgent = alarm

  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={rowClass(tone, active, Boolean(urgent))}
    >
      <Icon
        className="size-5 shrink-0"
        strokeWidth={active || urgent ? 2.2 : 1.8}
        fill="none"
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left text-[13px] leading-none",
          urgent || active ? "font-bold" : "font-medium",
        )}
      >
        {item.label}
      </span>

      {badge && badge > 0 ? (
        <span
          className={cn(
            "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-pill px-1.5 text-[11px] leading-none tabular-nums",
            urgent ? "bg-white font-bold text-sos" : "bg-sos font-bold text-white",
            urgent && "flex items-center gap-1",
          )}
        >
          {urgent ? <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-sos" /> : null}
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  )
}

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, signOut } = useAuthSession()
  const isResponderRole = isResponderUser(user)
  const isOfficialRole = isOfficialUser(user)
  const isResident = !isOfficialRole && !isResponderRole
  const tone: Tone = isResident ? "light" : "dark"

  const role = isResponderRole ? "responder" : isOfficialRole ? "official" : "resident"
  const nav = getRoleNav(role)
  const navItems = nav.items
  const badges = useOfficialBadges(isOfficialRole)

  // Unread notifications ride on the account block.
  const { unreadCount } = useNotifications()

  // Responder alarm count (dispatch) — SOS treatment on the dispatch row.
  const { activeAlerts } = useAssignedDispatches(isResponderRole)
  const dispatchLive = activeAlerts.length
  const emergenciesLive = badges.emergencies ?? 0

  function badgeForItem(itemKey: string): number {
    if (itemKey === "emergencies") return emergenciesLive
    if (itemKey === "dispatch") return dispatchLive
    return isOfficialRole ? (badges[itemKey] ?? 0) : 0
  }

  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const avatarInitials = initials(user?.full_name || "Account")
  const rolePosition = displayPosition(user)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      navigate("/sign-in", { replace: true })
    } finally {
      setSigningOut(false)
    }
  }

  const accountItemClass = cn(
    "flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[12.5px] leading-none transition-colors",
    tone === "dark"
      ? "text-nav-text hover:bg-nav-raised hover:text-nav-text-active"
      : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900",
  )
  const accountIconClass = cn(
    "size-4 shrink-0",
    tone === "dark" ? "text-nav-muted" : "text-neutral-500",
  )

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden",
        tone === "dark" ? "bg-nav-bg" : "bg-white",
      )}
    >
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pt-6 [scrollbar-width:thin]">
        <ul className="flex flex-col gap-1.5">
          {navItems.map((item) => {
            const active = item.isActive(location.pathname)
            const badgeForItemValue = badgeForItem(item.key)
            const alarm = isAlarmItem(item.key, badgeForItemValue)
            return (
              <li key={item.key}>
                <SidebarRow item={item} tone={tone} active={active} badge={badgeForItemValue} alarm={alarm} />
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Identity block pinned to the floor — avatar, name, role, sign out. */}
      <div className={cn("shrink-0 px-3 pb-4 pt-2", tone === "dark" ? "border-t border-nav-border" : "border-t border-neutral-100")}>
        <div>
          {open ? (
            <ul className="mb-1 flex flex-col gap-0.5">
              <li>
                {isResident ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      setProfileOpen(true)
                    }}
                    className={accountItemClass}
                  >
                    <UserCircleIcon className={accountIconClass} strokeWidth={1.8} />
                    <span className="min-w-0 flex-1 truncate text-left font-medium">
                      View profile
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      setProfileOpen(true)
                    }}
                    className={accountItemClass}
                  >
                    <UserCircleIcon className={accountIconClass} strokeWidth={1.8} />
                    <span className="min-w-0 flex-1 truncate text-left font-medium">
                      View profile
                    </span>
                  </button>
                )}
              </li>

              <li>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setNotificationsOpen(true)
                  }}
                  className={accountItemClass}
                >
                  <BellIcon className={accountIconClass} strokeWidth={1.8} />
                  <span className="min-w-0 flex-1 truncate text-left font-medium">
                    Notifications
                  </span>
                  {unreadCount > 0 ? (
                    <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-sos px-1 text-[10px] font-bold leading-none text-white tabular-nums">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </button>
              </li>

              <li>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                  className={cn(accountItemClass, "disabled:opacity-60")}
                >
                  <LogOutIcon className={accountIconClass} strokeWidth={1.8} />
                  <span className="min-w-0 flex-1 whitespace-nowrap text-left font-medium">
                    {signingOut ? "Signing out…" : "Sign out"}
                  </span>
                </button>
              </li>
            </ul>
          ) : null}

          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors",
              tone === "dark" ? "hover:bg-nav-raised" : "hover:bg-neutral-50",
            )}
          >
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold ring-1",
                tone === "dark"
                  ? "bg-nav-active text-white ring-white/10"
                  : "bg-neutral-100 text-neutral-700 ring-transparent",
              )}
            >
              {avatarInitials}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  "truncate text-[12.5px] font-bold leading-tight",
                  tone === "dark" ? "text-nav-text-active" : "text-neutral-900",
                )}
              >
                {user?.full_name || "Account"}
              </span>
              <span
                className={cn(
                  "truncate text-[10.5px] font-semibold leading-tight",
                  tone === "dark" ? "text-nav-muted" : "text-neutral-500",
                )}
              >
                {rolePosition}
              </span>
            </span>
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-200",
                tone === "dark" ? "text-nav-muted" : "text-neutral-400",
                open && "rotate-180",
              )}
              strokeWidth={2.4}
            />
          </button>
        </div>
      </div>

      {/* Role dialogs — the same personal surfaces each role already has. */}
      {isOfficialRole ? (
        <>
          <OfficialProfileDialog
            open={profileOpen}
            onOpenChange={setProfileOpen}
            onOpenSettings={(closeDialog) => {
              closeDialog()
              openSettingsDialog()
            }}
          />
          <OfficialNotificationsDialog open={notificationsOpen} onOpenChange={setNotificationsOpen} />
        </>
      ) : isResponderRole ? (
        <>
          <ResponderProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
          <ResponderNotificationsDialog open={notificationsOpen} onOpenChange={setNotificationsOpen} />
        </>
      ) : (
        <>
          <ResidentProfileDialog
            open={profileOpen}
            onOpenChange={setProfileOpen}
            onOpenSettings={(closeDialog) => {
              closeDialog()
              openSettingsDialog()
            }}
          />
          <ResidentNotificationsDialog open={notificationsOpen} onOpenChange={setNotificationsOpen} />
        </>
      )}
    </aside>
  )
}

export function SidebarSosButton() {
  return null
}