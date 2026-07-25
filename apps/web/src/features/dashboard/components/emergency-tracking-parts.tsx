import { ArrowsIn, ArrowsOut, X } from "@phosphor-icons/react"

import type { EmergencyAlert, EmergencyStatus } from "@/features/dashboard/emergency-api"

const timeFormatter = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" })

const activeStatuses: EmergencyStatus[] = [
  "submitted",
  "routed",
  "en_route",
  "nearby",
  "arrived",
]

const statusLabels: Record<string, string> = {
  submitted: "Alert sent",
  routed: "Responder assigned",
  acknowledged: "Responder routed",
  en_route: "On the way",
  nearby: "Nearby",
  arrived: "On scene",
  resolved: "Resolved",
  cancelled: "Cancelled",
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.max(20, Math.round(meters / 10) * 10)} m away`
  return `${(meters / 1000).toFixed(1)} km away`
}

function formatRouteEta(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "ETA unavailable"
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return `ETA ${minutes} min`
}

function formatTime(value: string) {
  return timeFormatter.format(new Date(value))
}

function headline(alert: EmergencyAlert) {
  if (["en_route", "nearby", "arrived"].includes(alert.status)) return "Help is on the way"
  if (alert.status === "resolved") return "Emergency resolved"
  if (alert.status === "cancelled") return "Alert closed"
  return "Emergency active"
}

export function TrackingHeader({
  alert,
  isDesktop,
  expanded,
  onToggleExpand,
  onClose,
}: {
  alert: EmergencyAlert
  isDesktop: boolean
  expanded: boolean
  onToggleExpand: () => void
  onClose: () => void
}) {
  const isLive = activeStatuses.includes(alert.status)

  return (
    <header className="flex shrink-0 items-center gap-2 bg-gradient-to-r from-[#c41212] via-[#e11d2e] to-[#b91c1c] px-3 py-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {isLive ? (
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase">
              Live
            </span>
          ) : null}
          <h2 className="truncate text-[15px] font-bold sm:text-base">{headline(alert)}</h2>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-white/85">
          {alert.public_id || `Alert #${alert.id}`} · {statusLabels[alert.status]}
        </p>
      </div>
      {isDesktop ? (
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ArrowsIn className="size-4" /> : <ArrowsOut className="size-4" />}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
        aria-label="Close"
      >
        <X className="size-5" />
      </button>
    </header>
  )
}

export function MapOverlayBanners({
  isLive,
  streetLine,
  distance,
  etaSeconds,
  connectionState,
  lastLocation,
  locationIsStale,
}: {
  isLive: boolean
  streetLine: string
  distance: number | null
  etaSeconds: number | null
  connectionState: "connecting" | "live" | "degraded"
  lastLocation: { created_at: string } | null
  locationIsStale: boolean
}) {
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-[500] flex max-w-[min(100%,280px)] flex-col gap-1.5">
        {isLive ? (
          <span className="w-fit rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-bold tracking-wide text-white uppercase shadow-md">
            Live · Alert
          </span>
        ) : null}
        <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-900 shadow-md">
          You · {streetLine}
        </span>
        {distance !== null ? (
          <span className="w-fit rounded-full bg-[#07145f] px-2.5 py-1 text-[11px] font-semibold text-white shadow-md">
            {formatDistance(distance)} · {formatRouteEta(etaSeconds)}
          </span>
        ) : null}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-[500] flex flex-wrap gap-1.5">
        <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-800 shadow-md">
          {connectionState === "live" ? "Live GPS" : connectionState === "connecting" ? "Connecting" : "Polling"}
        </span>
        {lastLocation ? (
          <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-800 shadow-md">
            Responder {formatTime(lastLocation.created_at)}
            {locationIsStale ? " · stale" : ""}
          </span>
        ) : (
          <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 shadow-md">
            Waiting for responder GPS
          </span>
        )}
      </div>
    </>
  )
}

export function TrackingCancelFooter({
  cancelOpen,
  canCancel,
  cancelReason,
  cancelBusy,
  isLive,
  onCancelOpenChange,
  onCancelReasonChange,
  onSubmitCancel,
  onClose,
}: {
  cancelOpen: boolean
  canCancel: boolean
  cancelReason: string
  cancelBusy: boolean
  isLive: boolean
  onCancelOpenChange: (open: boolean) => void
  onCancelReasonChange: (value: string) => void
  onSubmitCancel: () => void
  onClose: () => void
}) {
  return (
    <div className="shrink-0 border-t border-white/10 bg-[#050e45] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {cancelOpen && canCancel ? (
        <div className="mb-3 rounded-xl border border-red-300/25 bg-red-500/10 p-3">
          <label htmlFor="emergency-cancel-reason" className="text-[13px] font-semibold text-white">
            Why are you cancelling?
          </label>
          <p className="mt-1 text-[11px] leading-4 text-white/55">
            Assigned responders will see this reason. Enter at least 10 characters.
          </p>
          <textarea
            id="emergency-cancel-reason"
            value={cancelReason}
            onChange={(event) => onCancelReasonChange(event.target.value.slice(0, 500))}
            placeholder="Example: Sent by accident; everyone here is safe."
            className="mt-2 min-h-20 w-full resize-none rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-red-300"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onCancelOpenChange(false)}
              className="h-10 flex-1 rounded-lg border border-white/15 text-[13px] font-semibold text-white hover:bg-white/10"
            >
              Keep alert
            </button>
            <button
              type="button"
              disabled={cancelBusy || cancelReason.trim().length < 10}
              onClick={onSubmitCancel}
              className="h-10 flex-1 rounded-lg bg-red-600 text-[13px] font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {cancelBusy ? "Cancelling…" : "Confirm cancel"}
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex gap-2">
        {canCancel && !cancelOpen ? (
          <button
            type="button"
            onClick={() => onCancelOpenChange(true)}
            className="h-11 flex-1 rounded-full border border-red-300/40 text-[14px] font-semibold text-red-100 hover:bg-red-500/15"
          >
            Cancel alert
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="h-11 flex-1 rounded-full bg-[#ff6a1a] text-[14px] font-semibold text-white hover:bg-[#e85f17]"
        >
          Close tracking
        </button>
      </div>
      {isLive && !canCancel ? (
        <p className="mt-2 text-center text-[11px] text-white/50">
          A responder is already handling this alert. Contact them in chat if circumstances change.
        </p>
      ) : null}
    </div>
  )
}
