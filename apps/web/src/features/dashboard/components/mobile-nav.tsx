import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { PhoneIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import { useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import { getActiveEmergency } from "@/features/dashboard/emergency-api"
import { useAssignedDispatches } from "@/features/dashboard/hooks/use-assigned-dispatches"
import { getRoleNav } from "@/features/dashboard/lib/navigation"

const ACTIVE_EMERGENCY = new Set([
  "submitted",
  "routed",
  "acknowledged",
  "en_route",
  "nearby",
  "arrived",
])

function SosFab() {
  const [activeEmergency, setActiveEmergency] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const alert = await getActiveEmergency()
        if (!cancelled) {
          setActiveEmergency(
            Boolean(alert && ACTIVE_EMERGENCY.has(String(alert.status))),
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
    window.addEventListener("eboses:sos-active-change", onChange as EventListener)
    return () => {
      cancelled = true
      window.removeEventListener("eboses:sos-active-change", onChange as EventListener)
    }
  }, [])

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("eboses:open-sos"))}
      className="pointer-events-auto flex w-14 shrink-0 items-end justify-center"
      aria-label="SOS"
    >
      <span
        className={cn(
          "flex size-14 flex-col items-center justify-center gap-0.5 rounded-full bg-gradient-to-b from-sos-bright to-sos text-white shadow-[0_6px_20px_rgba(242,59,53,0.38)]",
          activeEmergency && "animate-sos-fab-blink",
        )}
      >
        <PhoneIcon className="size-5 shrink-0" fill="currentColor" />
        <span className="text-[10px] font-extrabold leading-none tracking-wide text-white">
          SOS
        </span>
      </span>
    </button>
  )
}

/**
 * The responder's bottom bar.
 *
 * A flush, full-width dark bar with four equal tabs — the reference layout —
 * replacing the floating two-item pill that had the Dispatch button hanging
 * off its side. The active tab is a filled orange block with the icon over its
 * label, and Dispatch turns red and carries its live count when something is
 * assigned, which is how urgency survives folding that button into the bar.
 *
 * Filled-orange text is `brand-orange-ink` (near-black): white on #ff6a1a is
 * 2.86:1 and fails AA. See globals.css.
 */
function ResponderBar() {
  const location = useLocation()
  const navItems = getRoleNav("responder").mobileItems
  const { activeAlerts } = useAssignedDispatches(true)
  const liveCount = activeAlerts.length

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-auto flex h-16 w-full items-stretch gap-1 border-t border-nav-border bg-nav-bg px-2 pb-[env(safe-area-inset-bottom)]"
    >
      {navItems.map((item) => {
        const active = item.isActive(location.pathname)
        const Icon = item.icon
        const isDispatch = item.key === "dispatch"
        const alarm = isDispatch && liveCount > 0
        // Dispatch keeps its red identity in both active and idle-alarm states;
        // it never turns brand-orange, which would let it get lost in the row.
        const activeClass = isDispatch
          ? "bg-sos/20 text-sos ring-1 ring-sos/40"
          : "bg-nav-raised text-nav-text-active"
        const alarmClass = "animate-sos-glow-blink bg-sos/15 text-sos"

        return (
          <Link
            key={item.key}
            to={item.to}
            aria-current={active ? "page" : undefined}
            aria-label={
              alarm ? `${item.label}, ${liveCount} active` : item.label
            }
            className={cn(
              "relative my-2 flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl transition-colors",
              active
                ? activeClass
                : alarm
                  ? alarmClass
                  : "text-nav-muted active:bg-nav-raised",
            )}
          >
            <span className="relative">
              <Icon
                className="size-5"
                strokeWidth={active || alarm ? 2.2 : 1.8}
                fill="none"
              />
              {alarm && !active ? (
                <span className="absolute -right-2 -top-1.5 flex size-4 min-w-4 items-center justify-center rounded-full bg-sos px-1 text-[10px] font-black leading-none text-white tabular-nums">
                  {liveCount > 9 ? "9+" : liveCount}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "max-w-full truncate text-[10.5px] leading-none",
                active || alarm ? "font-bold" : "font-medium",
              )}
            >
              {item.label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}

export function MobileNav() {
  const location = useLocation()
  const { user } = useAuthSession()
  const [moreOpen, setMoreOpen] = useState(false)

  const isResponderRole = isResponderUser(user)
  const isOfficialRole = isOfficialUser(user)
  const isResident = !isOfficialRole && !isResponderRole

  const nav = getRoleNav(isResponderRole ? "responder" : isOfficialRole ? "official" : "resident")
  const navItems = nav.mobileItems
  const more = nav.more
  const moreActive = more ? more.isActive(location.pathname) : false

  // The responder bar is flush to the viewport floor and full width, so it
  // does not share the floating-pill container the other two roles use.
  if (isResponderRole) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-30 lg:hidden">
        <ResponderBar />
      </div>
    )
  }

  return (
    <>
      <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-30 lg:hidden">
        <div className="pointer-events-none flex items-end justify-center gap-3 px-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
          {/*
            The resident sizes the pill to its content so the SOS button sits
            beside it on the same line. The official's four tabs need the
            width, so theirs stays a full bar.
          */}
          <nav
            className={cn(
              "pointer-events-auto flex h-[3.75rem] items-center gap-1 rounded-full px-2",
              "border-2 border-neutral-300/90 bg-[#eef0f4] shadow-[0_10px_32px_rgba(15,23,42,0.18)]",
              isResident ? "w-auto shrink-0" : "w-full max-w-lg justify-evenly gap-0.5 px-1.5",
            )}
            aria-label="Primary"
          >
            {navItems.map((item) => {
              const active = item.isActive(location.pathname)
              const Icon = item.icon
              return (
                <Link
                  key={item.key}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex h-12 flex-col items-center justify-center gap-0.5 rounded-full transition-colors",
                    isResident ? "w-auto shrink-0 px-4" : "min-w-0 flex-1 px-1",
                    active
                      ? "text-brand-navy"
                      : "text-neutral-500 hover:text-neutral-700",
                  )}
                >
                  <Icon className="size-5" />
                  <span className="text-[10px] font-medium leading-none">{item.label}</span>
                </Link>
              )
            })}

            {more ? (
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                className={cn(
                  "group flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 transition-colors",
                  moreActive ? "text-brand-navy" : "text-neutral-500 hover:text-neutral-700",
                )}
              >
                <more.icon className="size-5" />
                <span className="text-[10px] font-medium leading-none">{more.label}</span>
              </button>
            ) : null}
          </nav>

          {isResident ? <SosFab /> : null}
        </div>
      </div>

      {more ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent aria-label={`${more.label} navigation`}>
            <SheetHeader>
              <SheetTitle>{more.label}</SheetTitle>
            </SheetHeader>
            <ul className="flex flex-col gap-0.5 px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
              {more.items.map((item) => {
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
                          ? "bg-brand-orange-soft font-semibold text-brand-navy"
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
