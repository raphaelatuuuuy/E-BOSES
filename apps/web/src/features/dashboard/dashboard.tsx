import * as React from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"

import { Sidebar } from "@/features/dashboard/components/sidebar"
import { SidebarProvider } from "@/features/dashboard/components/sidebar-context"
import { SOSButton } from "@/features/dashboard/components/sos-button"
import { useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import { MobileNav } from "@/features/dashboard/components/mobile-nav"
import { StaffMobileHeader } from "@/features/dashboard/components/mobile-header"
import { useLocationPing } from "@/features/dashboard/hooks/use-location-ping"
import { NotificationProvider, fetchConcern } from "@/features/dashboard/components/notification-context"
import { ReportStatusDialog } from "@/features/dashboard/components/report-status-dialog"
import { statusModeFromReport } from "@/features/dashboard/components/report-status-mode"
import { SettingsPopGate } from "@/features/dashboard/components/settings/settings-gate"
import {
  ResidentLogoBar,
  ResidentMobileHeader,
} from "@/features/dashboard/components/resident-top-bar"
import {
  getRouteChrome,
  useIsDesktop,
  SHELL_MAX_RESIDENT,
  SHELL_MAX_STAFF,
  SIDEBAR_W,
} from "@/features/dashboard/lib/shell"
import type { StatusDialogMode } from "@/features/dashboard/components/report-status-mode"
import type { Concern } from "@/features/dashboard/api"

function DashboardContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const isDesktop = useIsDesktop()
  const { user } = useAuthSession()
  useLocationPing(user)
  const isStaffRole =
    user?.role === "barangay_official" ||
    user?.role === "first_responder" ||
    user?.is_staff ||
    user?.is_superuser
  const isResident = !isStaffRole
  const isOfficialRole = isOfficialUser(user)
  const isMobile = !isDesktop
  const chrome = getRouteChrome(location.pathname)
  const hideMobileNav = isMobile && chrome.hideMobileNav

  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false)
  const [statusDialogMode, setStatusDialogMode] = React.useState<StatusDialogMode>("submitted")
  const [statusDialogReport, setStatusDialogReport] = React.useState<Concern | null>(null)

  async function handleNotificationClick(concernId: number) {
    try {
      const concern = await fetchConcern(concernId)
      setStatusDialogReport(concern)
      setStatusDialogMode(statusModeFromReport(concern))
      setStatusDialogOpen(true)
    } catch {
      // silently fail
    }
  }

  React.useEffect(() => {
    function onEvent(e: CustomEvent<{ concernId: number; mode: StatusDialogMode }>) {
      void handleNotificationClick(e.detail.concernId)
    }
    window.addEventListener("eboses:open-status-dialog", onEvent as EventListener)
    return () => window.removeEventListener("eboses:open-status-dialog", onEvent as EventListener)
  }, [])

  const shellHome = isResident
    ? "/dashboard/home"
    : user?.role === "first_responder"
      ? "/dashboard/responders/dispatch"
      : "/dashboard/alerts-map"

  const statusDialog = statusDialogReport ? (
    <ReportStatusDialog
      open={statusDialogOpen}
      onOpenChange={setStatusDialogOpen}
      report={statusDialogReport}
      mode={statusDialogMode}
      onTrack={() =>
        navigate(
          isResident
            ? `/dashboard/reports/${statusDialogReport.public_id}`
            : `/dashboard/reports/${statusDialogReport.id}`,
        )
      }
    />
  ) : null

  // The staff console runs on the light navy/orange palette.
  //
  // A dark variant of the same token names lives in globals.css as
  // `.staff-dark`; applying that class to this wrapper is the entire switch,
  // because every official/responder screen is written against semantic tokens
  // (`bg-card`, `border-card-line`, `text-muted-foreground`) rather than
  // literal colours. Currently applied to responders only; officials stay
  // light until their screens are migrated off hardcoded light colours.
  const isResponder = Boolean(!isResident && user && isResponderUser(user))
  const shellScope = isResponder ? "staff-dark" : undefined
  const shellBg = isResident ? "bg-white" : isOfficialRole ? "portal-gradient" : "bg-canvas"

  // Triage routes own their vertical space (see RouteChrome.workspace). Below
  // the desktop breakpoint they revert to a scrolling column, so the flag only
  // applies on desktop.
  const isWorkspaceRoute = chrome.workspace && isDesktop

  return (
    <div className={cn("min-h-svh overflow-x-hidden", shellScope, shellBg)}>
        <div
          className={cn("mx-auto min-h-svh w-full", shellBg)}
          style={{
            maxWidth: isResident ? SHELL_MAX_RESIDENT : SHELL_MAX_STAFF,
            minWidth: 0,
          }}
        >
          {isDesktop ? (
            <div
              className="grid h-svh max-h-svh min-h-0 overflow-visible"
              style={{
                  // Every role uses the same compact icon rail.
                  gridTemplateColumns: `${isResident || isOfficialRole || isResponder ? 72 : SIDEBAR_W}px minmax(0, 1fr)`,
              }}
            >
               <div
                className={cn(
                  "flex h-full min-h-0 min-w-0 flex-col overflow-visible",
                  isResident ? "bg-white" : "bg-transparent",
                )}
              >
                 <ResidentLogoBar homeTo={shellHome} tone={isResident || isOfficialRole ? "light" : "dark"} compact={isResident || isOfficialRole || isResponder} />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-visible">
                  <Sidebar />
                </div>
              </div>

              {/* The resident top bar (search / bell / avatar) is gone — those
                  live in the shared sidebar now, and pages own their search. */}
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                <main
                  className={cn(
                    "min-h-0 min-w-0 flex-1 overflow-x-hidden [scrollbar-width:thin]",
                    isResident ? "bg-white" : "bg-transparent",
                    // Workspace routes scroll inside their own panes, so the
                    // shell must not add a second scroll container around them.
                    isWorkspaceRoute
                      ? "overflow-hidden"
                      : "overflow-y-auto overscroll-contain",
                  )}
                >
                  <Outlet />
                </main>
              </div>
            </div>
          ) : (
            <main
              className={cn(
                "flex min-h-svh min-w-0 flex-col",
                hideMobileNav || chrome.fullBleedMap ? "overflow-hidden" : "overflow-x-hidden pb-24",
                // Staff pages are card-on-canvas; residents stay on white and
                // officials float on the portal gradient.
                isResident
                  ? "bg-white"
                  : isOfficialRole
                    ? "portal-gradient"
                    : chrome.fullBleedMap
                      ? "bg-white"
                      : "bg-canvas",
              )}
            >
              {/* Full-bleed maps carry their own top bar and own the viewport
                  height, so the shell header stays out of their way. This is
                  keyed off the map flag rather than `hideMobileNav`, which the
                  responder map no longer sets. */}
              {!hideMobileNav && !chrome.fullBleedMap ? (
                isResident ? (
                  // Home renders its own mobile header (live-map dot + search),
                  // so only the other resident pages get the shell one with bell.
                  location.pathname === "/dashboard" ||
                  location.pathname === "/dashboard/" ||
                  location.pathname === "/dashboard/home" ? null : (
                    <ResidentMobileHeader homeTo={shellHome} />
                  )
                ) : (
                  <StaffMobileHeader homeTo={shellHome} tone={isResponder ? "dark" : "light"} />
                )
              ) : null}
              <Outlet />
            </main>
          )}
        </div>

        {isMobile && !hideMobileNav ? <MobileNav /> : null}

        {isResident ? (
          <SOSButton suppressed={chrome.fullBleedMap} />
        ) : null}

        {statusDialog}
        <SettingsPopGate />
      </div>
  )
}

export default function DashboardLayout() {
  return (
    <NotificationProvider>
      <SidebarProvider>
        <DashboardContent />
      </SidebarProvider>
    </NotificationProvider>
  )
}
