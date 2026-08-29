import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import {
  ResidentContentGrid,
  RESIDENT_DESKTOP_MIN_PX,
} from "@/features/dashboard/components/resident-top-bar"
import { usePageTitle } from "@/hooks/use-page-title"
import { apiRequest } from "@/lib/api"
import { type NotificationItem } from "@/features/dashboard/components/notification-context"
import { NotificationsPanel } from "@/features/dashboard/components/notifications/notifications-panel"
import { createResidentNotificationsConfig } from "@/features/dashboard/components/notifications/resident-config"

const FILTERABLE_URL_TYPES = ["announcements", "emergencies", "reports", "unread"]

function initialNotificationState(): { view?: "inbox" | "archived"; filter?: string } {
  if (typeof window === "undefined") return {}
  const type = new URLSearchParams(window.location.search).get("type")
  if (type === "archived") return { view: "archived", filter: "all" }
  return type && FILTERABLE_URL_TYPES.includes(type) ? { view: "inbox", filter: type } : {}
}

export default function NotificationsPage() {
  usePageTitle("Your updates")
  const navigate = useNavigate()
  const [olderNotifications, setOlderNotifications] = useState<NotificationItem[]>([])
  const [nextPage, setNextPage] = useState(2)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const config = useMemo(() => createResidentNotificationsConfig(navigate), [navigate])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const next = await apiRequest<NotificationItem[]>(
        `/notifications/?page=${nextPage}&page_size=20`,
      )
      setOlderNotifications((current) => [...current, ...next])
      setNextPage((current) => current + 1)
      setHasMore(next.length === 20)
    } finally {
      setLoadingMore(false)
    }
  }

  const initial = useMemo(() => initialNotificationState(), [])

  function goBack() {
    if (window.history.length > 1) navigate(-1)
    else navigate("/dashboard/home")
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <style>{`
        /* Mobile: single column (rail hidden). Desktop: feed | rail like Home */
        .notif-layout { display: block !important; }
        @media (min-width: ${RESIDENT_DESKTOP_MIN_PX}px) {
          .notif-layout {
            display: grid !important;
          }
        }
      `}</style>
      <ResidentContentGrid className="notif-layout min-w-0 flex-1 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-2 md:pb-12 md:pt-4 lg:px-0">
        <div className="min-w-0 w-full">
          <NotificationsPanel
            config={config}
            onBack={goBack}
            initialView={initial.view}
            initialFilter={initial.filter}
            onLoadMore={loadMore}
            hasMore={hasMore}
            loadingMore={loadingMore}
            extraItems={olderNotifications}
          />
        </div>
      </ResidentContentGrid>
    </div>
  )
}
