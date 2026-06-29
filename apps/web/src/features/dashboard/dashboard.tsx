import { Outlet } from "react-router-dom"

import { Sidebar } from "@/features/dashboard/components/sidebar"
import { SidebarProvider, useSidebar } from "@/features/dashboard/components/sidebar-context"
import { MockUserProvider } from "@/features/dashboard/components/mock-user-context"

function DashboardContent() {
  const { isOpen } = useSidebar()

  return (
    <div className="flex min-h-svh">
      <Sidebar />
      <main
        className="flex-1 transition-all duration-300"
        style={{ marginLeft: isOpen ? "240px" : "64px" }}
      >
        <Outlet />
      </main>
    </div>
  )
}

export default function DashboardLayout() {
  return (
    <SidebarProvider>
      <MockUserProvider>
        <DashboardContent />
      </MockUserProvider>
    </SidebarProvider>
  )
}
