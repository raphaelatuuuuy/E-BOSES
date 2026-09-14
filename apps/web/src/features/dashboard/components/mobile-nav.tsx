import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  ArrowLeftIcon,
  PlusIcon,
  TriangleAlert,
  UserCircleIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  isOfficialUser,
  isResponderUser,
  isResidentUser,
} from "@/features/auth/roles"
import { getActiveEmergency } from "@/features/dashboard/emergency-api"
import { getRoleNav, type NavItemConfig } from "@/features/dashboard/lib/navigation"
import { CAPABILITIES, hasCapability } from "@/features/dashboard/lib/capabilities"
import { useAssignedDispatches } from "@/features/dashboard/hooks/use-assigned-dispatches"
import { useOfficialBadges } from "@/features/dashboard/hooks/use-official-badges"
import { useOfficialUnitScope } from "@/features/dashboard/hooks/use-official-unit"
import { ACTIVE_EMERGENCY_STATUSES } from "@/features/dashboard/components/record/status"
import {
  OfficialNotificationsDialog,
  OfficialProfileDialog,
} from "@/features/dashboard/components/official/official-account-dialogs"

const OFFICIAL_CONFIGURATION_CAPABILITIES = [
  CAPABILITIES.manageUnits,
  CAPABILITIES.manageRoles,
  CAPABILITIES.manageUsers,
  CAPABILITIES.manageCategories,
  CAPABILITIES.configureClassification,
  CAPABILITIES.configureDispatch,
  CAPABILITIES.configureGeography,
] as const

function SosTab({ tab = false }: { tab?: boolean }) {
  const [activeEmergency, setActiveEmergency] = useState(false)
  const [shellOpen, setShellOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const alert = await getActiveEmergency()
        if (!cancelled) {
          setActiveEmergency(
            Boolean(alert && ACTIVE_EMERGENCY_STATUSES.has(String(alert.status))),
          )
        }
      } catch {
        if (!cancelled) setActiveEmergency(false)
      }
    })()
    function onChange(event: Event) {
      const active = (event as CustomEvent<{ active?: boolean }>).detail?.active
      setActiveEmergency(Boolean(active))
    }
    function onOpenChange(event: Event) {
      setShellOpen(Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open))
    }
    window.addEventListener("eboses:sos-active-change", onChange as EventListener)
    window.addEventListener("eboses:sos-open-change", onOpenChange as EventListener)
    return () => {
      cancelled = true
      window.removeEventListener("eboses:sos-active-change", onChange as EventListener)
      window.removeEventListener("eboses:sos-open-change", onOpenChange as EventListener)
    }
  }, [])

  const hot = activeEmergency || shellOpen

  if (tab) {
    return (
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("eboses:open-sos"))}
        aria-label={activeEmergency ? "Ongoing" : "Need help?"}
        aria-haspopup="dialog"
        aria-expanded={shellOpen}
        className={cn(
          "flex h-12 w-16 shrink-0 flex-col items-center justify-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2",
          hot ? "text-sos" : "text-neutral-400 hover:text-sos"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "material-symbols-outlined select-none text-[26px] leading-none",
            hot && "animate-sos-icon-blink"
          )}
        >
          sos
        </span>
        <span className="text-[11px] leading-none font-bold">
          {activeEmergency ? "Ongoing" : "Need help?"}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("eboses:open-sos"))}
      aria-label="SOS"
      aria-haspopup="dialog"
      aria-expanded={shellOpen}
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-[background-color,color,box-shadow,transform,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2",
        hot
          ? cn(
              "bg-gradient-to-b from-sos-bright to-sos text-white shadow-[0_6px_20px_rgba(242,59,53,0.38)]",
              activeEmergency && "animate-sos-fab-blink",
            )
          : "text-sos hover:bg-neutral-100 hover:text-sos-bright active:bg-neutral-200",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "material-symbols-outlined select-none text-2xl leading-none",
          hot && "animate-sos-icon-blink",
        )}
      >
        sos
      </span>
    </button>
  )
}

function ResponderBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const navItems = getRoleNav("responder").mobileItems
  const { activeAlerts } = useAssignedDispatches(true)
  const homeItem = navItems.find((item) => item.key === "overview")
  const alertsItem = navItems.find((item) => item.key === "alerts-map")
  const feedItem = navItems.find((item) => item.key === "feed")
  const criticalAlert = activeAlerts[0]

  return (
    <div data-mobile-nav className="pointer-events-none fixed right-0 bottom-0 left-0 z-30 lg:hidden">
      <div className="pointer-events-none flex items-end justify-center px-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
        <nav
          aria-label="Primary"
          className="pointer-events-auto flex w-full max-w-md items-center justify-around gap-1 rounded-[22px] border border-neutral-200 bg-white px-2 py-2.5 shadow-[0_10px_32px_rgba(15,23,42,0.14)]"
        >
          {homeItem ? (
            <LabeledMobileTab
              item={homeItem}
              active={homeItem.isActive(location.pathname)}
            />
          ) : null}
          {alertsItem ? (
            <CentralAlertTab
              item={alertsItem}
              active={alertsItem.isActive(location.pathname)}
              critical={Boolean(criticalAlert)}
              criticalLabel={
                criticalAlert
                  ? `Critical alert: ${criticalAlert.display_description || criticalAlert.type}`
                  : undefined
              }
              onClick={() => navigate("/dashboard/alerts-map")}
            />
          ) : null}
          {feedItem ? (
            <LabeledMobileTab
              item={feedItem}
              active={feedItem.isActive(location.pathname)}
            />
          ) : null}
        </nav>
      </div>
    </div>
  )
}

function LabeledMobileTab({
  item,
  active,
  critical = false,
  criticalLabel,
  onClick,
}: {
  item: NavItemConfig
  active: boolean
  critical?: boolean
  criticalLabel?: string
  onClick?: () => void
}) {
  const Icon = critical ? TriangleAlert : item.icon
  const label = critical
    ? criticalLabel ?? `Critical report: ${item.label}`
    : item.label
  const className = cn(
    "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2",
    critical
      ? "text-sos"
      : active
        ? "text-brand-orange"
        : "text-neutral-400 hover:text-neutral-700",
  )
  const icon = (
    <Icon
      className={cn("size-6 shrink-0", critical && "animate-sos-icon-blink")}
      strokeWidth={active || critical ? 2.4 : 1.8}
      fill="none"
      aria-hidden="true"
    />
  )
  const text = <span className="text-[11px] leading-none font-bold">{item.label}</span>

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={critical ? label : undefined}
        className={className}
      >
        {icon}
        {text}
      </button>
    )
  }

  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={critical ? label : undefined}
      className={className}
    >
      {icon}
      {text}
    </Link>
  )
}

function CentralAlertTab({
  item,
  active,
  critical,
  criticalLabel,
  onClick,
}: {
  item: NavItemConfig
  active: boolean
  critical: boolean
  criticalLabel?: string
  onClick: () => void
}) {
  const Icon = critical ? TriangleAlert : item.icon
  const label = critical
    ? criticalLabel ?? `Critical report: ${item.label}`
    : item.label
  const className = cn(
    "flex size-[56px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[16px] text-center transition-[background-color,box-shadow,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2",
    critical
      ? "bg-sos text-white shadow-[0_10px_24px_rgba(242,59,53,0.45)]"
      : "bg-brand-orange text-white shadow-[0_10px_24px_rgba(255,106,26,0.45)] hover:bg-brand-orange-strong",
  )
  const icon = (
    <Icon
      className={cn("size-6 shrink-0", critical && "animate-sos-icon-blink")}
      strokeWidth={active || critical ? 2.4 : 1.8}
      fill="none"
      aria-hidden="true"
    />
  )

  return critical ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={className}
    >
      {icon}
      <span className="text-[10px] leading-none font-bold">{item.label}</span>
    </button>
  ) : (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={className}
    >
      {icon}
      <span className="text-[10px] leading-none font-bold">{item.label}</span>
    </Link>
  )
}

function ResidentBar() {
  const location = useLocation()
  const navItems = getRoleNav("resident").mobileItems
  return (
    <div
      data-mobile-nav
      className="pointer-events-none fixed right-0 bottom-0 left-0 z-30 lg:hidden"
    >
      <div className="pointer-events-none flex items-end justify-center px-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
        <nav
          aria-label="Primary"
          className="pointer-events-auto flex w-full max-w-md items-center justify-around rounded-[22px] border border-neutral-200 bg-white px-2 py-2.5 shadow-[0_10px_32px_rgba(15,23,42,0.14)]"
        >
          {navItems.slice(0, 2).map((item) => {
            const active = item.isActive(location.pathname)
            const Icon = item.icon
            return (
              <Link
                key={item.key}
                to={item.to}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={cn(
                  "flex h-12 w-14 shrink-0 flex-col items-center justify-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2",
                  active
                    ? "text-brand-orange"
                    : "text-neutral-400 hover:text-neutral-700"
                )}
              >
                <Icon
                  className="size-6 shrink-0"
                  strokeWidth={active ? 2.4 : 1.8}
                  fill="none"
                  aria-hidden="true"
                />
                <span className="text-[11px] leading-none font-bold">
                  {item.label}
                </span>
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("eboses:open-report"))
            }
            aria-label="Report"
            className="flex size-[52px] shrink-0 items-center justify-center rounded-[17px] bg-brand-orange text-white shadow-[0_10px_24px_rgba(255,106,26,0.45)] transition-transform active:scale-95"
          >
            <PlusIcon
              className="size-6 shrink-0"
              strokeWidth={2.6}
              aria-hidden="true"
            />
          </button>
          {navItems.slice(2).map((item) => {
            const active = item.isActive(location.pathname)
            const Icon = item.icon
            return (
              <Link
                key={item.key}
                to={item.to}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={cn(
                  "flex h-12 w-14 shrink-0 flex-col items-center justify-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2",
                  active
                    ? "text-brand-orange"
                    : "text-neutral-400 hover:text-neutral-700"
                )}
              >
                <Icon
                  className="size-6 shrink-0"
                  strokeWidth={active ? 2.4 : 1.8}
                  fill="none"
                  aria-hidden="true"
                />
                <span className="text-[11px] leading-none font-bold">
                  {item.label}
                </span>
              </Link>
            )
          })}
          <SosTab tab />
        </nav>
      </div>
    </div>
  )
}

function PillTab({
  label,
  icon: Icon,
  to,
  active,
  onClick,
  open = false,
  ariaLabel,
  compact = false,
  alarmed = false,
  staffStyle = false,
}: {
  label: string
  icon: LucideIcon
  to?: string
  active: boolean
  onClick?: () => void
  open?: boolean
  ariaLabel?: string
  compact?: boolean
  alarmed?: boolean
  staffStyle?: boolean
}) {
  const className = cn(
    "flex h-12 shrink-0 items-center justify-center rounded-full transition-[width,padding,gap,background-color,color,box-shadow,transform,opacity] duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2",
    staffStyle
      ? alarmed
        ? "gap-1.5 px-4 text-sos"
        : active
          ? cn("gap-1.5 text-brand-navy", compact ? "px-3" : "px-4")
          : cn("text-neutral-500 hover:text-brand-navy", compact ? "w-11" : "w-12")
      : alarmed
        ? "bg-gradient-to-b from-sos-bright to-sos text-white shadow-[0_6px_20px_rgba(242,59,53,0.38)] animate-sos-glow-blink gap-1.5 px-4"
      : active
        ? cn("gap-1.5 bg-brand-navy text-white", compact ? "px-3" : "px-4")
        : cn(
            "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700",
            compact ? "w-11" : "w-12",
          ),
  )
  const labelSpan = (
    <span
      className={cn(
        "overflow-hidden whitespace-nowrap text-[12px] font-bold leading-none transition-[max-width,opacity] duration-300 ease-out",
        active ? (compact ? "max-w-20 opacity-100" : "max-w-24 opacity-100") : "max-w-0 opacity-0",
      )}
    >
      {label}
    </span>
  )
  if (to) {
    return (
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        aria-label={ariaLabel ?? label}
        className={className}
      >
        <Icon className={cn("size-5 shrink-0", alarmed && staffStyle && "animate-sos-icon-blink")} strokeWidth={active || alarmed ? 2.4 : 1.8} fill="none" aria-hidden="true" />
        {labelSpan}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={open ?? false}
      aria-label={ariaLabel ?? label}
      className={className}
    >
      <Icon className="size-5 shrink-0" strokeWidth={active || alarmed ? 2.4 : 1.8} fill="none" aria-hidden="true" />
      {labelSpan}
    </button>
  )
}

export function MobileNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuthSession()
  const [moreOpen, setMoreOpen] = useState(false)
  const [officialProfileOpen, setOfficialProfileOpen] = useState(false)
  const [officialNotificationsOpen, setOfficialNotificationsOpen] = useState(false)

  const isResponderRole = isResponderUser(user)
  const isOfficialRole = isOfficialUser(user)
  const isResident = isResidentUser(user)

  const nav = getRoleNav(isResponderRole ? "responder" : isOfficialRole ? "official" : "resident")
  const navItems = nav.mobileItems.filter((item) => hasCapability(user?.capabilities, item.capability))
  const more = nav.more
  const moreItems = more?.items.filter((item) => hasCapability(user?.capabilities, item.capability)) ?? []
  const moreActive = more ? more.isActive(location.pathname) : false
  const capabilities = user?.capabilities
  const hasConfigurationAccess =
    capabilities == null ||
    OFFICIAL_CONFIGURATION_CAPABILITIES.some((capability) => capabilities.includes(capability))

  const { selectedUnitId } = useOfficialUnitScope(user)
  const { criticalReport } = useOfficialBadges(isOfficialRole, selectedUnitId)

  if (isResponderRole) {
    return <ResponderBar />
  }

  if (
    isResident &&
    (location.state as { fromOverview?: boolean } | null)?.fromOverview ===
      true &&
    location.pathname.startsWith("/dashboard/reports")
  ) {
    return (
      <div
        data-mobile-nav
        className="pointer-events-none fixed right-0 bottom-0 left-0 z-30 lg:hidden"
      >
        <div className="pointer-events-none flex items-end justify-center px-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
          <button
            type="button"
            onClick={() => navigate("/dashboard/home")}
            className="pointer-events-auto inline-flex h-12 items-center gap-2 rounded-full border border-neutral-200 bg-white px-5 text-[14px] font-bold text-neutral-800 shadow-[0_10px_32px_rgba(15,23,42,0.14)]"
          >
            <ArrowLeftIcon className="size-5" strokeWidth={2.2} />
            Go back
          </button>
        </div>
      </div>
    )
  }

  if (isResident) {
    return <ResidentBar />
  }

  if (isOfficialRole) {
    const homeItem = navItems.find((item) => item.key === "overview")
    const feedItem = navItems.find((item) => item.key === "feed")
    const alertsItem = navItems.find((item) => item.key === "operations-map")
    const announceItem = navItems.find((item) => item.key === "community")
    const notificationItem = nav.account?.find((item) => item.key === "notifications")
    const profileItem: NavItemConfig = {
      key: "profile",
      label: "Profile",
      to: "#profile",
      icon: UserCircleIcon,
      isActive: () => false,
    }
    const MoreIcon = more?.icon
    const usePersonalMobileNav = !announceItem && !hasConfigurationAccess

    return (
      <>
        <div data-mobile-nav className="pointer-events-none fixed right-0 bottom-0 left-0 z-30 lg:hidden">
          <div className="pointer-events-none flex items-end justify-center px-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
            <nav
              className="pointer-events-auto flex w-full max-w-md items-center justify-around gap-1 rounded-[22px] border border-neutral-200 bg-white px-2 py-2.5 shadow-[0_10px_32px_rgba(15,23,42,0.14)]"
              aria-label="Primary"
            >
              {homeItem ? (
                <LabeledMobileTab
                  item={homeItem}
                  active={homeItem.isActive(location.pathname)}
                />
              ) : null}
              {feedItem ? (
                <LabeledMobileTab
                  item={feedItem}
                  active={feedItem.isActive(location.pathname)}
                />
              ) : null}
              {alertsItem ? (
                <CentralAlertTab
                  item={alertsItem}
                  active={alertsItem.isActive(location.pathname)}
                  critical={Boolean(criticalReport)}
                  criticalLabel={
                    criticalReport
                      ? `Critical report: ${criticalReport.title}`
                      : undefined
                  }
                  onClick={() => navigate("/dashboard/alerts-map")}
                />
              ) : null}
              {announceItem && !usePersonalMobileNav ? (
                <LabeledMobileTab
                  item={announceItem}
                  active={announceItem.isActive(location.pathname)}
                />
              ) : null}
              {usePersonalMobileNav && notificationItem ? (
                <LabeledMobileTab
                  item={notificationItem}
                  active={notificationItem.isActive(location.pathname)}
                  onClick={() => setOfficialNotificationsOpen(true)}
                />
              ) : null}
              {usePersonalMobileNav ? (
                <LabeledMobileTab
                  item={profileItem}
                  active={false}
                  onClick={() => setOfficialProfileOpen(true)}
                />
              ) : null}
              {!usePersonalMobileNav && more && MoreIcon && hasConfigurationAccess ? (
                <button
                  type="button"
                  onClick={() => navigate("/dashboard/configuration")}
                  aria-current={moreActive ? "page" : undefined}
                  aria-label={more.label}
                  className={cn(
                    "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2",
                    moreActive
                      ? "text-brand-orange"
                      : "text-neutral-400 hover:text-neutral-700",
                  )}
                >
                  <MoreIcon
                    className="size-6 shrink-0"
                    strokeWidth={moreActive ? 2.4 : 1.8}
                    aria-hidden="true"
                  />
                  <span className="text-[11px] leading-none font-bold">
                    {more.label}
                  </span>
                </button>
              ) : null}
            </nav>
          </div>
        </div>
        {usePersonalMobileNav ? (
          <>
            <OfficialProfileDialog
              open={officialProfileOpen}
              onOpenChange={setOfficialProfileOpen}
            />
            <OfficialNotificationsDialog
              open={officialNotificationsOpen}
              onOpenChange={setOfficialNotificationsOpen}
            />
          </>
        ) : null}
      </>
    )
  }

  return (
    <>
      <div data-mobile-nav className="pointer-events-none fixed bottom-0 left-0 right-0 z-30 lg:hidden">
        <div className="pointer-events-none flex items-end justify-center px-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]">

          <nav
            className="pointer-events-auto flex h-[3.75rem] items-center gap-1 rounded-full border border-neutral-300 bg-white px-2 shadow-[0_10px_32px_rgba(15,23,42,0.14)]"
            aria-label="Primary"
          >
            {navItems.map((item) => {
              const active = item.isActive(location.pathname)
              // Concerns owns the emergency queue in the official nav. Keep
              // the mobile tab in lockstep with the sidebar when a live
              // emergency is present.
              const emergencyConcernLive = false
              return (
                <PillTab
                  key={item.key}
                  label={item.label}
                  icon={emergencyConcernLive ? TriangleAlert : item.icon}
                  to={item.to}
                  active={active}
                  compact
                  alarmed={emergencyConcernLive}
                  staffStyle
                />
              )
            })}

            {more ? (
              <PillTab
                label={more.label}
                icon={more.icon}
                active={moreActive}
                open={moreOpen}
                onClick={() => setMoreOpen(true)}
                compact
                staffStyle
              />
            ) : null}
          </nav>
        </div>
      </div>

      {more ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent
            aria-label={`${more.label} navigation`}
            draggable
            className="rounded-t-[28px]"
          >
            <ul className="flex flex-col gap-0.5 px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
              {moreItems.map((item) => {
                const active = item.isActive(location.pathname)
                const Icon = item.icon
                return (
                  <li key={item.key}>
                    <Link
                      to={item.to}
                      onClick={() => setMoreOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-12 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors",
                        active
                          ? "font-semibold text-brand-navy"
                          : "font-medium text-neutral-700 hover:bg-neutral-50 hover:text-brand-navy",
                      )}
                    >
                      <Icon className="size-5 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  )
}
