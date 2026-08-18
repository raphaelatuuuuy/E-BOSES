import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type leaflet from "leaflet"
import { AlertTriangleIcon, HomeIcon, PlusIcon, XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import { PageHeader, PageSection } from "@/components/ui/page-header"
import { Note } from "@/components/ui/note"
import { MAP_COLORS } from "@/features/dashboard/components/alerts-map/lib"

interface CoverageGeometry {
  type: string
  coordinates: number[][][] | number[][][][]
}

interface CoverageArea {
  id: number
  name: string
  locality: string
  is_home: boolean
  geometry: CoverageGeometry | null
}

interface CoveragePayload {
  home_id: number | null
  home_locality: string
  covered: CoverageArea[]
  available: CoverageArea[]
}

const HOME_LOCALITY_FALLBACK = "Marikina"

const COLORS = {
  ground: "#050d33",
  locked: "#101c4c",
  lockedEdge: "#55618f",
  covered: MAP_COLORS.concern,
  coveredNeighbourEdge: "#ff8a45",
  outside: "#f2a03d",
}

/** Every ring in a Polygon or MultiPolygon, as Leaflet [lat, lng] pairs. */
function geometryToRings(geometry: CoverageGeometry | null): [number, number][][] {
  if (!geometry?.coordinates?.length) return []
  const polygons =
    geometry.type === "MultiPolygon"
      ? (geometry.coordinates as number[][][][])
      : [geometry.coordinates as number[][][]]

  const rings: [number, number][][] = []
  for (const polygon of polygons) {
    const outer = polygon?.[0]
    if (!outer?.length) continue
    rings.push(outer.map(([lng, lat]) => [lat, lng] as [number, number]))
  }
  return rings
}

export default function OfficialCoverageAreaPage() {
  const [data, setData] = useState<CoveragePayload | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const layersRef = useRef<leaflet.LayerGroup | null>(null)
  const framedRef = useRef(false)
  const [mapReady, setMapReady] = useState(false)

  const load = useCallback(async () => {
    try {
      const payload = await apiRequest<CoveragePayload>("/config/coverage/")
      setData(payload)
      setSelected(payload.covered.map((row) => row.id))
      setError("")
    } catch {
      setError("Coverage could not be loaded. Check that barangay boundaries have been imported.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Everything the map draws, keyed by id, so a click can look an area up
  // without searching two lists.
  const areas = useMemo(() => {
    const map = new Map<number, CoverageArea>()
    for (const row of data?.covered ?? []) map.set(row.id, row)
    for (const row of data?.available ?? []) map.set(row.id, row)
    return map
  }, [data])

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const covered = useMemo(
    () =>
      selected
        .map((id) => areas.get(id))
        .filter((row): row is CoverageArea => Boolean(row))
        .sort((a, b) => Number(b.is_home) - Number(a.is_home) || a.name.localeCompare(b.name)),
    [selected, areas],
  )

  const available = useMemo(
    () => (data?.available ?? []).filter((row) => !selectedSet.has(row.id)),
    [data, selectedSet],
  )

  const dirty = useMemo(() => {
    const saved = new Set((data?.covered ?? []).map((row) => row.id))
    return saved.size !== selectedSet.size || [...selectedSet].some((id) => !saved.has(id))
  }, [data, selectedSet])

  const toggle = useCallback(
    (id: number) => {
      const area = areas.get(id)
      if (!area || area.is_home) return
      setNotice("")
      setSelected((current) =>
        current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      )
    },
    [areas],
  )

  const save = useCallback(async () => {
    setSaving(true)
    setError("")
    try {
      const payload = await apiRequest<CoveragePayload>("/config/coverage/", {
        method: "PUT",
        body: JSON.stringify({ covered: selected }),
      })
      setData(payload)
      setSelected(payload.covered.map((row) => row.id))
      setNotice("Coverage saved.")
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Coverage could not be saved.",
      )
    } finally {
      setSaving(false)
    }
  }, [selected])

  // Leaflet is built imperatively here for the same reason as the alerts map:
  // the layer set is redrawn wholesale on every selection change, which React
  // reconciliation would only get in the way of.
  useEffect(() => {
    let cancelled = false
    let observer: ResizeObserver | null = null

    void (async () => {
      const L = (await import("leaflet")).default
      if (cancelled || !containerRef.current || mapRef.current) return

      LRef.current = L
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true,
        markerZoomAnimation: false,
      }).setView([14.6507, 121.1133], 14)

      containerRef.current.classList.add("eboses-map-dark")
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        maxZoom: 20,
        subdomains: "abcd",
        keepBuffer: 6,
      }).addTo(map)

      layersRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      setMapReady(true)

      // The container has no height until the flex chain resolves, and Leaflet
      // measures exactly once at construction.
      observer = new ResizeObserver(() => {
        mapRef.current?.invalidateSize()
      })
      observer.observe(containerRef.current)
    })()

    return () => {
      cancelled = true
      observer?.disconnect()
      mapRef.current?.remove()
      mapRef.current = null
      layersRef.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    const group = layersRef.current
    if (!L || !map || !group || !mapReady || !data) return

    group.clearLayers()

    const homeLocality = data.home_locality || HOME_LOCALITY_FALLBACK
    const bounds = L.latLngBounds([])

    // Covered areas keep the live tiles. Everything offered but not yet chosen
    // is painted over with a flat fill, so an official can tell at a glance
    // what they are answering for and what they are only being offered.
    for (const area of areas.values()) {
      const isCovered = selectedSet.has(area.id)
      const rings = geometryToRings(area.geometry)
      if (!rings.length) continue

      const outside = Boolean(area.locality) && area.locality !== homeLocality

      for (const ring of rings) {
        const polygon = isCovered
          ? L.polygon(ring, {
              color: area.is_home
                ? COLORS.covered
                : outside
                  ? COLORS.outside
                  : COLORS.coveredNeighbourEdge,
              weight: area.is_home ? 2.4 : 1.8,
              opacity: 0.95,
              fillOpacity: 0,
              interactive: !area.is_home,
            })
          : L.polygon(ring, {
              color: COLORS.lockedEdge,
              weight: 1,
              opacity: 0.9,
              dashArray: "5 5",
              fillColor: COLORS.locked,
              fillOpacity: outside ? 0.82 : 0.94,
              interactive: true,
            })

        polygon.addTo(group)
        bounds.extend(polygon.getBounds())

        if (!area.is_home) {
          polygon.on("click", () => toggle(area.id))
          polygon.on("mouseover", () => {
            if (!isCovered) polygon.setStyle({ fillColor: "#17245c" })
          })
          polygon.on("mouseout", () => {
            if (!isCovered) polygon.setStyle({ fillColor: COLORS.locked })
          })
        }
      }

      const center = L.polygon(rings[0]).getBounds().getCenter()
      const sub = area.is_home
        ? "Home barangay"
        : isCovered
          ? outside
            ? area.locality
            : "Covered"
          : outside
            ? `${area.locality} · Tap to add`
            : "Tap to add"

      L.marker(center, {
        interactive: false,
        icon: L.divIcon({
          className: "eboses-coverage-label",
          html: `<span class="eboses-coverage-label__name${isCovered ? " is-covered" : ""}">${area.name}</span><span class="eboses-coverage-label__sub">${sub}</span>`,
          iconSize: [0, 0],
        }),
      }).addTo(group)
    }

    if (!framedRef.current && bounds.isValid()) {
      framedRef.current = true
      map.fitBounds(bounds, { padding: [28, 28] })
    }
  }, [data, areas, selectedSet, mapReady, toggle])

  const outsideLocalities = useMemo(
    () =>
      [
        ...new Set(
          covered
            .filter((row) => row.locality && row.locality !== (data?.home_locality || HOME_LOCALITY_FALLBACK))
            .map((row) => row.locality),
        ),
      ].sort(),
    [covered, data],
  )

  return (
    <div className="min-h-full bg-white">
      <div className="mx-auto w-full max-w-[1100px] px-6 pt-12 pb-40 sm:px-10 sm:pb-28">
        <PageHeader
          title="Coverage area"
          subtitle="The barangays this station answers for. Reports and SOS calls are accepted from anywhere inside them."
          actions={
            <div className="text-right">
              <span className="block text-page-title text-brand-navy tabular-nums">
                {covered.length}
              </span>
              <span className="block text-meta text-neutral-400">
                {covered.length === 1 ? "barangay covered" : "barangays covered"}
              </span>
            </div>
          }
        />

        {error ? <Note className="mt-8">{error}</Note> : null}
        {notice ? <Note className="mt-8">{notice}</Note> : null}

        {outsideLocalities.length ? (
          <p className="mt-8 flex items-start gap-2 text-meta text-neutral-500">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
            <span>
              Coverage crosses the city line into {outsideLocalities.join(", ")}. Responders there
              are outside this barangay&rsquo;s jurisdiction — only keep this if a mutual-aid
              arrangement is in place.
            </span>
          </p>
        ) : null}

        <PageSection
          title="Map"
          description="Tap a dimmed barangay to bring it into coverage. Its own neighbours appear once it is added."
        >
          <div className="overflow-hidden rounded-2xl border border-neutral-200">
            <div ref={containerRef} className="h-[560px] w-full bg-[#050d33]" />
          </div>
        </PageSection>

        <PageSection title="In coverage">
          <div className="border-t border-neutral-200">
            {covered.map((area) => (
              <div
                key={area.id}
                className="flex items-center gap-3 border-b border-neutral-200 py-3"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: area.is_home ? COLORS.covered : COLORS.coveredNeighbourEdge }}
                />
                <span className="flex-1 text-row text-brand-navy">{area.name}</span>
                <span className="text-meta text-neutral-400">{area.locality}</span>
                {area.is_home ? (
                  <span className="flex items-center gap-1 text-meta text-neutral-400">
                    <HomeIcon className="size-4" strokeWidth={1.7} aria-hidden />
                    Home
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggle(area.id)}
                    className="flex items-center gap-1 text-meta text-neutral-500 transition-colors hover:text-accent"
                  >
                    <XIcon className="size-4" strokeWidth={1.7} aria-hidden />
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </PageSection>

        <PageSection title="Next to coverage">
          {available.length === 0 ? (
            <p className="text-read text-neutral-500">
              {loading
                ? "Loading neighbouring barangays…"
                : "Every neighbouring barangay is already covered."}
            </p>
          ) : (
            <div className="border-t border-neutral-200">
              {available.map((area) => {
                const outside =
                  Boolean(area.locality) &&
                  area.locality !== (data?.home_locality || HOME_LOCALITY_FALLBACK)
                return (
                  <button
                    key={area.id}
                    type="button"
                    onClick={() => toggle(area.id)}
                    className="group flex w-full items-center gap-3 border-b border-neutral-200 py-3 text-left"
                  >
                    <span className="size-2 shrink-0 rounded-full bg-neutral-300" />
                    <span className="flex-1 text-row text-brand-navy transition-colors group-hover:text-accent">
                      {area.name}
                    </span>
                    <span
                      className={cn(
                        "text-meta text-neutral-400",
                        outside && "text-neutral-500",
                      )}
                    >
                      {outside ? `${area.locality} · outside Marikina` : area.locality}
                    </span>
                    <span className="flex items-center gap-1 text-meta text-neutral-500 transition-colors group-hover:text-accent">
                      <PlusIcon className="size-4" strokeWidth={1.7} aria-hidden />
                      Add
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </PageSection>

        <div className="mt-10 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="rounded-xl bg-accent px-5 py-2.5 text-read font-medium text-white transition-opacity disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save coverage"}
          </button>
          <button
            type="button"
            onClick={() => setSelected((data?.covered ?? []).map((row) => row.id))}
            disabled={!dirty || saving}
            className="rounded-xl border border-neutral-300 px-5 py-2.5 text-read font-medium text-neutral-600 transition-colors hover:border-neutral-400 hover:text-brand-navy disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
