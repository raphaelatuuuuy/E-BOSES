import { useEffect, useRef, useState } from "react"
import { FileIcon, LoaderCircleIcon, PhoneIcon, PlayIcon, ShieldCheckIcon, UserCheckIcon } from "lucide-react"

import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { fullTimestamp } from "@/features/dashboard/components/record/emergency-adapter"
import { isActiveEmergency } from "@/features/dashboard/components/alerts-map/lib"
import { drawRoute, routeRenderGeometry } from "@/features/dashboard/lib/route-line"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import {
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { useReporterPhone } from "@/features/dashboard/lib/use-reporter-phone"
import { OpsTabs } from "@/features/dashboard/components/workspace/ops-tabs"
import { EmergencyTimeline } from "@/features/dashboard/components/emergencies/emergency-timeline"
import { formatEventMoment } from "@/features/dashboard/lib/emergency-timeline-format"
import { Band, Fact, FactRow, Surface } from "@/features/dashboard/components/workspace/band"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import type leaflet from "leaflet"
import { formatTime, readableLocation, responderName, unitLabel } from "./lib"
import { streetOnly } from "@/features/dashboard/lib/location-text"

function coord(lat?: string | number | null, lng?: string | number | null) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return [latitude, longitude] as leaflet.LatLngTuple
}

function formatEta(seconds: number | null) {
  if (seconds == null) return null
  const minutes = Math.round(seconds / 60)
  return minutes < 1 ? "<1 min" : `${minutes} min`
}

function formatDistance(meters: number | null) {
  if (meters == null) return null
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

function IncidentMap({ alert }: { alert: EmergencyAlert }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const assignment = alert.current_assignment
  const route = assignment?.route ?? alert.route ?? null
  const incident = coord(alert.latitude, alert.longitude)
  const responder = coord(assignment?.last_location?.latitude, assignment?.last_location?.longitude)

  const eta = formatEta(route?.eta_seconds ?? null)
  const distance = formatDistance(route?.distance_meters ?? null)
  const routeIsLive = isActiveEmergency(alert)

  const locationLabel = streetOnly(
    readableLocation(
      alert.display_location,
      alert.resolved_location,
      alert.reported_area,
      alert.address,
      alert.barangay,
    ),
  ) || "Location pinned on the map"

  const signature = [
    alert.latitude,
    alert.longitude,
    locationLabel,
    assignment?.last_location?.latitude ?? "",
    assignment?.last_location?.longitude ?? "",
    route?.status ?? "",
    assignment?.location_history?.length ?? 0,
  ].join("|")

  useEffect(() => {
    if (!containerRef.current || !incident) return
    let cancelled = false
    let map: leaflet.Map | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current || !incident) return

      map = L.map(containerRef.current, {
        center: incident,
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
      })
      containerRef.current.classList.add("eboses-map-dark")

      L.control.zoom({ position: "topright" }).addTo(map)

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        maxZoom: 20,
        subdomains: "abcd",
      }).addTo(map)

      const history = (assignment?.location_history ?? [])
        .map((ping) => coord(ping.latitude, ping.longitude))
        .filter((point): point is leaflet.LatLngTuple => point != null)
      if (history.length > 1) {
        L.polyline(history, {
          color: "var(--color-map-trail)",
          weight: 2,
          opacity: 0.5,
          interactive: false,
        }).addTo(map)
      }

      if (route && route.status !== "unavailable" && route.geometry) {
        const { road, approach, connectors } = routeRenderGeometry(route, {
          origin: responder,
          destination: incident,
        })
        drawRoute(L, map, { road, approach, connectors, live: routeIsLive })
      }

      L.marker(incident, {
        icon: L.divIcon({
          className: "eboses-map-pin-wrap",

          iconSize: [30, 56],
          iconAnchor: [15, 56 - 26],
          html: `<div style="position:relative;width:30px;height:56px;">
                   <span style="position:absolute;left:50%;top:0;transform:translateX(-50%);
                                max-width:220px;overflow:hidden;text-overflow:ellipsis;
                                white-space:nowrap;background:rgba(15,23,42,.92);color:#fff;
                                font-size:11px;font-weight:600;line-height:1.3;
                                padding:3px 9px;border-radius:7px;
                                box-shadow:0 3px 10px rgba(0,0,0,.3);pointer-events:none;">${escapedHtml(locationLabel)}</span>
                   <span class="eboses-map-pin" style="position:absolute;left:50%;top:calc(50% + 2px);transform:translate(-50%,-50%);--pin:var(--color-map-incident);--core:13px">
                     <span class="eboses-map-pin__glow"></span>
                     <span class="eboses-map-pin__ring"></span>
                     <span class="eboses-map-pin__core"></span>
                   </span>
                 </div>`,
        }),
        title: locationLabel,
      }).addTo(map)

      if (responder) {
        L.marker(responder, {
          icon: L.divIcon({
            className: "eboses-map-pin-wrap",
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            html: `<span class="eboses-map-pin" style="--pin:var(--color-map-responder);--core:11px">
                     <span class="eboses-map-pin__glow"></span>
                     <span class="eboses-map-pin__core"></span>
                   </span>`,
          }),
          title: responderName(assignment?.responder),
        }).addTo(map)
      }

      map.setView(incident, 16)

      requestAnimationFrame(() => map?.invalidateSize())
    }

    void init()
    return () => {
      cancelled = true
      map?.remove()
    }

  }, [
    signature,
    assignment?.location_history,
    assignment?.responder,
    incident,
    locationLabel,
    responder,
    route,
    routeIsLive,
  ])

  if (!incident) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-panel border border-card-line bg-card text-body text-muted-foreground">
        No coordinates on this alert.
      </div>
    )
  }

  const caption = responder
    ? [responderName(assignment?.responder), distance, eta ? `ETA ${eta}` : null]
        .filter(Boolean)
        .join(" · ")
    : "Awaiting responder GPS"

  return (
    <div className="relative overflow-hidden rounded-control border border-card-line">
      <div ref={containerRef} className="h-[300px] w-full" />
      <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2.5 pt-6 text-[12px] font-medium text-white">
        {caption}
      </p>
    </div>
  )
}

function escapedHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return "Not closed yet"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function routeLabel(alert: EmergencyAlert) {
  const route = alert.current_assignment?.route ?? alert.route
  if (!route || route.status !== "ok") return "Route unavailable"
  const distance = route.distance_meters == null ? "unknown distance" : route.distance_meters < 1000 ? `${Math.round(route.distance_meters)} m` : `${(route.distance_meters / 1000).toFixed(1)} km`
  const eta = route.eta_seconds == null ? "ETA unavailable" : `${Math.max(1, Math.round(route.eta_seconds / 60))} min ETA`
  return `${distance} · ${eta}`
}

function elapsedSince(iso: string | null | undefined, now: number) {
  if (!iso) return null
  const ms = now - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function ResponseBand({ alert, team }: { alert: EmergencyAlert; team: EmergencyAlert["assignments"] }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const roster = team ?? []
  const hasContact = Boolean(alert.reporter_phone?.trim())

  const { busy: dialBusy, call: callResident } = useReporterPhone(alert)
  const unacknowledged = roster.filter((assignment) => !assignment.acknowledged_at)
  const waiting = elapsedSince(alert.routed_at, now)
  const pings = alert.current_assignment?.location_history?.length ?? 0

  return (
    <Band
      label={roster.length > 0 ? `Response · ${roster.length} unit${roster.length === 1 ? "" : "s"}` : "Response"}
      action={
        hasContact ? (
          <button
            type="button"
            onClick={() => void callResident()}
            disabled={dialBusy}
            className="inline-flex items-center gap-1.5 rounded-control bg-brand-orange px-2.5 py-1 text-[12px] font-semibold text-brand-orange-ink transition-colors hover:bg-brand-orange-strong disabled:opacity-60"
          >
            {dialBusy ? <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden /> : <PhoneIcon className="size-3.5" aria-hidden />}
            {dialBusy ? "Opening…" : "Call resident"}
          </button>
        ) : (
          <span className="text-[12px] text-subtle-foreground">Contact withheld</span>
        )
      }
    >
      {roster.length === 0 ? (
        <p className="rounded-control bg-status-open-surface px-3 py-2 text-[12px] font-semibold text-status-open-ink">
          {alert.responding_unit
            ? `${alert.responding_unit.short_name || alert.responding_unit.name} — awaiting a responder`
            : "No unit answers this emergency type yet"}
          {waiting ? ` · routed ${waiting} ago` : ""}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {roster.map((assignment) => {
            const ack = assignment.acknowledged_at
            const arrived = assignment.arrived_at
            return (
              <li key={assignment.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <UserCheckIcon className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
                <span className="text-sm font-semibold text-foreground">
                  {responderName(assignment.responder)}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {unitLabel(assignment.responder.responder_unit)}
                  {}
                  {assignment.source === "escalation" ? " · escalated" : ""}
                </span>
                <span
                  className="ml-auto text-[12px] font-semibold tabular-nums text-muted-foreground"
                  title={fullTimestamp(arrived ?? ack ?? assignment.assigned_at)}
                >
                  {arrived ? formatTime(arrived) : ack ? formatTime(ack) : elapsedSince(assignment.assigned_at, now) ?? ""}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {roster.length > 0 && unacknowledged.length > 0 ? (
        <p className="mt-2 text-[12px] font-semibold text-severity-critical">
          {unacknowledged.length} unit{unacknowledged.length === 1 ? "" : "s"} have not acknowledged.
        </p>
      ) : null}

      <FactRow className="mt-3.5 border-t border-card-line pt-3">
        <Fact
          label="Road route"
          value={routeLabel(alert)}
          hint={pings ? `${pings} responder pings saved` : "Waiting for responder GPS"}
        />
        <Fact
          label="Response time"
          value={formatDuration(alert.response_duration_seconds)}
          hint={alert.resolved_at ? `Closed ${formatTime(alert.resolved_at)}` : "Stops on final disposition"}
        />
      </FactRow>
    </Band>
  )
}

function IncidentChronology({ alert }: { alert: EmergencyAlert }) {
  const logs = alert.assignment_logs ?? []
  const [showInternal, setShowInternal] = useState(false)

  if ((alert.timeline ?? []).length === 0) return null

  return (
    <Band label="Status and Timeline">
      <EmergencyTimeline entries={alert.timeline} showControls showNotes />

      {logs.length ? (
        <div className="mt-4 border-t border-card-line pt-3">
          <button
            type="button"
            onClick={() => setShowInternal((value) => !value)}
            aria-expanded={showInternal}
            className="text-micro font-semibold text-subtle-foreground transition-colors hover:text-foreground"
          >
            {showInternal ? "Hide" : "Show"} internal dispatch log ({logs.length})
          </button>
          {showInternal ? (
            <ul className="mt-2 space-y-1.5">
              {logs.map((log) => (
                <li key={log.id} className="text-[12px] leading-5 text-subtle-foreground">
                  <span className="font-semibold text-muted-foreground">
                    {internalActionLabel(log.action)}
                  </span>
                  {log.responder?.full_name ? ` — ${log.responder.full_name}` : ""}
                  {log.note ? ` — ${log.note}` : ""}
                  <span className="block text-faint-foreground">{formatEventMoment(log.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Band>
  )
}

function internalActionLabel(action: string) {
  const words = action.replaceAll("_", " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function EmergencyMediaGrid({ media }: { media: EmergencyAlert["media"] }) {
  const [lightbox, setLightbox] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)
  const items: MediaPreviewItem[] = media.map((item) =>
    toMediaPreviewItem(mediaDisplaySource(item), item.original_filename, item.mime_type),
  )

  if (!media.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-panel border border-dashed border-card-line text-label text-subtle-foreground">
        No media attached
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {media.map((item, index) =>
        item.mime_type.startsWith("image/") ? (
          <button
            key={item.id}
            type="button"
            onClick={() => setLightbox({ items, index })}
            className="overflow-hidden rounded-control border border-card-line bg-canvas text-left transition hover:border-brand-orange"
          >
            <AuthenticatedMediaImage
              src={item.preview_url}
              alt={`${item.original_filename} evidence photo`}
              className="h-28 w-full object-cover"
            />
          </button>
        ) : (
          <button
            key={item.id}
            type="button"
            onClick={() => setLightbox({ items, index })}
            className="flex h-28 items-center justify-center gap-2 rounded-control border border-card-line bg-canvas px-3 text-center text-[12px] font-semibold text-muted-foreground transition-colors hover:border-brand-orange hover:text-foreground"
          >
            {item.mime_type.startsWith("video/") ? (
              <>
                <PlayIcon className="size-5" /> Preview video
              </>
            ) : (
              <>
                <FileIcon className="size-5" /> Preview file
              </>
            )}
          </button>
        ),
      )}
      {lightbox ? (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  )
}

const IDENTITY_CAUTION: Record<string, string> = {
  unverified:
    "This number is not registered to any resident account, so the caller's identity is unconfirmed.",
  needs_review: "The number partly matches a resident account. Confirm who you are speaking to.",
}

function ReporterBand({ alert }: { alert: EmergencyAlert }) {
  const bySms = alert.location_source === "sms" || alert.location_source === "sms_landmark"

  const name = alert.reporter_display || (alert.reporter_is_anonymous_intake ? "Unidentified caller" : "Unknown reporter")
  const caution = IDENTITY_CAUTION[alert.reporter_verification ?? ""]

  return (
    <Band label="Reported by">
      <p className="text-heading text-foreground">{name}</p>
      {}
      <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
        {bySms ? "Sent by text message." : "Sent from the E-Boses app."}
        {caution ? ` ${caution}` : ""}
      </p>
    </Band>
  )
}

function IncidentBand({ alert }: { alert: EmergencyAlert }) {
  const unresolved = alert.unresolved_fields ?? []

  return (
    <Band label="Location">
      {alert.location_confidence && alert.location_confidence !== "confirmed" ? (
        <p className="text-[12px] text-severity-moderate-ink">
          {alert.location_confidence === "outside_area"
            ? "This location is outside the barangay service area."
            : "This location has not been confirmed."}
        </p>
      ) : null}

      {alert.category_needs_confirmation ? (
        <p className="mt-1 text-[12px] text-severity-moderate-ink">
          The emergency category was guessed and needs confirming.
        </p>
      ) : null}

      {unresolved.length ? (
        <p className="mt-1 text-[12px] text-severity-moderate-ink">
          Still to confirm: {unresolved.join(", ")}.
        </p>
      ) : null}
    </Band>
  )
}

export function IncidentBoard({ alert }: { alert: EmergencyAlert | null }) {
  const [recordTab, setRecordTab] = useState("details")

  if (!alert) {
    return (
      <section className="flex min-h-[520px] items-center justify-center rounded-panel border border-dashed border-card-line bg-card p-8 text-center">
        <div>
          <ShieldCheckIcon className="mx-auto size-10 text-brand-navy" />
          <p className="mt-3 text-sm font-semibold text-brand-navy">Select an emergency</p>
          <p className="mt-1 text-xs text-subtle-foreground">Review location, timeline, assignment, and response status.</p>
        </div>
      </section>
    )
  }

  const activeTeam = alert.assignments?.filter(
    (assignment) => !["cancelled", "declined", "resolved"].includes(assignment.status),
  ) ?? []

  const detailsContent = (
    <div className="space-y-4">
      <Surface>
        <IncidentBand alert={alert} />
        <Band className="p-0">
          <IncidentMap alert={alert} />
        </Band>
        <ReporterBand alert={alert} />
        <ResponseBand alert={alert} team={activeTeam} />
        <IncidentChronology alert={alert} />
      </Surface>
    </div>
  )

  const chatContent = (
    <EmergencyChatPanel
      alertId={alert.id}
      open
      theme="light"
      disabled={alert.status === "cancelled" || alert.status === "resolved"}
      className="h-[min(320px,70svh)]"
    />
  )

  return (
    <section>
      <OpsTabs
        value={recordTab}
        onValueChange={setRecordTab}
        tabs={[
          { id: "details", label: "Details", content: detailsContent },
          { id: "chat", label: "Chat", content: chatContent },
          { id: "photos", label: "Photos", count: alert.media.length, content: <EmergencyMediaGrid media={alert.media} /> },
        ]}
      />
    </section>
  )
}
