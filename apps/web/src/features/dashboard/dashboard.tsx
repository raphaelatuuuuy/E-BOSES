import * as React from "react"
import { Outlet, useNavigate } from "react-router-dom"

import { useSidebar } from "@/features/dashboard/components/sidebar-context"
import { Sidebar } from "@/features/dashboard/components/sidebar"
import { SidebarProvider } from "@/features/dashboard/components/sidebar-context"
import { SOSButton } from "@/features/dashboard/components/sos-button"
import { useAuthSession } from "@/features/auth/auth-session"
import { MobileNav } from "@/features/dashboard/components/mobile-nav"
import { useLocationPing } from "@/features/dashboard/hooks/use-location-ping"
import { NotificationProvider, fetchConcern } from "@/features/dashboard/components/notification-context"
import { ReportStatusDialog, statusModeFromReport } from "@/features/dashboard/components/report-status-dialog"
import { ResidentSearchProvider } from "@/features/dashboard/components/resident-search-context"
import {
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
  const { isOpen } = useSidebar()
  const navigate = useNavigate()
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

  const staffMarginLeft = isMobile ? 0 : isOpen ? 208 : 56

  if (isResident) {
    return (
      <ResidentSearchProvider>
        {/*
          Single shell: top chrome + body share one width.
          Main column owns search + avatar so they share the feed|rail grid with home.
        */}
        <div className="min-h-svh overflow-x-auto bg-white">
          <div
            className="mx-auto min-h-svh w-full bg-white"
            style={{
              maxWidth: RESIDENT_SHELL_MAX,
              // Don't lock full preferred layout min — let sidebar shrink on zoom
              minWidth: isDesktop ? RESIDENT_DESKTOP_MIN_PX : 0,
            }}
          >
            {isDesktop ? (
              <div
                className="grid min-h-svh"
                style={{
                  // Shrinks with CSS viewport (zoom-in) between MIN and preferred W
                  gridTemplateColumns: `minmax(${RESIDENT_SIDEBAR_MIN}px, min(${RESIDENT_SIDEBAR_W}px, 24vw)) minmax(0, 1fr)`,
                }}
              >
                {/* LEFT: logo + nav */}
                <div className="flex min-h-0 min-w-0 flex-col">
                  <ResidentLogoBar />
                  <div className="min-h-0 flex-1">
                    <Sidebar />
                  </div>
                </div>

                {/* RIGHT: main top (search | avatar) + page */}
                <div className="flex min-h-0 min-w-0 flex-col">
                  <ResidentMainTopBar />
                  <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
                    <Outlet />
                  </main>
                </div>
              </div>
            ) : (
              <main className="flex min-h-svh min-w-0 flex-col bg-white pb-20">
                <Outlet />
              </main>
            )}
          </div>

          {isMobile ? (
            <div className="fixed bottom-0 left-0 right-0 z-30">
              <MobileNav />
            </div>
          ) : null}

          <SOSButton />

          {statusDialogReport ? (
            <ReportStatusDialog
              open={statusDialogOpen}
              onOpenChange={setStatusDialogOpen}
              report={statusDialogReport}
              mode={statusDialogMode}
              onTrack={() => navigate(`/dashboard/reports/${statusDialogReport.id}`)}
            />
          ) : null}
        </div>
      </ResidentSearchProvider>
    )
  }

  return (
    <div className="flex min-h-svh">
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <main
        className="flex min-h-svh flex-1 flex-col pb-20 transition-all duration-300 md:pb-0"
        style={{ marginLeft: staffMarginLeft }}
      >
        <Outlet />
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-30 md:hidden">
        <MobileNav />
      </div>

      {statusDialogReport ? (
        <ReportStatusDialog
          open={statusDialogOpen}
          onOpenChange={setStatusDialogOpen}
          report={statusDialogReport}
          mode={statusDialogMode}
          onTrack={() => navigate(`/dashboard/reports/${statusDialogReport.id}`)}
        />
      ) : null}
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
