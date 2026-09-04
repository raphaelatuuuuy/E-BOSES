import { useEffect, useState } from "react"
import { ArrowRightIcon, ClipboardListIcon, MapPinnedIcon, TriangleAlert } from "lucide-react"
import { Link } from "react-router-dom"

import { listAssignedConcerns, type Concern } from "@/features/dashboard/api"
import { useAssignedDispatches } from "@/features/dashboard/hooks/use-assigned-dispatches"
import { usePageTitle } from "@/hooks/use-page-title"

/**
 * A small landing surface for responders. It intentionally reuses the same
 * assigned emergency/concern feeds as the shared workspaces, so Overview is a
 * quick read rather than another dispatch queue with different counts.
 */
export default function ResponderOverviewPage() {
  usePageTitle("Overview")
  const { activeAlerts, loading: alertsLoading, loadError } = useAssignedDispatches(true)
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [concernsLoading, setConcernsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void listAssignedConcerns()
      .then((next) => {
        if (!cancelled) setConcerns(next)
      })
      .catch(() => {
        if (!cancelled) setConcerns([])
      })
      .finally(() => {
        if (!cancelled) setConcernsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const activeConcerns = concerns.filter((concern) => !["resolved", "rejected"].includes(concern.status)).length

  return (
    <main className="min-h-full bg-white px-5 pb-24 pt-8 md:px-8 lg:px-10 lg:pb-10">
      <div className="mx-auto max-w-5xl">
        <header>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Responder workspace</p>
          <h1 className="mt-2 text-[30px] font-bold tracking-tight text-neutral-900">Overview</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-neutral-500">
            Your assigned incidents and concerns, routed automatically as they come in.
          </p>
        </header>

        {loadError ? (
          <p className="mt-5 rounded-[16px] bg-amber-50 px-4 py-3 text-[13px] text-amber-800 ring-1 ring-amber-200">{loadError}</p>
        ) : null}

        <section className="mt-7 grid gap-3 sm:grid-cols-2">
          <Link
            to="/dashboard/reports?filter=Emergencies"
            className="group rounded-[22px] bg-white p-5 ring-1 ring-neutral-200 transition hover:ring-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-[12px] bg-orange-50 text-orange-600">
                <TriangleAlert className="size-5" aria-hidden="true" />
              </span>
              <ArrowRightIcon className="size-4 text-neutral-400 transition group-hover:translate-x-0.5" aria-hidden="true" />
            </div>
            <p className="mt-5 text-[13px] font-medium text-neutral-500">Active emergencies</p>
            <p className="mt-1 text-[34px] font-bold tabular-nums tracking-tight text-neutral-900">
              {alertsLoading ? "—" : activeAlerts.length}
            </p>
            <p className="mt-1 text-[13px] text-neutral-500">Open the shared incident queue</p>
          </Link>

          <Link
            to="/dashboard/reports"
            className="group rounded-[22px] bg-white p-5 ring-1 ring-neutral-200 transition hover:ring-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-[12px] bg-neutral-100 text-neutral-700">
                <ClipboardListIcon className="size-5" aria-hidden="true" />
              </span>
              <ArrowRightIcon className="size-4 text-neutral-400 transition group-hover:translate-x-0.5" aria-hidden="true" />
            </div>
            <p className="mt-5 text-[13px] font-medium text-neutral-500">Open concerns</p>
            <p className="mt-1 text-[34px] font-bold tabular-nums tracking-tight text-neutral-900">
              {concernsLoading ? "—" : activeConcerns}
            </p>
            <p className="mt-1 text-[13px] text-neutral-500">Review assigned resident reports</p>
          </Link>
        </section>

        <section className="mt-4 rounded-[22px] bg-neutral-50 p-5 ring-1 ring-neutral-200">
          <div className="flex items-center gap-3">
            <MapPinnedIcon className="size-5 text-orange-600" aria-hidden="true" />
            <div>
              <h2 className="text-[15px] font-semibold text-neutral-900">Automatic routing is active</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-neutral-600">
                Stay online with location sharing enabled. New critical alerts are sent to the nearest available responder.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
