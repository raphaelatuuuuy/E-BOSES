import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ClockIcon, MapPinIcon, PhoneIcon, ShieldCheckIcon, UserCheckIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { fullTimestamp } from "@/features/dashboard/components/record/emergency-adapter"
import { isActiveEmergency } from "@/features/dashboard/components/alerts-map/lib"
import { applyRouteMotionAll, routeLineStyle } from "@/features/dashboard/lib/route-line"
import { AuthenticatedMediaImage, openAuthenticatedMedia } from "@/features/dashboard/components/authenticated-media"
import { OpsTabs } from "@/features/dashboard/components/workspace/ops-tabs"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import type leaflet from "leaflet"
import { emergencyTone, formatTime, responderName, statusClass, statusLabel, unitLabel } from "./lib"

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

  const signature = [
    alert.latitude,
    alert.longitude,
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
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: false,
      })
      containerRef.current.classList.add("eboses-map-dark")

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        maxZoom: 20,
        subdomains: "abcd",
      }).addTo(map)

      const focus: leaflet.LatLngTuple[] = [incident]

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

      if (route?.status === "ok" && route.geometry) {
        const line = L.geoJSON(route.geometry as Parameters<typeof L.geoJSON>[0], {
          style: routeLineStyle({ live: routeIsLive }),
          interactive: false,
        }).addTo(map)
        applyRouteMotionAll(line, routeIsLive)
        focus.push(...(line.getBounds().isValid() ? [line.getBounds().getNorthEast(), line.getBounds().getSouthWest()] : []).map(
          (point) => [point.lat, point.lng] as leaflet.LatLngTuple,
        ))
      }

      L.marker(incident, {
        icon: L.divIcon({
          className: "eboses-map-pin-wrap",
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          html: `<span class="eboses-map-pin" style="--pin:var(--color-map-incident);--core:13px">
                   <span class="eboses-map-pin__glow"></span>
                   <span class="eboses-map-pin__ring"></span>
                   <span class="eboses-map-pin__core"></span>
                 </span>`,
        }),
        title: alert.address || alert.barangay,
      }).addTo(map)

      if (responder) {
        focus.push(responder)
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

      if (focus.length > 1) {
        map.fitBounds(L.latLngBounds(focus), { padding: [36, 36], maxZoom: 17 })
      }

      requestAnimationFrame(() => map?.invalidateSize())
    }

    void init()
    return () => {
      cancelled = true
      map?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  if (!incident) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-panel border border-card-line bg-card text-body text-muted-foreground">
        No coordinates on this alert.
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-panel border border-card-line">
      <div ref={containerRef} className="h-[300px] w-full" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 bg-gradient-to-t from-black/55 to-transparent p-3">
        <span className="rounded-pill bg-black/45 px-2.5 py-1 text-micro uppercase text-sos-bright backdrop-blur-sm">
          Resident
        </span>
        {responder ? (
          <span className="rounded-pill bg-black/45 px-2.5 py-1 text-micro uppercase text-white backdrop-blur-sm">
            {responderName(assignment?.responder)}
          </span>
        ) : (
          <span className="rounded-pill bg-black/45 px-2.5 py-1 text-micro uppercase text-white/60 backdrop-blur-sm">
            Awaiting GPS
          </span>
        )}
        {distance ? (
          <span className="ml-auto rounded-pill bg-black/45 px-2.5 py-1 text-numeric tabular-nums text-white backdrop-blur-sm">
            {distance}
            {eta ? ` · ETA ${eta}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function InfoTile({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-panel border border-card-line bg-card-raised p-4">
      <p className="flex items-center gap-2 text-xs font-bold uppercase text-subtle-foreground">
        <span className="text-brand-orange">{icon}</span>
        {label}
      </p>
      <p className="mt-2 truncate text-sm font-semibold text-brand-navy">{value}</p>
      <p className="mt-1 truncate text-xs text-subtle-foreground">{detail}</p>
    </div>
  )
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

function ResponsePanel({ alert, team }: { alert: EmergencyAlert; team: EmergencyAlert["assignments"] }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const roster = team ?? []
  const phone = alert.reporter_phone?.trim()
  const unacknowledged = roster.filter((assignment) => !assignment.acknowledged_at)
  const waiting = elapsedSince(alert.routed_at, now)

  return (
    <div className="rounded-panel border border-card-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-brand-navy">
          Responding {roster.length > 0 ? `· ${roster.length} unit${roster.length === 1 ? "" : "s"}` : ""}
        </p>
        {phone ? (
          <a
            href={`tel:${phone.replace(/[^\d+]/g, "")}`}
            className="inline-flex items-center gap-1.5 rounded-control bg-brand-orange px-3 py-1.5 text-xs font-semibold text-brand-orange-ink transition-colors hover:bg-brand-orange-strong"
          >
            <PhoneIcon className="size-3.5" aria-hidden />
            Call reporter
          </a>
        ) : (
          <span className="text-xs font-medium text-subtle-foreground">Reporter contact withheld</span>
        )}
      </div>

      {roster.length === 0 ? (
        <p className="mt-3 rounded-control bg-status-open-surface px-3 py-2 text-xs font-semibold text-status-open-ink">
          No unit assigned{waiting ? ` · routed ${waiting} ago` : ""}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {roster.map((assignment) => {
            const ack = assignment.acknowledged_at
            const arrived = assignment.arrived_at
            return (
              <li
                key={assignment.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control bg-card-raised px-3 py-2"
              >
                <UserCheckIcon className="size-4 shrink-0 text-brand-orange" aria-hidden />
                <span className="text-sm font-semibold text-brand-navy">
                  {responderName(assignment.responder)}
                </span>
                <span className="text-xs font-medium text-subtle-foreground">
                  {unitLabel[assignment.responder.responder_unit || ""]}
                </span>
                {assignment.source === "escalation" ? (
                  <span className="rounded-pill bg-severity-moderate-surface px-2 py-0.5 text-[10px] font-semibold uppercase text-severity-moderate-ink">
                    Escalated
                  </span>
                ) : null}
                <span
                  className={cn(
                    "ml-auto text-xs font-semibold tabular-nums",
                    arrived
                      ? "text-status-closed"
                      : ack
                        ? "text-status-active-ink"
                        : "text-severity-critical",
                  )}
                  title={fullTimestamp(arrived ?? ack ?? assignment.assigned_at)}
                >
                  {arrived
                    ? `On scene · ${formatTime(arrived)}`
                    : ack
                      ? `Acknowledged · ${formatTime(ack)}`
                      : `Unacknowledged ${elapsedSince(assignment.assigned_at, now) ?? ""}`}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {roster.length > 0 && unacknowledged.length > 0 ? (
        <p className="mt-2 text-xs font-medium text-severity-critical">
          {unacknowledged.length} unit{unacknowledged.length === 1 ? "" : "s"} have not acknowledged.
        </p>
      ) : null}
    </div>
  )
}

function IncidentChronology({ alert }: { alert: EmergencyAlert }) {
  const entries = useMemo(() => {
    const rows: Array<{ key: string; at: string; title: string; detail: string }> = []

    for (const event of alert.status_events ?? []) {
      rows.push({
        key: `status-${event.id}`,
        at: event.created_at,
        // event.label describes what happened. Falling back to the status
        // label is what made five different events all read "Emergency
        // received" - the alert's status had not changed between them.
        title: event.label || statusLabel[event.status] || "Update",
        detail: event.note || "Status updated.",
      })
    }

    for (const log of alert.assignment_logs ?? []) {
      rows.push({
        key: `log-${log.id}`,
        at: log.created_at,
        title: log.action.replaceAll("_", " "),
        detail:
          log.note ||
          `${log.old_status || "—"} → ${log.new_status || "—"}${
            log.responder?.full_name ? ` · ${log.responder.full_name}` : ""
          }`,
      })
    }

    return rows.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  }, [alert.status_events, alert.assignment_logs])

  if (entries.length === 0) return null

  return (
    <div className="rounded-panel border border-card-line bg-card p-5">
      <p className="text-sm font-semibold text-brand-navy">Chronology</p>
      <ol className="mt-4 space-y-3">
        {entries.map((entry) => (
          <li key={entry.key} className="flex gap-3">
            <span
              aria-hidden
              className="mt-1.5 size-2 shrink-0 rounded-pill bg-card-line-strong"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold capitalize text-brand-navy">{entry.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-subtle-foreground">{entry.detail}</p>
              <time
                dateTime={entry.at}
                title={fullTimestamp(entry.at)}
                className="mt-0.5 block text-[11px] font-medium tabular-nums text-subtle-foreground"
              >
                {formatTime(entry.at)}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function EmergencyMediaGrid({ media }: { media: EmergencyAlert["media"] }) {
  if (!media.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-panel border border-dashed border-card-line text-label text-subtle-foreground">
        No media attached
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {media.map((item) =>
        item.mime_type.startsWith("image/") ? (
          <button
            key={item.id}
            type="button"
            onClick={() => void openAuthenticatedMedia(item.raw_url, item.original_filename)}
            className="overflow-hidden rounded-control border border-card-line bg-canvas text-left transition hover:border-brand-orange"
          >
            <AuthenticatedMediaImage
              src={item.preview_url}
              alt={item.original_filename}
              className="h-28 w-full object-cover"
            />
            <span className="block truncate px-3 py-2 text-[12px] font-semibold text-muted-foreground">
              {item.original_filename}
            </span>
          </button>
        ) : (
          <a
            key={item.id}
            href={item.raw_url}
            target="_blank"
            rel="noreferrer"
            className="flex h-28 items-center justify-center rounded-control border border-card-line bg-canvas px-3 text-center text-[12px] font-semibold text-muted-foreground transition hover:border-brand-orange hover:text-foreground"
          >
            {item.original_filename}
          </a>
        ),
      )}
    </div>
  )
}

const VERIFICATION_LABELS: Record<string, string> = {
  account: "Signed-in account",
  registered: "Registered mobile number",
  unverified: "Mobile number not verified",
  needs_review: "Account match requires review",
}

function verificationLabel(value?: string | null) {
  return VERIFICATION_LABELS[value ?? ""] ?? "Reporter identity unconfirmed"
}

/**
 * Category, status and readable location first — the three things an official
 * needs before anything else. Raw coordinates sit behind a disclosure so the
 * page reads as an incident, not a database row.
 */
function IncidentHeader({ alert }: { alert: EmergencyAlert }) {
  const [showCoordinates, setShowCoordinates] = useState(false)
  const location = alert.display_location || alert.resolved_location || alert.reported_area || alert.address || alert.barangay
  const unresolved = alert.unresolved_fields ?? []

  return (
    <section className="rounded-panel border border-card-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-heading text-foreground">{emergencyTone(alert.type)}</h2>
        <span className={cn("rounded-pill border px-2.5 py-1 text-[11px] font-semibold", statusClass(alert.status))}>
          {statusLabel[alert.status]}
        </span>
        {alert.category_needs_confirmation ? (
          <span className="rounded-pill bg-severity-moderate-surface px-2.5 py-1 text-[11px] font-semibold text-severity-moderate-ink">
            Category needs confirmation
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-body text-muted-foreground">{alert.note || "No further detail was provided."}</p>

      <div className="mt-3 flex flex-wrap items-baseline gap-2">
        <MapPinIcon className="size-4 shrink-0 text-brand-orange" aria-hidden />
        <span className="text-sm font-semibold text-brand-navy">{location}</span>
        {alert.location_confidence && alert.location_confidence !== "confirmed" ? (
          <span className="rounded-pill bg-severity-moderate-surface px-2 py-0.5 text-[10px] font-semibold uppercase text-severity-moderate-ink">
            {alert.location_confidence === "outside_area" ? "Outside service area" : "Needs confirmation"}
          </span>
        ) : null}
      </div>

      {alert.latitude && alert.longitude ? (
        <button
          type="button"
          onClick={() => setShowCoordinates((current) => !current)}
          className="mt-2 text-[11px] font-semibold text-brand-orange underline"
        >
          {showCoordinates ? "Hide coordinates" : "Show coordinates"}
        </button>
      ) : null}
      {showCoordinates ? (
        <p className="mt-1 text-[11px] tabular-nums text-subtle-foreground">
          {alert.latitude}, {alert.longitude}
        </p>
      ) : null}

      {unresolved.length ? (
        <p className="mt-3 rounded-control bg-severity-moderate-surface px-3 py-2 text-[11px] font-semibold text-severity-moderate-ink">
          Needs review: {unresolved.join(", ")}
        </p>
      ) : null}

      <p className="mt-3 text-[11px] font-semibold text-subtle-foreground">
        Received {formatTime(alert.created_at)}
      </p>
    </section>
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
  const isFinalDisposition = ["resolved", "cancelled", "false_alarm", "invalid"].includes(alert.status)
  const disposition = alert.disposition_reason || alert.resolution_report

  const detailsContent = (
    <div className="space-y-4">
      <IncidentHeader alert={alert} />

      <IncidentMap alert={alert} />

      <div className="rounded-panel border border-card-line bg-card p-4">
        <p className="text-micro uppercase text-subtle-foreground">Reported by</p>
        <p className="mt-1.5 text-heading text-foreground">{alert.reporter.full_name}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-pill bg-card-raised px-2.5 py-1 text-[11px] font-semibold text-brand-navy">
            {verificationLabel(alert.reporter_verification)}
          </span>
          {alert.reporter_phone ? (
            <span className="rounded-pill bg-card-raised px-2.5 py-1 text-[11px] font-semibold tabular-nums text-brand-navy">
              {alert.reporter_phone}
            </span>
          ) : null}
          {alert.location_source === "sms" ? (
            <span className="rounded-pill bg-severity-moderate-surface px-2.5 py-1 text-[11px] font-semibold text-severity-moderate-ink">
              Offline emergency message
            </span>
          ) : null}
        </div>
      </div>

      <ResponsePanel alert={alert} team={activeTeam} />

      <div className="grid gap-3 md:grid-cols-2">
        <InfoTile icon={<MapPinIcon className="size-4" />} label="Road route" value={routeLabel(alert)} detail={alert.current_assignment?.location_history?.length ? `${alert.current_assignment.location_history.length} responder pings saved` : "Waiting for responder GPS"} />
        <InfoTile icon={<ClockIcon className="size-4" />} label="Response duration" value={formatDuration(alert.response_duration_seconds)} detail={alert.resolved_at ? `Closed ${formatTime(alert.resolved_at)}` : "Timer stops on final disposition"} />
      </div>

      {isFinalDisposition ? (
        <div className={cn("rounded-panel border p-5", alert.status === "resolved" ? "border-status-closed/40 bg-status-closed-surface" : "border-severity-critical/40 bg-severity-critical-surface")}>
          <p className="text-sm font-semibold text-brand-navy">Final disposition</p>
          <p className="mt-1 text-xs font-semibold uppercase text-subtle-foreground">{statusLabel[alert.status]}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{disposition || "No final report was provided."}</p>
        </div>
      ) : null}

      {alert.witness_notification_summary ? (
        <div className="rounded-panel border border-status-active/40 bg-status-active-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-brand-navy">Nearby resident safety notice</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {alert.witness_notification_summary.triggered
                  ? "A privacy-limited safety notification was sent. Reporter identity, exact coordinates, and media were not included."
                  : "No eligible verified residents were within the configured notification radius."}
              </p>
            </div>
            <span className="rounded-full bg-card px-3 py-1 text-xs font-semibold text-brand-orange">
              {alert.witness_notification_summary.recipient_count} notified
            </span>
          </div>
          {alert.witness_notification_summary.triggered ? (
            <div className="mt-3 grid gap-2 text-xs font-semibold text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
              <span>{alert.witness_notification_summary.in_app_delivered_count} in-app delivered</span>
              <span>{alert.witness_notification_summary.read_count} opened</span>
              <span>
                {alert.witness_notification_summary.push_delivered_count} push delivered
                {alert.witness_notification_summary.push_failure_count ? ` · ${alert.witness_notification_summary.push_failure_count} failed` : ""}
              </span>
              <span>Nearest: {alert.witness_notification_summary.nearest_distance_meters ?? "—"} m</span>
              <span>Farthest: {alert.witness_notification_summary.farthest_distance_meters ?? "—"} m</span>
              {alert.witness_notification_summary.push_status_counts.not_configured ? (
                <span className="text-severity-moderate-ink">Browser push is not configured for {alert.witness_notification_summary.push_status_counts.not_configured} recipient{alert.witness_notification_summary.push_status_counts.not_configured === 1 ? "" : "s"}.</span>
              ) : null}
              {alert.witness_notification_summary.push_status_counts.not_subscribed ? (
                <span>{alert.witness_notification_summary.push_status_counts.not_subscribed} recipient{alert.witness_notification_summary.push_status_counts.not_subscribed === 1 ? "" : "s"} not subscribed to push.</span>
              ) : null}
              {alert.witness_notification_summary.push_status_counts.disabled ? (
                <span>{alert.witness_notification_summary.push_status_counts.disabled} recipient{alert.witness_notification_summary.push_status_counts.disabled === 1 ? "" : "s"} disabled push.</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <IncidentChronology alert={alert} />
    </div>
  )

  const chatContent = (
    <EmergencyChatPanel
      alertId={alert.id}
      open
      theme="light"
      disabled={alert.status === "cancelled" || alert.status === "resolved"}
      participantHint={
        activeTeam.length
          ? `Group · resident + ${activeTeam.length} responder${activeTeam.length === 1 ? "" : "s"}`
          : "Group · resident + assigned responders"
      }
      className="min-h-[320px]"
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
