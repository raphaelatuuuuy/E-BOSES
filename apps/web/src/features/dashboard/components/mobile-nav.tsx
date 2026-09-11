import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { TriangleAlert, type LucideIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  isOfficialUser,
  isResponderUser,
  isResidentUser,
} from "@/features/auth/roles"
import { getActiveEmergency } from "@/features/dashboard/emergency-api"
import { getRoleNav } from "@/features/dashboard/lib/navigation"
import { CAPABILITIES, hasCapability } from "@/features/dashboard/lib/capabilities"
import { useAssignedDispatches } from "@/features/dashboard/hooks/use-assigned-dispatches"
import { useOfficialBadges } from "@/features/dashboard/hooks/use-official-badges"
import { ACTIVE_EMERGENCY_STATUSES } from "@/features/dashboard/components/record/status"

function SosTab() {
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
  const navItems = getRoleNav("responder").mobileItems
  const { activeAlerts } = useAssignedDispatches(true)
  const liveCount = activeAlerts.length

  return (
    <div data-mobile-nav className="pointer-events-none fixed bottom-0 left-0 right-0 z-30 lg:hidden">
      <div className="pointer-events-none flex items-end justify-center px-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
        <nav
          aria-label="Primary"
          className={cn(
            "pointer-events-auto flex h-[3.75rem] w-auto shrink-0 items-center gap-1 rounded-full border border-neutral-300 bg-white px-2 shadow-[0_10px_32px_rgba(15,23,42,0.14)]",
          )}
        >
          {navItems.map((item) => {
            const active = item.isActive(location.pathname)
            const alarmed = item.key === "concerns" && liveCount > 0
            return (
              <PillTab
                key={item.key}
                label={item.label}
                icon={alarmed ? TriangleAlert : item.icon}
                to={item.to}
                active={active}
                compact
                alarmed={alarmed}
                staffStyle
              />
            )
          })}
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
  const { user } = useAuthSession()
  const [moreOpen, setMoreOpen] = useState(false)

  const isResponderRole = isResponderUser(user)
  const isOfficialRole = isOfficialUser(user)
  const isResident = isResidentUser(user)

  const nav = getRoleNav(isResponderRole ? "responder" : isOfficialRole ? "official" : "resident")
  const navItems = nav.mobileItems.filter((item) => hasCapability(user?.capabilities, item.capability))
  const more = nav.more
  const moreItems = more?.items.filter((item) => hasCapability(user?.capabilities, item.capability)) ?? []
  const moreActive = more ? more.isActive(location.pathname) : false

  const activeEmergencies = useOfficialBadges(isOfficialRole).emergencies ?? 0

  if (isResponderRole) {
    return <ResponderBar />
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
              const emergencyConcernLive =
                isOfficialRole &&
                item.key === "concerns" &&
                // Only blink when this account's Concerns queue can actually
                // show the emergencies — the queue endpoint requires the
                // dispatch capability, and without it "Urgent cases" is
                // always empty even though the summary counts them.
                hasCapability(
                  user?.capabilities,
                  CAPABILITIES.dispatchEmergencies
                ) &&
                activeEmergencies > 0
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

            {isResident ? <SosTab /> : null}
          </nav>
        </div>
      </div>

      {more ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent aria-label={`${more.label} navigation`}>
            <SheetHeader>
              <SheetTitle>{more.label}</SheetTitle>
            </SheetHeader>
            <ul className="flex flex-col gap-0.5 px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
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
