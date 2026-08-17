import { Link, useLocation, useNavigate } from "react-router-dom"
import { useState } from "react"
import {
  InboxIcon,
  BellRingIcon,
  CalendarDaysIcon,
  ChartSplineIcon,
  ClipboardListIcon,
  FileTextIcon,
  FileChartColumnIcon,
  FileUserIcon,
  LogOutIcon,
  MapIcon,
  MapPinIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  SettingsIcon,
  SirenIcon,
  ShieldAlertIcon,
  UserCircleIcon,
  UserRoundIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

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
import { hasCapability } from "@/features/dashboard/lib/capabilities"
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
    "flex h-12 w-full items-center gap-2.5 rounded-xl px-4 transition-colors duration-150",
    alarm
      ? "text-sos"
      : active
        ? tone === "dark"
          ? "text-nav-text-active"
          : "text-brand-navy"
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
  iconOnly = false,
  description,
  relatedIcons = [],
  onHover,
}: {
  item: NavItemConfig
  tone: Tone
  active: boolean
  /** Count of items awaiting attention on that screen. */
  badge?: number
  /** Live work that gets the SOS treatment. */
  alarm?: boolean
  iconOnly?: boolean
  description?: string
  relatedIcons?: LucideIcon[]
  onHover?: () => void
}) {
  const Icon = item.icon
  const urgent = alarm
  const LeftRelatedIcon = relatedIcons[0] !== Icon ? relatedIcons[0] : null
  const RightRelatedIcon = relatedIcons[1] !== Icon ? relatedIcons[1] : null
  const tooltipSurface = tone === "dark"
    ? "bg-nav-raised text-nav-text ring-nav-border before:border-nav-border before:bg-nav-raised"
    : "bg-white text-neutral-900 ring-neutral-200/80 before:border-neutral-200 before:bg-white"

  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      title={item.label}
      onMouseEnter={onHover}
      className={cn(
        "group relative",
        iconOnly ? "justify-center rounded-none px-0 hover:!bg-transparent" : "",
        rowClass(tone, active, Boolean(urgent)),
      )}
    >
      <Icon
        className={cn(
          cn(
            iconOnly ? "size-6" : "size-5",
            "shrink-0 transition-transform duration-200 ease-out group-hover:scale-[1.16]",
          ),
          urgent && "animate-sos-icon-blink",
        )}
        strokeWidth={active || urgent ? 2.2 : 1.8}
        fill="none"
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left text-[13px] leading-none",
          iconOnly && "sr-only",
          urgent || active ? "font-bold" : "font-medium",
        )}
      >
        {item.label}
      </span>

      {badge && badge > 0 && !iconOnly ? (
        <span
          className={cn(
            "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-pill px-1.5 text-[11px] leading-none tabular-nums",
            urgent ? "bg-white font-bold text-sos" : "bg-sos font-bold text-white",
            urgent && "flex items-center gap-1",
            iconOnly && "absolute right-8 top-1/2 -translate-y-1/2",
          )}
        >
          {urgent ? <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-sos" /> : null}
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      {iconOnly ? (
        <span className={cn("pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 w-52 -translate-y-1/2 translate-x-1 rounded-xl px-6 pb-5 pt-5 text-center opacity-0 shadow-[0_14px_35px_rgba(15,23,42,0.16)] ring-1 transition-[opacity,transform] duration-150 ease-out before:absolute before:left-[-6px] before:top-1/2 before:size-3 before:-translate-y-1/2 before:rotate-45 before:border-b before:border-l group-hover:translate-x-0 group-hover:opacity-100", tooltipSurface)}>
          <span className="flex items-center justify-center gap-2">
            {LeftRelatedIcon ? (
              <span
                key={`${item.key}-related-left`}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md",
                  tone === "dark"
                    ? "bg-nav-active text-nav-text-active"
                    : alarm
                    ? "bg-sos/10 text-sos/50"
                    : active
                      ? tone === "dark" ? "bg-nav-active text-nav-muted" : "bg-brand-navy/10 text-brand-navy/50"
                    : tone === "dark" ? "bg-nav-bg text-nav-muted" : "bg-neutral-100 text-neutral-400",
                )}
              >
                <LeftRelatedIcon className="size-4" strokeWidth={2} />
              </span>
            ) : null}
            <span
              className={cn(
                "relative flex size-9 items-center justify-center rounded-md text-white shadow-sm",
                tone === "dark"
                  ? "bg-nav-active text-nav-text-active"
                  : alarm
                  ? "bg-sos"
                  : active
                    ? tone === "dark" ? "bg-nav-active text-nav-text-active" : "bg-brand-navy"
                    : tone === "dark" ? "bg-nav-bg text-nav-muted" : "bg-neutral-200 text-neutral-700",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={2} />
            </span>
            {RightRelatedIcon ? (
              <span
                key={`${item.key}-related-right`}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md",
                  tone === "dark"
                    ? "bg-nav-active text-nav-text-active"
                    : alarm
                    ? "bg-sos/10 text-sos/50"
                    : active
                      ? tone === "dark" ? "bg-nav-active text-nav-muted" : "bg-brand-navy/10 text-brand-navy/50"
                    : tone === "dark" ? "bg-nav-bg text-nav-muted" : "bg-neutral-100 text-neutral-400",
                )}
              >
                <RightRelatedIcon className="size-4" strokeWidth={2} />
              </span>
            ) : null}
          </span>
          <span className="mt-3.5 block text-[14px] font-bold leading-tight">{item.label}</span>
          <span className={cn("mt-2 block text-[12px] leading-[1.45]", tone === "dark" ? "text-nav-muted" : "text-neutral-500")}>
            {description}
          </span>
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
  const tone: Tone = isResident || isOfficialRole ? "light" : "dark"

  const role = isResponderRole ? "responder" : isOfficialRole ? "official" : "resident"
  const nav = getRoleNav(role)
  const navItems = nav.items.filter((item) => hasCapability(user?.capabilities, item.capability))
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
  const avatarInitials = initials(user?.full_name || "Account").charAt(0)
  const rolePosition = displayPosition(user)
  const descriptions: Record<string, string> = {
    dispatch: "Handle emergency requests and coordinate the response.",
    shift: "View your duty status, unit, and shift record.",
    home: "See your latest updates, reports, and community activity.",
    alerts: "See nearby emergencies, alerts, and safety updates.",
    reports: "Track the concerns you submitted and their progress.",
    emergencies: "View urgent reports and responder requests.",
    overview: "See the barangay activity and current summary.",
    "alert-map": "View active alerts, locations, and boundaries.",
    "operations-map": "View active alerts, locations, and boundaries.",
    concerns: "Review resident reports and their progress.",
    community: "Manage public updates and resident activity.",
    configuration: "Set report rules, categories, and access.",
  }
  const relatedIcons: Record<string, LucideIcon[]> = {
    dispatch: [SirenIcon, MapPinIcon],
    shift: [CalendarDaysIcon, ClipboardListIcon],
    home: [CalendarDaysIcon, MessagesSquareIcon],
    alerts: [MapPinIcon, SirenIcon],
    reports: [FileUserIcon, MessagesSquareIcon],
    emergencies: [SirenIcon, BellRingIcon],
    overview: [FileChartColumnIcon, ChartSplineIcon],
    "operations-map": [MapPinIcon, MapIcon],
    alerts: [MapPinIcon, ShieldAlertIcon],
    concerns: [FileTextIcon, MessageSquareIcon],
    community: [UserRoundIcon, MegaphoneIcon],
    configuration: [SettingsIcon, ShieldAlertIcon],
  }

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
  const accountSurfaceClass = tone === "dark"
    ? "bg-nav-raised ring-nav-border before:border-nav-border before:bg-nav-raised"
    : "bg-white ring-neutral-200/80 before:border-neutral-200 before:bg-white"

  return (
    <aside
      className={cn(
        "relative flex h-full min-h-0 w-full flex-col overflow-visible bg-transparent",
      )}
    >
      <nav className={cn(
        "flex min-h-0 flex-1 flex-col overscroll-contain px-3 pt-6 [scrollbar-width:thin]",
        "overflow-visible",
        (isResident || isOfficialRole || isResponderRole) && "justify-center pt-0",
      )}>
        <ul className="flex flex-col gap-1.5">
          {navItems.map((item) => {
            const active = item.isActive(location.pathname)
            const badgeForItemValue = badgeForItem(item.key)
            const alarm = isAlarmItem(item.key, badgeForItemValue)
            return (
              <li key={item.key}>
                <SidebarRow
                  item={item}
                  tone={tone}
                  active={active}
                  badge={badgeForItemValue}
                  alarm={alarm}
                  iconOnly
                  description={descriptions[item.key] ?? `Open ${item.label.toLowerCase()}.`}
                  relatedIcons={relatedIcons[item.key]}
                  onHover={() => setOpen(false)}
                />
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Identity block pinned to the floor — avatar, name, role, sign out. */}
      <div className="relative shrink-0 px-3 pb-4 pt-2">
          <div>
          {open ? (
            <ul className={cn("absolute bottom-6 left-[calc(100%+6px)] z-50 flex w-52 flex-col gap-0.5 rounded-xl p-3 shadow-[0_14px_35px_rgba(15,23,42,0.16)] ring-1 before:absolute before:bottom-4 before:left-[-6px] before:size-3 before:rotate-45 before:border-b before:border-l", accountSurfaceClass)}>
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
                  <InboxIcon className={accountIconClass} strokeWidth={1.8} />
                  <span className="min-w-0 flex-1 truncate text-left font-medium">
                    Notifications
                  </span>
                  {unreadCount > 0 ? (
                    <span className="shrink-0 text-[11px] font-semibold leading-none text-current tabular-nums">
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
               (isResident || isOfficialRole) && "justify-center px-0",
               "",
            )}
          >
            <span
              className={cn(
                 "flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ring-1",
                 "bg-slate-soft text-navy-muted ring-transparent",
              )}
            >
              {avatarInitials}
            </span>
            <span
              className={cn(
                "flex min-w-0 flex-1 flex-col",
                "hidden",
              )}
            >
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
