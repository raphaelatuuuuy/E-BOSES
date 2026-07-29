import * as React from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"

import { Sidebar } from "@/features/dashboard/components/sidebar"
import { SidebarProvider } from "@/features/dashboard/components/sidebar-context"
import { SOSButton } from "@/features/dashboard/components/sos-button"
import { useAuthSession } from "@/features/auth/auth-session"
import { isResponderUser } from "@/features/auth/roles"
import { MobileNav } from "@/features/dashboard/components/mobile-nav"
import { StaffMobileHeader } from "@/features/dashboard/components/mobile-header"
import { ResponderDispatchFab } from "@/features/dashboard/components/responder-dispatch-fab"
import { useLocationPing } from "@/features/dashboard/hooks/use-location-ping"
import { NotificationProvider, fetchConcern } from "@/features/dashboard/components/notification-context"
import { ReportStatusDialog, statusModeFromReport } from "@/features/dashboard/components/report-status-dialog"
import { ResidentSearchProvider } from "@/features/dashboard/components/resident-search-context"
import {
  ResidentLogoBar,
  ResidentMainTopBar,
} from "@/features/dashboard/components/resident-top-bar"
import {
  getRouteChrome,
  useIsDesktop,
  SHELL_MAX_RESIDENT,
  SHELL_MAX_STAFF,
  SIDEBAR_MIN,
  SIDEBAR_W,
  SIDEBAR_W_STAFF,
} from "@/features/dashboard/lib/shell"
import type { StatusDialogMode } from "@/features/dashboard/components/report-status-dialog"
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
  const isMobile = !isDesktop
  const chrome = getRouteChrome(location.pathname)
  const isAccountWizardRoute = chrome.accountWizard
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
      ? "/dashboard/responders/map"
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
  const shellScope = !isResident && user && isResponderUser(user) ? "staff-dark" : undefined

  // Triage routes own their vertical space (see RouteChrome.workspace). Below
  // the desktop breakpoint they revert to a scrolling column, so the flag only
  // applies on desktop.
  const isWorkspaceRoute = chrome.workspace && isDesktop

  return (
    <ResidentSearchProvider>
      <div className={cn("min-h-svh overflow-x-hidden", shellScope, isResident ? "bg-white" : "bg-canvas")}>
        <div
          className={cn("mx-auto min-h-svh w-full", isResident ? "bg-white" : "bg-canvas")}
          style={{
            maxWidth: isResident ? SHELL_MAX_RESIDENT : SHELL_MAX_STAFF,
            minWidth: 0,
          }}
        >
          {isAccountWizardRoute ? (
            <main className="flex min-h-svh min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain bg-white">
              <Outlet />
            </main>
          ) : isDesktop ? (
            <div
              className="grid h-svh max-h-svh min-h-0 overflow-hidden"
              style={{
                gridTemplateColumns: isResident
                  ? `minmax(${SIDEBAR_MIN}px, min(${SIDEBAR_W}px, 36vw)) minmax(0, 1fr)`
                  : `${SIDEBAR_W_STAFF}px minmax(0, 1fr)`,
              }}
            >
              <div
                className={
                  isResident
                    ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-neutral-100"
                    : "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-nav-bg"
                }
              >
                <ResidentLogoBar homeTo={shellHome} tone={isResident ? "light" : "dark"} />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <Sidebar />
                </div>
              </div>

              {/* Staff get no top bar: search, bell and avatar all live in the
                  sidebar now, and an empty 56px strip above every page was
                  eating vertical room the map and tables need. */}
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                {isResident ? <ResidentMainTopBar /> : null}
                <main
                  className={cn(
                    "min-h-0 min-w-0 flex-1 overflow-x-hidden [scrollbar-width:thin]",
                    isResident ? "bg-white" : "bg-canvas",
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
                // Staff pages are card-on-canvas; residents stay on white.
                isResident || chrome.fullBleedMap ? "bg-white" : "bg-canvas",
              )}
            >
              {/* Full-bleed maps carry their own top bar and own the viewport
                  height, so the shell header stays out of their way. This is
                  keyed off the map flag rather than `hideMobileNav`, which the
                  responder map no longer sets. */}
              {!hideMobileNav && !chrome.fullBleedMap && !isResident ? (
                <StaffMobileHeader homeTo={shellHome} />
              ) : null}
              <Outlet />
            </main>
          )}
        </div>

        {isMobile && !hideMobileNav ? <MobileNav /> : null}

        {isResident ? (
          <SOSButton suppressed={chrome.fullBleedMap || isAccountWizardRoute} />
        ) : null}

        {!isResident ? <ResponderDispatchFab /> : null}

        {statusDialog}
      </div>
    </ResidentSearchProvider>
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
