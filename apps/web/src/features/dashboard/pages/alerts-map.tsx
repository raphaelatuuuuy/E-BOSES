import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronLeftIcon, XIcon } from "lucide-react"

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

import { AlertsLeafletMap } from "@/features/dashboard/components/alerts-map/leaflet-map"
import { DetailPanel } from "@/features/dashboard/components/alerts-map/detail-panel"
import {
  isActiveConcern,
  isActiveEmergency,
  defaultLayers,
  formatTime,
  MAP_COLORS,
  mergeUpdate,
  validCoord,
  type LayerKey,
  type Selection,
} from "@/features/dashboard/components/alerts-map/lib"

const SHEET_COLLAPSED = 56

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
}: {
  feedChips: readonly string[]
  feedChip: string
  onFeedChipChange: (chip: string) => void
  feedItems: Array<{ kind: "emergency" | "concern"; id: number; title: string; sub: string; time: string; priority?: string }>
  onSelect: (selection: Selection) => void
  isCollapsed?: boolean
}) {
  if (isCollapsed) {
    return (
      <div className="flex min-h-0 flex-col text-white">
        <div className="shrink-0 px-4 pb-2 pt-0.5 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/50">
            Marikina Heights
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col text-white">
      <div className="shrink-0 px-4 pt-3.5 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">
          Marikina Heights
        </p>
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

    async function connect() {
      try {
        const ticket = await websocketTicket()
        if (closed) return
        socket = new WebSocket(
          websocketUrl(`/ws/dashboard/live-map/?ticket=${encodeURIComponent(ticket)}`),
        )
      } catch {
        if (!closed) {
          reconnectTimer = window.setTimeout(() => void connect(), 5000)
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
      socket.onclose = () => {
        if (!closed) {
          reconnectTimer = window.setTimeout(() => void connect(), 5000)
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
  const visibleConcerns = useMemo(
    () => snapshot?.concerns.filter(isActiveConcern) ?? [],
    [snapshot],
  )
  const visibleEmergencies = useMemo(
    () => snapshot?.emergencies.filter(isActiveEmergency) ?? [],
    [snapshot],
  )
  const mapSelectedStreetNames = useMemo(() => new Set<string>(), [])

  function toggleLayer(key: LayerKey) {
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }

  function updateEmergency(next: LiveMapEmergency) {
    setSnapshot((current) => current ? { ...current, emergencies: current.emergencies.map((item) => item.id === next.id ? next : item) } : current)
  }

  function updatePolicy(next: MapDispatchPolicy) {
    setSnapshot((current) => current ? { ...current, map: { ...current.map, dispatch_policy: next } } : current)
  }

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
        items.push({ kind: "emergency", id: em.id, title: `${em.type} emergency`, sub: em.address || em.barangay, time: em.created_at })
      }
    }
    if (feedChip !== "emergencies") {
      for (const c of filteredConcerns) {
        items.push({ kind: "concern", id: c.id, title: c.title, sub: c.address || c.barangay, time: c.created_at, priority: c.priority })
      }
    }
    items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    return items.slice(0, 20)
  }, [snapshot, filteredConcerns, feedChip])

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
    if (!snapshot) return null
    const withLocation = snapshot.people.filter(
      (person) => validCoord(person.latitude, person.longitude) !== null,
    )
    const byRole = (role: string) => withLocation.filter((person) => person.role === role).length
    return {
      residents: byRole("resident"),
      responders: byRole("first_responder"),
      officials: byRole("barangay_official"),
      emergencies: visibleEmergencies.length,
      concerns: visibleConcerns.length,
      routes: snapshot.routes.filter((route) => route.status === "ok").length,
    }
  }, [snapshot, visibleConcerns, visibleEmergencies])

  if (!loaded) {
    // Needs `h-full` for the same reason the real return below does (see the
    // comment there): on desktop the shell's <main> is a block with a definite
    // height, so `flex-1` alone is inert and the skeleton collapses to 0px.
    return <div className="h-full min-h-0 w-full flex-1 animate-pulse bg-nav-bg" />
  }

  // Desktop left panel: list, or the detail panel with its own back/close chrome.
  // Gated on the JS `isDesktop` flag (not just the `lg:block` CSS class) so the
  // DetailPanel — which fetches incident details and mounts the chat panel — isn't
  // double-mounted alongside the mobile Sheet's DetailPanel below.
  const desktopPanelBody = !isDesktop ? null : selected ? (
    selected.kind === "emergency" || selected.kind === "concern" ? (
      <div className="flex min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-2">
          <button type="button" onClick={() => setSelected(null)} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white" aria-label="Back to the alert list"><ChevronLeftIcon className="size-4.5" strokeWidth={2.25} /></button>
          <p className="min-w-0 flex-1 truncate text-left text-[13px] font-bold text-white/70">{selected.kind === "emergency" ? "Emergency" : "Concern"}</p>
          <button type="button" onClick={() => setSelected(null)} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white" aria-label="Close"><XIcon className="size-4" /></button>
        </div>
        {/* The detail panel is built for a light surface, so it keeps its own
            white card rather than inheriting the glass. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white p-2 [scrollbar-width:thin]">
          {snapshot ? <DetailPanel selected={selected} snapshot={snapshot} onClose={() => setSelected(null)} onEmergencyUpdated={updateEmergency} /> : null}
        </div>
      </div>
    ) : (
      snapshot ? <div className="min-h-0 overflow-y-auto bg-white p-2">{<DetailPanel selected={selected} snapshot={snapshot} onClose={() => setSelected(null)} onEmergencyUpdated={updateEmergency} />}</div> : null
    )
  ) : (
    <AlertsList feedChips={feedChips} feedChip={feedChip} onFeedChipChange={setFeedChip} feedItems={feedItems} onSelect={setSelected} />
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
      {snapshot && mapCounts ? (
        <AlertsLeafletMap
          snapshot={snapshot}
          layers={layers}
          selected={selected}
          selectedStreetNames={mapSelectedStreetNames}
          onSelect={setSelected}
          onToggleLayer={toggleLayer}
          onResetLayers={() => setLayers(defaultLayers)}
          onPolicyUpdated={updatePolicy}
          counts={mapCounts}
        />
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
      <div className="pointer-events-none absolute inset-y-3 left-3 z-[600] hidden w-[19rem] lg:block">
        <div className="pointer-events-auto flex max-h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-nav-bg/85 backdrop-blur-md">
          {desktopPanelBody}
        </div>
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
          <SheetContent side="bottom" className="flex max-h-[85vh] flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
              {snapshot && selected ? <DetailPanel selected={selected} snapshot={snapshot} onClose={() => setSelected(null)} onEmergencyUpdated={updateEmergency} /> : null}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}
