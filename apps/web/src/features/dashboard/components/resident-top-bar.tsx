import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { geocodeCommunityStreet } from "@/features/auth/lib/forward-geocode"
import { getResidentDashboardSummary } from "@/features/dashboard/api"
import {
  LiveDot,
  liveDotAriaLabel,
} from "@/features/dashboard/components/home/live-dot"
import {
  ResidentNotificationsButton,
  ResidentProfileDialog,
} from "@/features/dashboard/components/resident/resident-account-dialogs"
import { openSettingsDialog } from "@/features/dashboard/components/settings/settings-event"
import { streetLabelFromAddress } from "@/features/dashboard/components/feed-post-text"
import { railLiveMapSrc } from "@/features/dashboard/components/home/home-style"
import {
  CONTENT_GAP,
  CONTENT_MAX,
  DESKTOP_MIN_PX,
  FEED_MAX,
  LAYOUT_MIN,
  RAIL_W,
  SEARCH_MAX,
  SIDEBAR_MIN,
  SIDEBAR_W,
} from "@/features/dashboard/lib/shell"

/**
 * Layout constants moved to `lib/shell.ts` (single source of truth for the
 * dashboard shell). Re-exported here under their historical `RESIDENT_*`
 * names so existing consumers (home.tsx, notifications.tsx,
 * profile-account-menu.tsx, resident-alerts-map.tsx) keep working unchanged.
 */
export const RESIDENT_FEED_MAX = FEED_MAX
export const RESIDENT_SIDEBAR_W = SIDEBAR_W
export const RESIDENT_SIDEBAR_MIN = SIDEBAR_MIN
export const RESIDENT_RAIL_W = RAIL_W
export const RESIDENT_SEARCH_MAX = SEARCH_MAX
export const RESIDENT_CONTENT_GAP = CONTENT_GAP
export const RESIDENT_CONTENT_MAX = CONTENT_MAX
export const RESIDENT_LAYOUT_MIN = LAYOUT_MIN
export const RESIDENT_DESKTOP_MIN_PX = DESKTOP_MIN_PX

/**
 * Shared feed|rail grid for home body (composer + rail cards).
 */
export function ResidentContentGrid({
  children,
  className = "",
  align = "start",
}: {
  children: React.ReactNode
  className?: string
  align?: "start" | "center"
}) {
  return (
    <div
      className={className}
      style={{
        display: "grid",
        width: "100%",
        maxWidth: RESIDENT_CONTENT_MAX,
        marginLeft: "auto",
        marginRight: "auto",
        gridTemplateColumns: `minmax(0, ${RESIDENT_FEED_MAX}px) minmax(0, ${RESIDENT_RAIL_W}px)`,
        columnGap: RESIDENT_CONTENT_GAP,
        alignItems: align,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Resident mobile header (shell) — brand logo + bell + avatar, so the left
 * sidebar does not duplicate account access on the phone. Mirrors the staff
 * mobile header; home ships its own header (live map dot + search) instead.
 */
export function ResidentMobileHeader({
  homeTo = "/dashboard/home",
  divider = true,
}: {
  homeTo?: string
  divider?: boolean
}) {
  const { user } = useAuthSession()
  const [profileOpen, setProfileOpen] = useState(false)
  const avatarInitials = initials(user?.full_name || "Resident").charAt(0)
  const community = (user?.barangay || "Your community").replace(
    /^Barangay\s+/i,
    ""
  )
  const [railMap, setRailMap] = useState({ lat: 14.5995, lng: 120.9842 })
  const [activeEmergencies, setActiveEmergencies] = useState(0)

  useEffect(() => {
    let cancelled = false
    getResidentDashboardSummary()
      .then((summary) => {
        if (!cancelled)
          setActiveEmergencies(summary?.barangay_active_emergencies ?? 0)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function resolveRailMap() {
      const street = streetLabelFromAddress(user?.address)
      if (!street) return
      const hit = await geocodeCommunityStreet(street, community)
      if (!cancelled && hit) setRailMap({ lat: hit.lat, lng: hit.lng })
    }
    void resolveRailMap()
    return () => {
      cancelled = true
    }
  }, [community, user?.address])

  return (
    <header
      className={cn(
        "sticky top-0 z-40 mt-5 flex h-14 shrink-0 items-center gap-2 bg-white px-3",
        divider && "border-b border-neutral-200"
      )}
    >
      <LiveDot
        src={railLiveMapSrc(railMap.lat, railMap.lng)}
        alert={activeEmergencies > 0}
        label={liveDotAriaLabel(
          community,
          activeEmergencies > 0,
          activeEmergencies
        )}
        to="/dashboard/alerts-map"
      />
      <Link
        to={homeTo}
        className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-tight text-neutral-900 no-underline"
      >
        {community}
      </Link>
      <div className="flex items-center gap-0.5">
        <ResidentNotificationsButton />
        <button
          type="button"
          onClick={() => openSettingsDialog()}
          aria-label="Open settings"
          className="flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-neutral-50"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-slate-soft text-[14px] font-bold text-navy-muted">
            {avatarInitials}
          </span>
        </button>
      </div>
      <ResidentProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        onOpenSettings={(closeDialog) => {
          closeDialog()
          openSettingsDialog()
        }}
      />
    </header>
  )
}

/** @deprecated resident should not used to be a shell top bar — see ResidentMobileHeader. */
export function ResidentTopBar() {
  return <ResidentMobileHeader />
}

/** Logo block — same horizontal inset as sidebar nav buttons */
export function ResidentLogoBar({
  homeTo = "/dashboard/home",
  tone = "light",
  compact = false,
}: {
  homeTo?: string
  /** `dark` renders on the navy staff rail; `light` on the white resident shell. */
  tone?: "light" | "dark"
  compact?: boolean
}) {
  const { user } = useAuthSession()
  const communityName = (user?.barangay || "Community").replace(/^Barangay\s+/i, "")
  // Navy staff panel — same lockup as the light shell, recoloured for the dark
  // surface (ref 8 "AeuxGlobal": mark + wordmark, white on near-black).
  if (tone === "dark") {
    return (
      <div className={cn("flex h-16 shrink-0 items-center px-3", compact && "justify-center px-2")}>
        <Link
          to={homeTo}
          className={cn("flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-1.5 no-underline transition-colors hover:bg-nav-raised", compact && "justify-center gap-0")}
        >
          <img
            src="/contents/logo.webp"
            alt="Boses community portal"
            className="size-8 shrink-0 object-contain"
          />
          <span className={cn("flex min-w-0 flex-col", compact && "hidden")}>
            <span className="truncate text-[19px] font-bold leading-none tracking-tight text-brand-orange">
              Boses
            </span>
            <span className="mt-0.5 truncate text-[10px] font-semibold leading-tight tracking-wide text-nav-muted">
              {communityName}
            </span>
          </span>
        </Link>
      </div>
    )
  }

  return (
    <div className={cn("flex h-14 shrink-0 items-center px-3", compact && "justify-center px-2")}>
      <Link
        to={homeTo}
        className={cn("flex min-w-0 items-center gap-2 rounded-lg px-2.5 no-underline", compact && "justify-center gap-0")}
      >
        <img src="/contents/logo.webp" alt="Boses community portal" className="size-9 shrink-0 object-contain" />
        <div className={cn("flex min-w-0 flex-col", compact && "hidden")}>
          <span className="truncate text-[26px] font-bold leading-none tracking-tight text-brand-orange">
            Boses
          </span>
          <span className="truncate text-[11px] font-bold leading-tight tracking-wide text-brand-navy">
            {communityName}
          </span>
        </div>
      </Link>
    </div>
  )
}
