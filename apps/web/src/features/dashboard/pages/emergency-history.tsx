import { useEffect, useMemo, useState } from "react"
import { ChevronRightIcon, MapPinIcon, SirenIcon } from "lucide-react"
import { useSearchParams } from "react-router-dom"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { EmergencyTrackingSheet } from "@/features/dashboard/components/emergency-tracking-sheet"
import {
  listMyEmergencies,
  type EmergencyAlert,
  type EmergencyStatus,
} from "@/features/dashboard/emergency-api"
import { usePageTitle } from "@/hooks/use-page-title"
import { isEmergencyActive } from "@/features/dashboard/components/emergencies/lib"
import { statusLabelOf } from "@/features/dashboard/lib/status-vocabulary"

type FilterKey = "all" | "active" | "resolved" | "closed"

const filters: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
]

function statusLabel(status: EmergencyStatus) {
  return statusLabelOf(status, "resident", "emergency")
}

function statusChip(status: EmergencyStatus) {
  if (isEmergencyActive(status)) return "border-neutral-200 bg-neutral-100 text-neutral-800"
  if (status === "resolved") return "border-neutral-200 bg-neutral-50 text-neutral-600"
  return "border-neutral-200 bg-neutral-50 text-neutral-500"
}

function typeLabel(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function EmergencyHistoryPage() {
  usePageTitle("Alerts")
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedAlert = searchParams.get("alert")
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [selected, setSelected] = useState<EmergencyAlert | null>(null)
  const [filter, setFilter] = useState<FilterKey>("all")
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
            setSelected(
              next.find(
                (alert) => alert.public_id === requestedAlert || String(alert.id) === requestedAlert,
              ) || null,
            )
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

  const visible = useMemo(() => {
    if (filter === "all") return alerts
    if (filter === "active") return alerts.filter((a) => isEmergencyActive(a.status))
    if (filter === "resolved") return alerts.filter((a) => a.status === "resolved" || a.status === "closed")
    return alerts.filter((a) => ["cancelled", "false_alarm", "invalid"].includes(a.status))
  }, [alerts, filter])

  function openAlert(alert: EmergencyAlert) {
    setSelected(alert)
    setSearchParams({ alert: alert.public_id }, { replace: true })
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <div className="min-w-0 flex-1 px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-12 md:pt-6 lg:px-8">
        {/* lg: max-width matches lib/shell.ts FEED_MAX (680px) — same column width as the resident feed */}
        <div className="w-full max-w-lg md:max-w-xl lg:max-w-[680px]">
          <h1 className="text-[20px] font-bold tracking-tight text-neutral-900 sm:text-2xl">Alerts</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Active and past SOS alerts, with location and status.
          </p>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-0.5">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={cn(
                  "min-h-11 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
                  filter === item.key
                    ? "border-brand-orange bg-brand-orange text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {error ? (
            <div role="alert" className="mt-4 rounded-xl border border-sos/30 bg-sos/10 p-4 text-sm text-sos">
              {error}
            </div>
          ) : null}

          <section className="mt-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
            {!loaded ? (
              <div className="space-y-0 divide-y divide-neutral-100">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="p-4">
                    <Skeleton className="h-14 w-full rounded-lg" />
                  </div>
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
                  <SirenIcon className="size-6" />
                </span>
                <p className="mt-4 text-[15px] font-semibold text-neutral-900">No alerts in this view</p>
                <p className="mt-1 text-sm text-neutral-500">Your SOS history will appear here.</p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {visible.map((alert) => (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => openAlert(alert)}
                    className="flex min-h-[72px] w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-neutral-50"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sos/10 text-sos">
                      <SirenIcon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-neutral-900">
                        {typeLabel(alert.type)} emergency
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-neutral-500">
                        <MapPinIcon className="size-3.5 shrink-0" />
                        {alert.address || alert.barangay || "Pinned location"}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-neutral-400">
                        {new Intl.DateTimeFormat("en", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(alert.created_at))}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "hidden rounded-md border px-2 py-1 text-[11px] font-medium sm:inline-flex",
                        statusChip(alert.status),
                      )}
                    >
                      {statusLabel(alert.status)}
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-neutral-300" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

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
          setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
        }}
      />
    </div>
  )
}
