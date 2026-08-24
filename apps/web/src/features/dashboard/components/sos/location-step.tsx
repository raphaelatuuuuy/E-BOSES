"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2Icon, LocateFixedIcon } from "lucide-react"
import type leaflet from "leaflet"
import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import {
  insideCoverage,
  OUT_OF_SCOPE_MESSAGE,
  type CoverageInput,
} from "@/features/dashboard/components/map/coverage-layer"
import { loadCoverageContext } from "@/features/dashboard/lib/use-coverage"
import { dotPinHtml, MAP_COLORS } from "@/features/dashboard/components/map/markers"
import {
  formatNominatimParts,
  reverseGeocode,
} from "@/lib/geocode"

const DEFAULT_CENTER: [number, number] = [14.6507, 121.1133]

async function describePin(lat: number, lng: number) {
  if (!navigator.onLine) {
    return { address: "Pinned location on map", addressPrimary: "Pinned location" }
  }
  try {
    const data = await reverseGeocode(lat, lng)
    if (!data) {
      return { address: "Pinned location on map", addressPrimary: "Pinned location" }
    }
    const parts = formatNominatimParts(data)
    return {
      address: parts.full || parts.primary,
      addressPrimary: parts.primary,
    }
  } catch {
    return { address: "Pinned location on map", addressPrimary: "Pinned location" }
  }
}

export type SosLocationValue = {
  lat: number
  lng: number
  accuracy?: number | null
  source: "gps" | "manual"
  address: string
  addressPrimary: string
  locationCheck?: SosLocationCheck | null
}

export type SosLocationCheck = {
  accepted: boolean
  status: string
  zone: string
  message: string
  acceptance_zone?: { within: boolean; distance_meters?: number; radius_meters?: number }
}

export function friendlyLocationMessage(check: SosLocationCheck | null | undefined) {
  if (!check) return "Checking your location…"
  if (check.accepted && check.acceptance_zone?.within) {
    return ""
  }
  if (check.zone === "outside_acceptance_zone") {
    return "This area is outside our scope. You may call 911."
  }
  if (check.zone === "outside_barangay" || check.zone === "outside_city") {
    return "This area is outside our scope. You may call 911."
  }
  return "We could not check this area yet. Try again."
}

export function SosLocationStep({
  value,
  onChange,
  className,
}: {
  value: SosLocationValue | null
  onChange: (next: SosLocationValue) => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const ignoreMove = useRef(false)
  const [gpsBusy, setGpsBusy] = useState(false)
  const isOnlineRef = useRef(true)
  const validationRequestRef = useRef(0)
  const onChangeRef = useRef(onChange)
  const resizeRef = useRef<ResizeObserver | null>(null)
  const coverageRef = useRef<CoverageInput>({})
  const [outOfScope, setOutOfScope] = useState(false)

  async function validatePin(lat: number, lng: number) {
    const requestId = ++validationRequestRef.current
    try {
      const result = await apiRequest<SosLocationCheck>("/locations/validate/", {
        method: "POST",
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      })
      return requestId === validationRequestRef.current ? result : null
    } catch {
      return requestId === validationRequestRef.current ? null : null
    }
  }

  async function locateCurrentUser() {
    if (!navigator.geolocation) return
    setGpsBusy(true)
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const lat = coords.latitude
        const lng = coords.longitude
        const [locationCheck, described] = await Promise.all([
          isOnlineRef.current ? validatePin(lat, lng) : null,
          describePin(lat, lng),
        ])
        setGpsBusy(false)
        onChangeRef.current({
          lat,
          lng,
          accuracy: coords.accuracy,
          source: "gps",
          address: described.address,
          addressPrimary: described.addressPrimary,
          locationCheck,
        })
        mapRef.current?.setView([lat, lng], Math.max(mapRef.current.getZoom(), 17), { animate: true })
      },
      () => {
        setGpsBusy(false)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
  }

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const handleOnline = () => {
      isOnlineRef.current = true
    }
    const handleOffline = () => {
      isOnlineRef.current = false
    }
    if (typeof navigator !== "undefined") isOnlineRef.current = navigator.onLine
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  // Auto GPS once on mount
  useEffect(() => {
    let cancelled = false
    let releaseMoveTimer: number | undefined
    const startTimer = window.setTimeout(() => {
      if (cancelled) return
      if (!navigator.geolocation) {
        onChangeRef.current({
          lat: DEFAULT_CENTER[0],
          lng: DEFAULT_CENTER[1],
          accuracy: null,
          source: "manual",
          address: "",
          addressPrimary: "",
          locationCheck: null,
        })
        return
      }
      setGpsBusy(true)
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return
          const lat = pos.coords.latitude
          const lng = pos.coords.longitude
          const [locationCheck, described] = await Promise.all([
            isOnlineRef.current ? validatePin(lat, lng) : null,
            describePin(lat, lng),
          ])
          if (cancelled) return
          setGpsBusy(false)
          onChangeRef.current({
            lat,
            lng,
            accuracy: pos.coords.accuracy,
            source: "gps",
            address: described.address,
            addressPrimary: described.addressPrimary,
            locationCheck,
          })
          const map = mapRef.current
          if (map) {
            ignoreMove.current = true
            map.setView([lat, lng], 17)
            releaseMoveTimer = window.setTimeout(() => {
              ignoreMove.current = false
            }, 400)
          }
        },
        () => {
          if (cancelled) return
          setGpsBusy(false)
          onChangeRef.current({
            lat: DEFAULT_CENTER[0],
            lng: DEFAULT_CENTER[1],
            accuracy: null,
            source: "manual",
            address: "",
            addressPrimary: "",
            locationCheck: null,
          })
        },
        { enableHighAccuracy: true, timeout: 12_000 }
      )
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(startTimer)
      if (releaseMoveTimer) window.clearTimeout(releaseMoveTimer)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let map: leaflet.Map | null = null
    let geocodeTimer: number | undefined
    let styleEl: HTMLStyleElement | null = null
    let settleTimers: number[] = []

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return
      const el = containerRef.current as HTMLDivElement & {
        _leaflet_id?: number
      }
      if (el._leaflet_id) {
        try {
          mapRef.current?.remove()
        } catch {
          /* */
        }
        el._leaflet_id = undefined
      }

      // Same fix as the AreaPicker/pin maps: the tile-size override has to
      // exist in <head> before Leaflet lays out its tile pane, or the 256px
      // tiles collapse under Tailwind Preflight's `img { max-width: 100% }`
      // and the map paints blank.
      styleEl = document.createElement("style")
      styleEl.textContent = `
        .sos-loc-map.leaflet-container {
          width: 100%;
          height: 100%;
          background: #e8eef5;
          font-family: inherit;
        }
        .sos-loc-map .leaflet-tile-pane { isolation: isolate; }
        .sos-loc-map img.leaflet-tile,
        .sos-loc-map .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
      `
      document.head.appendChild(styleEl)

      const center: [number, number] = value
        ? [value.lat, value.lng]
        : DEFAULT_CENTER

      map = L.map(containerRef.current, {
        center,
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: true,
      })
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 19,
        }
      ).addTo(map)

      try {
        const context = await loadCoverageContext()
        if (!cancelled) {
          coverageRef.current = {
            boundary: context.boundary?.geometry ?? null,
            policy: context.dispatch_policy,
          }
          const c = map.getCenter()
          setOutOfScope(!insideCoverage(c.lat, c.lng, coverageRef.current))
        }
      } catch {
        // The backend still validates the pin when the SOS is submitted.
      }

      map.on("move", () => {
        if (!map) return
        const c = map.getCenter()
        setOutOfScope(!insideCoverage(c.lat, c.lng, coverageRef.current))
      })

      map.on("moveend", () => {
        if (ignoreMove.current || !map) return
        const c = map.getCenter()
        if (geocodeTimer) window.clearTimeout(geocodeTimer)
        geocodeTimer = window.setTimeout(() => {
          void (async () => {
            const [locationCheck, described] = await Promise.all([
              isOnlineRef.current ? validatePin(c.lat, c.lng) : null,
              describePin(c.lat, c.lng),
            ])
            onChangeRef.current({
              lat: c.lat,
              lng: c.lng,
              accuracy: null,
              source: "manual",
              address: described.address,
              addressPrimary: described.addressPrimary,
              locationCheck,
            })
          })()
        }, 350)
      })

      mapRef.current = map
      // This step mounts while the dialog is still animating in (zoom/fade),
      // so Leaflet can measure a transformed box and paint blank tiles. The
      // ResizeObserver catches layout changes; the delayed calls re-run after
      // the entry animation has fully settled.
      const observer = new ResizeObserver(() => {
        const box = containerRef.current?.getBoundingClientRect()
        if (!box?.width || !box.height) return
        mapRef.current?.invalidateSize({ animate: false })
      })
      if (containerRef.current) observer.observe(containerRef.current)
      resizeRef.current = observer
      requestAnimationFrame(() => map?.invalidateSize({ animate: false }))
      settleTimers = [300, 700].map((delay) =>
        window.setTimeout(() => map?.invalidateSize({ animate: false }), delay)
      )
    }

    void init()
    return () => {
      cancelled = true
      resizeRef.current?.disconnect()
      resizeRef.current = null
      settleTimers.forEach((t) => window.clearTimeout(t))
      if (geocodeTimer) window.clearTimeout(geocodeTimer)
      styleEl?.remove()
      try {
        map?.off()
        map?.remove()
      } catch {
        /* */
      }
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once; GPS updates view separately
  }, [])

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="relative h-full min-h-[260px] overflow-hidden rounded-2xl border border-white/10 bg-tint">
        <div
          ref={containerRef}
          className={cn(
            "sos-loc-map absolute inset-0 z-0 h-full w-full",
            outOfScope && "is-blocked",
          )}
          aria-label="Emergency location map. Drag the map to move the centered pin."
        />
        <button
          type="button"
          onClick={() => void locateCurrentUser()}
          disabled={gpsBusy}
          aria-label="Use my current location"
          title="Use my current location"
          className="absolute right-2 top-2 z-[600] flex size-[38px] items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-60"
        >
          {gpsBusy ? <Loader2Icon className="size-4 animate-spin" /> : <LocateFixedIcon className="size-4" />}
        </button>
        {outOfScope ? (
          <div
            className="absolute left-1/2 top-1/2 z-[600] w-[min(320px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[28px] bg-white px-6 py-4 text-center shadow-[0_18px_50px_rgba(15,23,42,0.25)]"
            role="status"
            aria-live="polite"
          >
            <p className="text-[15px] font-bold text-neutral-900">
              {OUT_OF_SCOPE_MESSAGE}
            </p>
            <p className="mt-0.5 text-[13px] text-neutral-500">
              Move the map back to a covered area.
            </p>
          </div>
        ) : null}
        {!outOfScope ? (
          <div
            className="pointer-events-none absolute top-1/2 left-1/2 z-[500] h-0 w-0"
            aria-hidden
          >
            <span
              className="absolute block"
              style={{ marginLeft: -7, marginTop: -7 }}
              dangerouslySetInnerHTML={{
                __html: dotPinHtml({
                  color: MAP_COLORS.you,
                  size: 14,
                  live: true,
                }),
              }}
            />
          </div>
        ) : null}
        <style>{`
          .sos-loc-map.is-blocked.leaflet-container,
          .sos-loc-map.is-blocked .leaflet-grab { cursor: not-allowed !important; }
          .sos-loc-map.is-blocked::after {
            content: "";
            position: absolute;
            inset: 0;
            z-index: 450;
            pointer-events: none;
            background: rgba(220, 38, 38, 0.08);
          }
        `}        </style>
      </div>
    </div>
  )
}
