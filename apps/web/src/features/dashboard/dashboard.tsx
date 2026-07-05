import * as React from "react"
import { useSidebar } from "@/features/dashboard/components/sidebar-context"
import { Sidebar } from "@/features/dashboard/components/sidebar"
import { SidebarProvider } from "@/features/dashboard/components/sidebar-context"
import { SOSButton } from "@/features/dashboard/components/sos-button"
import { MobileNav } from "@/features/dashboard/components/mobile-nav"
import { Outlet } from "react-router-dom"

function DashboardContent() {
  const { isOpen } = useSidebar()
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768)

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  return (
    <div className="flex min-h-svh">
      {/* Sidebar — CSS-hidden on mobile, no conditional unmount */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <main
        className="flex-1 pb-20 transition-all duration-300 md:pb-0"
        style={{ marginLeft: isMobile ? 0 : isOpen ? 240 : 64 }}
      >
        <Outlet />
      </main>

      {/* Mobile bottom nav — CSS-shown on mobile only */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30">
        <MobileNav />
      </div>

      <SOSButton />
    </div>
  )
}

export default function DashboardLayout() {
  return (
    <SidebarProvider>
      <DashboardContent />
    </SidebarProvider>
  )
}
