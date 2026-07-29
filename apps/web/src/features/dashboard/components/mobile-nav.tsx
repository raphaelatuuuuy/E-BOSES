import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { PhoneIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import { useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import { getActiveEmergency } from "@/features/dashboard/emergency-api"
import { ResponderDispatchButton } from "@/features/dashboard/components/responder-dispatch-fab"
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

  return (
    <>
      <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-30 lg:hidden">
        <div className="pointer-events-none flex items-end justify-center gap-3 px-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
          {/*
            Resident and responder size the pill to its content so an action
            button sits beside it on the same line — SOS for the resident,
            Dispatch for the responder. The official's four tabs need the width,
            so theirs stays a full bar.

            The responder shell runs on the dark ops palette, so their pill wears
            the rail tokens; the resident and official shells stay light.
          */}
          <nav
            className={cn(
              "pointer-events-auto flex h-[3.75rem] items-center gap-1 rounded-full px-2",
              isResponderRole
                ? "w-auto shrink-0 border border-rail-line bg-nav-glass shadow-2xl backdrop-blur"
                : "border-2 border-neutral-300/90 bg-[#eef0f4] shadow-[0_10px_32px_rgba(15,23,42,0.18)]",
              !isResponderRole &&
                (isResident ? "w-auto shrink-0" : "w-full max-w-lg justify-evenly gap-0.5 px-1.5"),
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
                    isResident || isResponderRole
                      ? "w-auto shrink-0 px-4"
                      : "min-w-0 flex-1 px-1",
                    isResponderRole
                      ? active
                        ? "text-brand-orange"
                        : "text-nav-muted hover:text-nav-text-active"
                      : active
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
          {isResponderRole ? (
            <div className="pointer-events-auto">
              <ResponderDispatchButton />
            </div>
          ) : null}
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
