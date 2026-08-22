import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronLeftIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, XIcon } from "lucide-react"

import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  getOfficialLiveMap,
  type LiveMapEmergency,
  type LiveMapSnapshot,
  type LiveMapUpdate,
  type MapDispatchPolicy,
} from "@/features/dashboard/api"
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import { usePageTitle } from "@/hooks/use-page-title"
import { websocketTicket, websocketUrl } from "@/lib/api"

import { streetOnly } from "@/features/dashboard/lib/location-text"

import { AlertsLeafletMap } from "@/features/dashboard/components/alerts-map/leaflet-map"
import { DetailPanel } from "@/features/dashboard/components/alerts-map/detail-panel"
import {
  isActiveConcern,
  isResolvedRecord,
  isActiveEmergency,
  defaultLayers,
  emptyLiveMapSnapshot,
  formatTime,
  MAP_COLORS,
  mergeUpdate,
  validCoord,
  type LayerKey,
  type Selection,
} from "@/features/dashboard/components/alerts-map/lib"

const SHEET_COLLAPSED = 56

/**
 * Stable identity, created once. The map is memoised on its props, so handing
 * it a fresh empty snapshot each render would rebuild every layer.
 */
const PENDING_SNAPSHOT = emptyLiveMapSnapshot()

/**
 * The alert feed, as a panel that floats over the map.
 *
 * Dark and translucent rather than a solid white rail: on a full-bleed map the
 * rail cut a hard vertical edge through the barangay and stole a fifth of the
 * only view that matters. Floating keeps the map continuous underneath.
 */
function AlertsList({
  feedChips,
  feedChip,
  onFeedChipChange,
  feedItems,
  onSelect,
  isCollapsed,
  areaName,
}: {
  feedChips: readonly string[]
  feedChip: string
  onFeedChipChange: (chip: string) => void
  feedItems: Array<{ kind: "emergency" | "concern"; id: number; title: string; sub: string; time: string; priority?: string }>
  onSelect: (selection: Selection) => void
  isCollapsed?: boolean
  areaName?: string
}) {
  const heading = areaName ? `Alerts in ${areaName}` : "Alerts in your coverage area"

  if (isCollapsed) {
    return (
      <div className="flex min-h-0 flex-col text-white">
        <div className="shrink-0 px-4 pb-2 pt-0.5 text-center">
          <p className="text-[10px] font-semibold text-white/50">{heading}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col text-white">
      <div className="shrink-0 px-4 pt-3.5 text-center">
        <p className="text-[10px] font-semibold text-white/40">{heading}</p>
      </div>

      <div className="shrink-0 px-4 pb-3 pt-3">
        <div className="flex min-w-0 gap-1.5">
          {feedChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onFeedChipChange(chip)}
              aria-pressed={feedChip === chip}
              className={cn(
                "flex h-8 min-w-0 flex-1 items-center justify-center rounded-lg px-2 text-[11.5px] font-bold transition-colors",
                feedChip === chip
                  ? "bg-brand-orange text-white"
                  : "bg-white/8 text-white/55 hover:bg-white/14 hover:text-white",
              )}
            >
              {chip === "all" ? "All" : chip.charAt(0).toUpperCase() + chip.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 [scrollbar-width:thin]">
        {feedItems.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <p className="text-[13px] font-bold text-white/70">Nothing active right now</p>
            <p className="mt-1 text-[11.5px] font-medium leading-snug text-white/40">
              New concerns and emergencies appear here the moment they are filed.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {feedItems.map((item) => {
              const live = item.kind === "emergency"
              return (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: item.kind, id: item.id })}
                    className="flex w-full min-w-0 items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/8"
                  >
                    {/* A lit dot, matching the pin it corresponds to on the map. */}
                    <span className="relative mt-1 flex size-2 shrink-0 items-center justify-center">
                      {live ? (
                        <span className="absolute size-2 animate-ping rounded-full bg-sos opacity-70" />
                      ) : null}
                      <span
                        className="relative size-2 rounded-full"
                        style={{ backgroundColor: live ? MAP_COLORS.emergency : MAP_COLORS.concern }}
                      />
                    </span>

                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[12.5px] font-bold text-white">
                        {item.title}
                      </span>
                      <span className="truncate text-[11px] font-medium text-white/40">
                        {item.sub}
                      </span>
                    </span>

                    <span className="shrink-0 whitespace-nowrap text-[10.5px] font-bold text-white/35">
                      {formatTime(item.time).split(",").at(-1)?.trim()}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function AlertsMapPage() {
  usePageTitle("Alerts Map")
  const { user } = useAuthSession()
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<LiveMapSnapshot | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [layers, setLayers] = useState(defaultLayers)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [selected, setSelected] = useState<Selection>(() => {
    const alertId = Number(new URLSearchParams(window.location.search).get("alert"))
    return Number.isInteger(alertId) && alertId > 0 ? { kind: "emergency", id: alertId } : null
  })
  const [feedChip, setFeedChip] = useState<string>("all")
  // Height of the mobile sheet in px. Two snap points, plus anything the
  // official drags it to in between.
  const [sheetHeight, setSheetHeight] = useState(SHEET_COLLAPSED)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startY: number; startHeight: number; moved: boolean } | null>(null)

  function sheetBounds() {
    return { min: SHEET_COLLAPSED, max: Math.round(window.innerHeight * 0.82) }
  }

  function onSheetPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startY: event.clientY, startHeight: sheetHeight, moved: false }
    setDragging(true)
  }

  function onSheetPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag) return
    // Guard against a stale drag: if no button is held, the pointer is only
    // hovering, and the sheet must not follow the cursor. This is the bug where
    // the sheet "moved on its own" — the drag ref outlived the press.
    if (event.buttons === 0) {
      dragRef.current = null
      setDragging(false)
      return
    }
    // Dragging up grows the sheet, so the delta is inverted.
    const delta = drag.startY - event.clientY
    if (Math.abs(delta) > 4) drag.moved = true
    const { min, max } = sheetBounds()
    setSheetHeight(Math.min(max, Math.max(min, drag.startHeight + delta)))
  }

  function onSheetPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const drag = dragRef.current
    // A tap (no real movement) toggles between the two useful snap points
    // instead of leaving the sheet wherever a stray pixel of drag left it.
    if (drag && !drag.moved) {
      const { min, max } = sheetBounds()
      const expanded = Math.round(max * 0.6)
      setSheetHeight((current) => (current > min + 24 ? min : expanded))
    }
    // Always clear the drag ref, so a later hover over the grab bar cannot move
    // the sheet.
    dragRef.current = null
    setDragging(false)
  }

  async function load() {
    setError("")
    try {
      setSnapshot(await getOfficialLiveMap())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load official live map.")
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(initialLoad)
    }
  }, [])

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let closed = false
    let attempts = 0

    const reconnectDelay = () => {
      attempts += 1
      const backoff = Math.min(30_000, 1500 * 2 ** attempts)
      return backoff / 2 + Math.random() * (backoff / 2)
    }

    async function connect() {
      try {
        const ticket = await websocketTicket()
        if (closed) return
        socket = new WebSocket(
          websocketUrl(`/ws/dashboard/live-map/?ticket=${encodeURIComponent(ticket)}`),
        )
      } catch {
        if (!closed) {
          reconnectTimer = window.setTimeout(() => void connect(), reconnectDelay())
        }
        return
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as LiveMapUpdate
          if (message.type === "concern.ai_assessment.updated") {
            window.dispatchEvent(
              new CustomEvent("eboses:concern-updated", {
                detail: { concernId: message.payload.concern_id, source: "ai_assessment" },
              }),
            )
          }
          setSnapshot((current) => current ? mergeUpdate(current, message) : current)
        } catch {
          // Polling keeps the page correct if a live patch is malformed.
        }
      }
      socket.onopen = () => {
        attempts = 0
      }
      socket.onclose = () => {
        if (!closed) {
          reconnectTimer = window.setTimeout(() => void connect(), reconnectDelay())
        }
      }
      socket.onerror = () => socket?.close()
    }

    void connect()
    return () => {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [user?.id])

  // Memoised: this was recomputed on every render, handing a fresh array
  // identity to the two useMemos below and stopping either from ever hitting.
  const resolvedRecords = useMemo(
    () => ({
      concerns: snapshot?.concerns.filter(isResolvedRecord) ?? [],
      emergencies: snapshot?.emergencies.filter(isResolvedRecord) ?? [],
    }),
    [snapshot],
  )
  const visibleConcerns = useMemo(() => {
    const active = snapshot?.concerns.filter(isActiveConcern) ?? []
    return layers.resolved ? [...active, ...resolvedRecords.concerns] : active
  }, [snapshot, layers.resolved, resolvedRecords])
  const visibleEmergencies = useMemo(() => {
    const active = snapshot?.emergencies.filter(isActiveEmergency) ?? []
    return layers.resolved ? [...active, ...resolvedRecords.emergencies] : active
  }, [snapshot, layers.resolved, resolvedRecords])
  const mapSelectedStreetNames = useMemo(() => new Set<string>(), [])

  const toggleLayer = useCallback((key: LayerKey) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const resetLayers = useCallback(() => setLayers(defaultLayers), [])

  const selectOnMap = useCallback((next: Selection) => {
    setPanelCollapsed(false)
    setSelected(next)
  }, [])

  const clearSelection = useCallback(() => setSelected(null), [])

  const updateEmergency = useCallback((next: LiveMapEmergency) => {
    setSnapshot((current) => current ? { ...current, emergencies: current.emergencies.map((item) => item.id === next.id ? next : item) } : current)
  }, [])

  const updatePolicy = useCallback((next: MapDispatchPolicy) => {
    setSnapshot((current) => current ? { ...current, map: { ...current.map, dispatch_policy: next } } : current)
  }, [])

  const filteredConcerns = useMemo(() => {
    if (!snapshot) return []
    let items = visibleConcerns
    if (feedChip === "emergencies") return []
    if (feedChip !== "all") items = items.filter((c) => c.category === feedChip)
    return items
  }, [snapshot, visibleConcerns, feedChip])

  const feedItems = useMemo(() => {
    if (!snapshot) return []
    const items: Array<{ kind: "emergency" | "concern"; id: number; title: string; sub: string; time: string; priority?: string }> = []
    if (feedChip === "all" || feedChip === "emergencies") {
      // Was iterating snapshot.emergencies raw, so resolved and cancelled
      // incidents stayed in the live feed alongside active ones.
      for (const em of visibleEmergencies) {
        items.push({ kind: "emergency", id: em.id, title: `${em.type} emergency`, sub: streetOnly(em.address?.trim()) || (em.barangay ? `In ${em.barangay}` : ""), time: em.created_at })
      }
    }
    if (feedChip !== "emergencies") {
      for (const c of filteredConcerns) {
        items.push({ kind: "concern", id: c.id, title: c.title, sub: streetOnly(c.address?.trim()) || (c.barangay ? `In ${c.barangay}` : ""), time: c.created_at, priority: c.priority })
      }
    }
    items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    return items.slice(0, 20)
  }, [snapshot, visibleEmergencies, filteredConcerns, feedChip])

  const feedChips = ["all", "concerns", "emergencies"] as const

  /**
   * Counts describe what is actually drawn, not the size of the roster.
   *
   * `summary.residents` is every verified resident in the barangay, but the map
   * can only pin someone whose device has reported a location — so the legend
   * read "Residents 15" beside a single dot. Counting `snapshot.people` instead
   * means the number and the pins can never disagree.
   */
  const mapCounts = useMemo(() => {
    const withLocation = (snapshot?.people ?? []).filter(
      (person) => validCoord(person.latitude, person.longitude) !== null,
    )
    const byRole = (role: string) => withLocation.filter((person) => person.role === role).length
    return {
      residents: byRole("resident"),
      responders: byRole("first_responder"),
      officials: byRole("barangay_official"),
      emergencies: visibleEmergencies.length,
      concerns: visibleConcerns.length,
      advisories: (snapshot?.advisories ?? []).length,
      resolved: resolvedRecords.concerns.length + resolvedRecords.emergencies.length,
    }
  }, [snapshot, visibleConcerns, visibleEmergencies, resolvedRecords])

  // Desktop left panel: list, or the detail panel with its own back/close chrome.
  // Gated on the JS `isDesktop` flag (not just the `lg:block` CSS class) so the
  // DetailPanel — which fetches incident details and mounts the chat panel — isn't
  // double-mounted alongside the mobile Sheet's DetailPanel below.
  const desktopPanelBody = !isDesktop || panelCollapsed ? null : selected ? (
    selected.kind === "emergency" || selected.kind === "concern" ? (
      <div className="flex min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-2">
          <button type="button" onClick={clearSelection} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white" aria-label="Back to the alert list"><ChevronLeftIcon className="size-4.5" strokeWidth={2.25} /></button>
          <p className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-white/60">{selected.kind === "emergency" ? "Emergency" : "Concern"}</p>
          <button type="button" onClick={clearSelection} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white" aria-label="Close"><XIcon className="size-4" /></button>
        </div>
        {/* The panel sits directly on the glass. It used to draw a white card
            inside the navy rail, which is what made it read as cramped. */}
        <div className="staff-dark min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          {snapshot ? <DetailPanel selected={selected} snapshot={snapshot} onClose={clearSelection} onEmergencyUpdated={updateEmergency} /> : null}
        </div>
      </div>
    ) : (
      snapshot ? <div className="staff-dark min-h-0 overflow-y-auto">{<DetailPanel selected={selected} snapshot={snapshot} onClose={clearSelection} onEmergencyUpdated={updateEmergency} />}</div> : null
    )
  ) : (
    <AlertsList feedChips={feedChips} feedChip={feedChip} onFeedChipChange={setFeedChip} feedItems={feedItems} onSelect={setSelected} areaName={snapshot?.map.boundary.name} />
  )


  return (
    // Both `h-full` and `flex-1` are required, because the shell wraps this
    // page in two different kinds of parent:
    //   desktop - <main> is a BLOCK with a definite height, so `h-full` wins
    //             and `flex-1` is inert.
    //   mobile  - <main> is a flex-col of auto height, so `height:100%` has
    //             nothing to resolve against and `flex-1` wins instead.
    // Shipping only one of them collapses the map to zero height on the other
    // breakpoint, which is what rendered the map area as blank.
    <div
      className="relative h-full min-h-0 w-full flex-1 overflow-hidden bg-nav-bg"
      onPointerDown={(e) => {
        if (!isDesktop && sheetHeight > SHEET_COLLAPSED + 24) {
          let el = e.target as HTMLElement | null
          while (el && el !== e.currentTarget) {
            if (el.getAttribute?.("data-sheet") === "true") return
            el = el.parentElement
          }
          setSheetHeight(SHEET_COLLAPSED)
        }
      }}
    >
      {/* Mounted before the fetch resolves: tiles, controls and the legend are
          the map's own chrome and do not need a single record to be useful.
          The snapshot only fills them in. */}
      <AlertsLeafletMap
        snapshot={snapshot ?? PENDING_SNAPSHOT}
        layers={layers}
        selected={selected}
        selectedStreetNames={mapSelectedStreetNames}
        onSelect={selectOnMap}
        onToggleLayer={toggleLayer}
        onResetLayers={resetLayers}
        onPolicyUpdated={updatePolicy}
        counts={mapCounts}
      />

      {!loaded ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[650] -translate-x-1/2 rounded-full border border-white/10 bg-nav-bg/85 px-3 py-1.5 text-[11.5px] font-semibold text-white/70 backdrop-blur-md">
          Loading alerts…
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="absolute inset-x-3 top-3 z-[700] rounded-xl border border-sos/40 bg-nav-bg/90 px-3 py-2 text-[12px] font-bold text-sos backdrop-blur-md"
        >
          {error}
        </div>
      ) : null}

      {/* Desktop: the feed floats over the map instead of cutting a rail. */}
      <div className="pointer-events-none absolute inset-y-3 left-3 z-[600] hidden lg:block">
        {panelCollapsed ? (
          <button
            type="button"
            onClick={() => setPanelCollapsed(false)}
            aria-label="Show the alert list"
            aria-expanded={false}
            className="pointer-events-auto flex size-10 items-center justify-center rounded-xl border border-white/10 bg-nav-bg/85 text-white/75 backdrop-blur-md transition-colors hover:bg-nav-raised/80 hover:text-white"
          >
            <PanelLeftOpenIcon className="size-5" strokeWidth={2.1} />
          </button>
        ) : (
          <div className="pointer-events-auto flex max-h-full min-h-0 w-[19rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-nav-bg/85 backdrop-blur-md">
            <div className="flex shrink-0 items-center justify-end border-b border-white/10 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setPanelCollapsed(true)}
                aria-label="Hide the alert list"
                aria-expanded
                className="flex size-7 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              >
                <PanelLeftCloseIcon className="size-4.5" strokeWidth={2.1} />
              </button>
            </div>
            {desktopPanelBody}
          </div>
        )}
      </div>

      {/* Mobile: back out of the map without hunting for the bottom nav, which
          this route hides so the map can run full-bleed. */}
      <button
        type="button"
        onClick={() => navigate("/dashboard/overview")}
        aria-label="Back to the overview"
        className="absolute left-3 top-3 z-[600] flex size-10 items-center justify-center rounded-xl border border-white/10 bg-nav-bg/80 text-white/75 backdrop-blur-md transition-colors hover:bg-nav-raised/80 hover:text-white lg:hidden"
      >
        <ChevronLeftIcon className="size-5" strokeWidth={2.2} />
      </button>

      {/* Mobile: a real draggable sheet. Drag the grab bar to any height, or
          tap it to snap between the two useful ones. Free dragging matters here
          because how much map an official wants to keep visible depends on
          where the incident is, which no fixed pair of stops can guess. */}
      <div className="absolute inset-x-0 bottom-0 z-[600] lg:hidden">
        <div
          className={cn(
            "flex flex-col overflow-hidden rounded-t-2xl border border-white/10 border-b-0 bg-nav-bg/92 backdrop-blur-md",
            // Only animate on a snap; during a drag the height must track the
            // finger exactly or it feels like it is lagging behind.
            dragging ? "" : "transition-[height] duration-300 ease-out",
          )}
          data-sheet="true"
          style={{ height: sheetHeight }}
        >
          <button
            type="button"
            onPointerDown={onSheetPointerDown}
            onPointerMove={onSheetPointerMove}
            onPointerUp={onSheetPointerUp}
            aria-label="Drag to resize the alert list"
            className="flex shrink-0 touch-none flex-col items-center justify-center py-2 transition-colors hover:bg-white/5"
          >
            <span className="h-1 w-9 rounded-full bg-white/30" />
          </button>

          <AlertsList
            feedChips={feedChips}
            feedChip={feedChip}
            onFeedChipChange={setFeedChip}
            feedItems={feedItems}
            onSelect={setSelected}
            isCollapsed={sheetHeight <= SHEET_COLLAPSED + 24}
            areaName={snapshot?.map.boundary.name}
          />
        </div>
      </div>

      {/* Mobile (<1024px): selected incident/concern opens as a bottom sheet over the full-bleed map. */}
      {!isDesktop ? (
        <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}>
          {/* The sheet is capped at 85vh, so its body must scroll. Without
              `flex` + `min-h-0` + `overflow-y-auto` here, everything below the
              fold — responders, timeline, evidence, actions — was clipped with
              no way to reach it, which read as the details failing to load.
              `overscroll-contain` stops the scroll chaining through to the map
              underneath once the body hits its end. */}
          <SheetContent side="bottom" className="staff-dark flex max-h-[85vh] flex-col border-card-line bg-nav-bg">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
              {snapshot && selected ? <DetailPanel selected={selected} snapshot={snapshot} onClose={clearSelection} onEmergencyUpdated={updateEmergency} /> : null}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}
