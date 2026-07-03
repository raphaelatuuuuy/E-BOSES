import { useEffect, useState } from "react"
import { Outlet } from "react-router-dom"

import { Sidebar } from "@/features/dashboard/components/sidebar"
import { SidebarProvider, useSidebar } from "@/features/dashboard/components/sidebar-context"
import { SOSButton } from "@/features/dashboard/components/sos-button"
import { MobileNav } from "@/features/dashboard/components/mobile-nav"

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    setIsMobile(mq.matches)
    function onChange(e: MediaQueryListEvent) { setIsMobile(e.matches) }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return isMobile
}

function DashboardContent() {
  const { isOpen } = useSidebar()
  const isMobile = useIsMobile()

  return (
    <div className="flex min-h-svh">
      {/* Sidebar — hidden on mobile */}
      {!isMobile && <Sidebar />}

      <main
        className="flex-1 pb-20 transition-all duration-300 md:pb-0"
        style={{ marginLeft: isMobile ? 0 : isOpen ? 240 : 64 }}
      >
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      {isMobile && <MobileNav />}

      {/* SOS button */}
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
