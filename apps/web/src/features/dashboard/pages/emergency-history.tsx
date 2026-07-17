import { useEffect, useState } from "react"
import { ChevronRightIcon, MapPinIcon, SirenIcon } from "lucide-react"
import { useSearchParams } from "react-router-dom"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { Topbar } from "@/features/dashboard/components/topbar"
import { EmergencyTrackingSheet } from "@/features/dashboard/components/emergency-tracking-sheet"
import {
  listMyEmergencies,
  type EmergencyAlert,
  type EmergencyStatus,
} from "@/features/dashboard/emergency-api"
import { usePageTitle } from "@/hooks/use-page-title"


const statusStyles: Record<EmergencyStatus, string> = {
  submitted: "border-amber-200 bg-amber-50 text-amber-800",
  routed: "border-blue-200 bg-blue-50 text-blue-800",
  acknowledged: "border-blue-200 bg-blue-50 text-blue-800",
  en_route: "border-blue-200 bg-blue-50 text-blue-800",
  nearby: "border-orange-200 bg-orange-50 text-orange-800",
  arrived: "border-orange-200 bg-orange-50 text-orange-800",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  cancelled: "border-neutral-200 bg-neutral-50 text-neutral-700",
}

function statusLabel(status: EmergencyStatus) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function EmergencyHistoryPage() {
  usePageTitle("Emergency History")
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedAlert = searchParams.get("alert")
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [selected, setSelected] = useState<EmergencyAlert | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const next = await listMyEmergencies()
        if (!cancelled) {
          setAlerts(next)
          if (requestedAlert) {
            setSelected(next.find((alert) => alert.public_id === requestedAlert || String(alert.id) === requestedAlert) || null)
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load emergency history.")
        }
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [requestedAlert])

  function openAlert(alert: EmergencyAlert) {
    setSelected(alert)
    setSearchParams({ alert: alert.public_id }, { replace: true })
  }

  return (
    <div className="flex flex-col bg-[#f7f8fc]">
      <Topbar />
      <main className="flex-1 p-4 pb-28 md:p-8">
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-sm font-bold text-[#2447b3]">Safety records</p>
          <h1 className="mt-1 text-2xl font-extrabold text-[#07145f] md:text-3xl">Emergency history</h1>
          <p className="mt-2 text-sm leading-6 text-[#43507f]">
            Review active and completed SOS alerts, responder updates, and evidence.
          </p>

          {error ? (
            <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          <section className="mt-5 overflow-hidden rounded-lg border border-[#dfe7f5] bg-white">
            {!loaded ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-20 w-full rounded-lg" />
                ))}
              </div>
            ) : alerts.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-red-50 text-red-700">
                  <SirenIcon className="size-6" />
                </span>
                <p className="mt-4 text-sm font-bold text-[#07145f]">No emergency alerts</p>
                <p className="mt-1 text-sm text-[#68739c]">Your SOS history will appear here.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#dfe7f5]">
                {alerts.map((alert) => (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => openAlert(alert)}
                    className="flex min-h-24 w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[#f8fbff]"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700">
                      <SirenIcon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-extrabold text-[#07145f]">
                        {alert.type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())} emergency
                      </span>
                      <span className="mt-1 flex items-center gap-1 truncate text-xs text-[#68739c]">
                        <MapPinIcon className="size-3.5 shrink-0" /> {alert.address || alert.barangay}
                      </span>
                      <span className="mt-1 block text-xs text-[#68739c]">
                        {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(alert.created_at))}
                      </span>
                    </span>
                    <span className={cn("hidden rounded-md border px-2 py-1 text-[11px] font-bold sm:inline-flex", statusStyles[alert.status])}>
                      {statusLabel(alert.status)}
                    </span>
                    <ChevronRightIcon className="size-5 shrink-0 text-[#2447b3]" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      <EmergencyTrackingSheet
        initialAlert={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null)
            setSearchParams({}, { replace: true })
          }
        }}
        onAlertChange={(next) => {
          setSelected(next)
          setAlerts((current) => current.map((alert) => alert.id === next.id ? next : alert))
        }}
      />
    </div>
  )
}
