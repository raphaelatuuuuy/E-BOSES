import * as React from "react"
import { useSidebar } from "@/features/dashboard/components/sidebar-context"
import { Sidebar } from "@/features/dashboard/components/sidebar"
import { SidebarProvider } from "@/features/dashboard/components/sidebar-context"
import { SOSButton } from "@/features/dashboard/components/sos-button"
import { MobileNav } from "@/features/dashboard/components/mobile-nav"
import { Outlet, useNavigate } from "react-router-dom"
import { NotificationProvider, fetchConcern } from "@/features/dashboard/components/notification-context"
import { ReportStatusDialog, statusModeFromReport } from "@/features/dashboard/components/report-status-dialog"
import type { StatusDialogMode } from "@/features/dashboard/components/report-status-dialog"
import type { Concern } from "@/features/dashboard/api"

function DashboardContent() {
  const { isOpen } = useSidebar()
  const navigate = useNavigate()
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768)

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Notification -> dialog state
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

  return (
    <div className="flex min-h-svh">
      {/* Sidebar — CSS-hidden on mobile */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <main
        className="flex min-h-svh flex-1 flex-col pb-20 transition-all duration-300 md:pb-0"
        style={{ marginLeft: isMobile ? 0 : isOpen ? 208 : 56 }}
      >
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30">
        <MobileNav />
      </div>

      <SOSButton />

      {/* Notification -> status dialog */}
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
