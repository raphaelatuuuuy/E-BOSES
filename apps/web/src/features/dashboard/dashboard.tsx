import * as React from "react"
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"

import { Sidebar } from "@/features/dashboard/components/sidebar"
import { SidebarProvider } from "@/features/dashboard/components/sidebar-context"
import { SOSButton } from "@/features/dashboard/components/sos-button"
import { useAuthSession } from "@/features/auth/auth-session"
import { MobileNav } from "@/features/dashboard/components/mobile-nav"
import { ResponderDispatchFab } from "@/features/dashboard/components/responder-dispatch-fab"
import { useLocationPing } from "@/features/dashboard/hooks/use-location-ping"
import { NotificationProvider, fetchConcern } from "@/features/dashboard/components/notification-context"
import { NotificationPopover } from "@/features/dashboard/components/notification-popover"
import { ProfileAccountMenu } from "@/features/dashboard/components/profile-account-menu"
import { ReportStatusDialog, statusModeFromReport } from "@/features/dashboard/components/report-status-dialog"
import { ResidentSearchProvider } from "@/features/dashboard/components/resident-search-context"
import {
  OfficialMainTopBar,
  ResidentLogoBar,
  ResidentMainTopBar,
  RESIDENT_DESKTOP_MIN_PX,
  RESIDENT_SIDEBAR_MIN,
  RESIDENT_SIDEBAR_W,
} from "@/features/dashboard/components/resident-top-bar"
import type { StatusDialogMode } from "@/features/dashboard/components/report-status-dialog"
import type { Concern } from "@/features/dashboard/api"

const RESIDENT_SHELL_MAX = 1600

function useResidentDesktop() {
  const [isDesktop, setIsDesktop] = React.useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= RESIDENT_DESKTOP_MIN_PX : true,
  )

  React.useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${RESIDENT_DESKTOP_MIN_PX}px)`)
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  return isDesktop
}

function DashboardContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const isDesktop = useResidentDesktop()
  const { user } = useAuthSession()
  useLocationPing(user)
  const isStaffRole =
    user?.role === "barangay_official" ||
    user?.role === "first_responder" ||
    user?.is_staff ||
    user?.is_superuser
  const isResident = !isStaffRole
  const isMobile = !isDesktop
  const isAlertsMapRoute =
    location.pathname === "/dashboard/alerts-map" ||
    location.pathname.endsWith("/alerts-map")
  const isResponderMapRoute = location.pathname === "/dashboard/responders/map"
  const isBackChromeRoute =
    location.pathname.startsWith("/dashboard/settings") ||
    location.pathname.startsWith("/dashboard/profile") ||
    location.pathname.startsWith("/dashboard/notifications")
  const isAccountWizardRoute =
    location.pathname.startsWith("/dashboard/settings/reverify/") ||
    location.pathname === "/dashboard/settings/change-password"
  const hideMobileNav =
    isMobile && (isBackChromeRoute || isAccountWizardRoute)

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

  return (
    <ResidentSearchProvider>
      <div className="min-h-svh overflow-x-hidden bg-white">
        <div
          className="mx-auto min-h-svh w-full bg-white"
          style={{
            maxWidth: isResident ? RESIDENT_SHELL_MAX : 1800,
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
                gridTemplateColumns: `minmax(${RESIDENT_SIDEBAR_MIN}px, min(${RESIDENT_SIDEBAR_W}px, 36vw)) minmax(0, 1fr)`,
              }}
            >
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-neutral-100">
                <ResidentLogoBar homeTo={shellHome} />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <Sidebar />
                </div>
              </div>

              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                {isResident ? <ResidentMainTopBar /> : <OfficialMainTopBar />}
                <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-white [scrollbar-width:thin]">
                  <Outlet />
                </main>
              </div>
            </div>
          ) : (
            <main
              className={
                hideMobileNav
                  ? "flex min-h-svh min-w-0 flex-col overflow-hidden bg-white"
                  : isResponderMapRoute
                    ? "flex min-h-svh min-w-0 flex-col overflow-hidden bg-white"
                  : "flex min-h-svh min-w-0 flex-col overflow-x-hidden bg-white pb-24"
              }
            >
              {!hideMobileNav && !isResident ? (
                <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-neutral-100 bg-white px-3">
                  <Link to={shellHome} className="flex min-w-0 items-center gap-2 no-underline">
                    <img src="/contents/logo.png" alt="Boses Marikina Heights" className="size-8 shrink-0 object-contain" />
                    <div className="flex flex-col">
                      <span className="truncate text-[18px] font-bold leading-none tracking-tight text-[#ff6a1a]">
                        Boses
                      </span>
                      <span className="text-[9px] font-bold leading-tight tracking-wide text-[#07145f]">
                        Marikina Heights
                      </span>
                    </div>
                  </Link>
                  <div className="flex items-center gap-0.5">
                    <NotificationPopover />
                    <ProfileAccountMenu placeLabel="Marikina Heights" />
                  </div>
                </header>
              ) : null}
              <Outlet />
            </main>
          )}
        </div>

        {isMobile && !hideMobileNav ? <MobileNav /> : null}

        {isResident ? (
          <SOSButton suppressed={isAlertsMapRoute || isAccountWizardRoute} />
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
