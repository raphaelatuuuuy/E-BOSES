import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  BarChart3Icon,
  ClockIcon,
  HomeIcon,
  MapPinnedIcon,
  PhoneIcon,
  SearchIcon,
  Settings2Icon,
  ClipboardListIcon,
  BellIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import { getActiveEmergency } from "@/features/dashboard/emergency-api"

type NavItem = {
  label: string
  path: string | null
  icon?: typeof HomeIcon
}

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
          "flex size-14 flex-col items-center justify-center gap-0.5 rounded-full bg-gradient-to-b from-[#ff625a] to-[#f23b35] text-white shadow-[0_6px_20px_rgba(242,59,53,0.38)]",
          activeEmergency && "sos-fab-blink",
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

  const isResponderRole = isResponderUser(user)
  const isOfficialRole = isOfficialUser(user)
  const isResident = !isOfficialRole && !isResponderRole

  const officialItems: NavItem[] = [
    { label: "Alert", path: "/dashboard/alerts-map", icon: MapPinnedIcon },
    { label: "Concerns", path: "/dashboard/reports", icon: BarChart3Icon },
    { label: "Configuration", path: "/dashboard/configuration/id-proof-template", icon: Settings2Icon },
  ]

  const responderItems: NavItem[] = [
    { label: "Map", path: "/dashboard/responders/map", icon: MapPinnedIcon },
    { label: "Shift", path: "/dashboard/responders/shift", icon: ClockIcon },
  ]

  const residentItems: NavItem[] = [
    { label: "Home", path: "/dashboard/home", icon: HomeIcon },
    { label: "Reports", path: "/dashboard/reports", icon: ClipboardListIcon },
    { label: "Alerts", path: "/dashboard/alerts-map", icon: BellIcon },
  ]

  const navItems = isResponderRole
    ? responderItems
    : isOfficialRole
      ? officialItems
      : residentItems

  return (
    <>
      <style>{`
        @keyframes sos-fab-blink {
          0%, 100% { box-shadow: 0 6px 20px rgba(242, 59, 53, 0.38); transform: scale(1); }
          50% { box-shadow: 0 8px 26px rgba(242, 59, 53, 0.5), 0 0 0 10px rgba(242, 59, 53, 0.1); transform: scale(1.04); }
        }
        .sos-fab-blink { animation: sos-fab-blink 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .sos-fab-blink { animation: none; }
        }
      `}</style>

      <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-30 lg:hidden">
        <div className="pointer-events-none flex items-end justify-center gap-3 px-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
          {/* Resident: pill width follows Home/Reports/Alerts content. Others: wider bar. */}
          <nav
            className={cn(
              "pointer-events-auto flex h-[3.75rem] items-center gap-1 rounded-full border-2 border-neutral-300/90 bg-[#eef0f4] px-2 shadow-[0_10px_32px_rgba(15,23,42,0.18)]",
              isResident
                ? "w-auto shrink-0"
                : "w-full max-w-lg justify-evenly gap-0.5 px-1.5",
            )}
            aria-label="Primary"
          >
            {navItems.map((item) => {
              const active = item.path
                ? location.pathname === item.path ||
                  location.pathname.startsWith(`${item.path}/`) ||
                  (item.path === "/dashboard/home" &&
                    location.pathname === "/dashboard") ||
                  (item.path === "/dashboard/reports" &&
                    location.pathname.startsWith("/dashboard/reports")) ||
                  (item.path === "/dashboard/configuration/id-proof-template" &&
                    (location.pathname.startsWith("/dashboard/configuration") ||
                      location.pathname.startsWith("/dashboard/configuration/map-dispatch") ||
                      location.pathname.startsWith("/dashboard/ocr-templates") ||
                      location.pathname.startsWith("/dashboard/verification-queue") ||
                      location.pathname.startsWith("/dashboard/concern-classification") ||
                      location.pathname.startsWith("/dashboard/admin")))
                : false

              const Icon = item.icon ?? SearchIcon
              return (
                <Link
                  key={item.path ?? item.label}
                  to={item.path!}
                  className={cn(
                    "group flex h-12 flex-col items-center justify-center gap-0.5 rounded-full transition-colors",
                    isResident
                      ? "w-auto shrink-0 px-3"
                      : "min-w-0 flex-1 px-1",
                    active
                      ? "text-[#07145f]"
                      : "text-neutral-500 hover:text-neutral-700",
                  )}
                >
                  <Icon className="size-5" />
                  <span className="text-[10px] font-medium leading-none">{item.label}</span>
                </Link>
              )
            })}
          </nav>

          {isResident ? <SosFab /> : null}
        </div>
      </div>
    </>
  )
}
