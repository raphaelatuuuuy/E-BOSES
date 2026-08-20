"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2Icon, LocateFixedIcon, MinusIcon, PlusIcon } from "lucide-react"
import type leaflet from "leaflet"
import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import {
  drawCoverage,
  insideCoverage,
  OUT_OF_SCOPE_MESSAGE,
  type CoverageInput,
} from "@/features/dashboard/components/map/coverage-layer"
import { loadCoverageContext } from "@/features/dashboard/lib/use-coverage"
import { dotPinHtml, MAP_COLORS } from "@/features/dashboard/components/map/markers"

const DEFAULT_CENTER: [number, number] = [14.6507, 121.1133]

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
  const [error, setError] = useState("")
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  )
  const isOnlineRef = useRef(isOnline)
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
    if (!navigator.geolocation) {
      setError("Your device does not provide location access. Drag the map to set the pin.")
      return
    }
    setGpsBusy(true)
    setError("")
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const lat = coords.latitude
        const lng = coords.longitude
        const locationCheck = isOnlineRef.current ? await validatePin(lat, lng) : null
        setGpsBusy(false)
        onChangeRef.current({
          lat,
          lng,
          accuracy: coords.accuracy,
          source: "gps",
          address: "Pinned location on map",
          addressPrimary: "Pinned location",
          locationCheck,
        })
        mapRef.current?.setView([lat, lng], Math.max(mapRef.current.getZoom(), 17), { animate: true })
      },
      () => {
        setGpsBusy(false)
        setError("Location access was not available. Drag the map to set the pin.")
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
      setIsOnline(true)
    }
    const handleOffline = () => {
      isOnlineRef.current = false
      setIsOnline(false)
    }
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
        setError("Location not supported — move the pin on the map.")
        return
      }
      setGpsBusy(true)
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return
          const lat = pos.coords.latitude
          const lng = pos.coords.longitude
          const locationCheck = isOnlineRef.current ? await validatePin(lat, lng) : null
          if (cancelled) return
          setGpsBusy(false)
          setError("")
          onChangeRef.current({
            lat,
            lng,
            accuracy: pos.coords.accuracy,
            source: "gps",
            address: "Pinned location on map",
            addressPrimary: "Pinned location",
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
          setError("GPS unavailable — drag the map to set your pin.")
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

      const center: [number, number] = value
        ? [value.lat, value.lng]
        : DEFAULT_CENTER

      map = L.map(containerRef.current, {
        center,
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
      })
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 19,
        }
      ).addTo(map)

      const coverageGroup = L.layerGroup().addTo(map)
      try {
        const context = await loadCoverageContext()
        if (!cancelled) {
          coverageRef.current = {
            boundary: context.boundary?.geometry ?? null,
            policy: context.dispatch_policy,
          }
          drawCoverage(L, coverageGroup, coverageRef.current)
          const c = map.getCenter()
          setOutOfScope(!insideCoverage(c.lat, c.lng, coverageRef.current))
        }
      } catch {
        // The backend still validates the pin when the SOS is submitted.
      }

      // Fires while the map is still moving, so the pin can say no before the
      // resident lets go rather than a third of a second afterwards.
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
            const locationCheck = isOnlineRef.current ? await validatePin(c.lat, c.lng) : null
            setError("")
            onChangeRef.current({
              lat: c.lat,
              lng: c.lng,
              accuracy: null,
              source: "manual",
              address: "Pinned location on map",
              addressPrimary: "Pinned location",
              locationCheck,
            })
          })()
        }, 350)
      })

      mapRef.current = map
      // This step mounts inside a wizard panel that is still transitioning, so
      // a single frame measured a collapsed box and no tiles ever painted.
      const observer = new ResizeObserver(() => {
        const box = containerRef.current?.getBoundingClientRect()
        if (!box?.width || !box.height) return
        mapRef.current?.invalidateSize({ animate: false })
      })
      if (containerRef.current) observer.observe(containerRef.current)
      resizeRef.current = observer
      requestAnimationFrame(() => map?.invalidateSize({ animate: false }))
    }

    void init()
    return () => {
      cancelled = true
      resizeRef.current?.disconnect()
      resizeRef.current = null
      if (geocodeTimer) window.clearTimeout(geocodeTimer)
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
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      {!isOnline ? (
        <div
          className="rounded-xl border border-white/20 bg-white/10 px-3.5 py-3 text-[13px] leading-5 text-white/85"
          role="status"
          aria-live="polite"
        >
          You’re offline. Map tiles may not load, but you can still move the pin
          and send its coordinates. An SMS backup appears on Review when configured.
        </div>
      ) : null}

      <div className="relative min-h-[220px] flex-1 overflow-hidden rounded-xl border border-neutral-200 bg-tint">
        <div
          ref={containerRef}
          className={cn(
            "sos-loc-map absolute inset-0 z-0 h-full w-full",
            outOfScope && "is-blocked",
          )}
          aria-label="Emergency location map. Drag the map to move the centered pin."
        />
        <div className="absolute right-2 top-2 z-[600] flex flex-col overflow-hidden rounded-md border border-neutral-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => mapRef.current?.zoomIn()}
            aria-label="Zoom in"
            title="Zoom in"
            className="flex size-[30px] items-center justify-center border-b border-neutral-200 text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            <PlusIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut()}
            aria-label="Zoom out"
            title="Zoom out"
            className="flex size-[30px] items-center justify-center border-b border-neutral-200 text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            <MinusIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => void locateCurrentUser()}
            disabled={gpsBusy}
            aria-label="Use my current location"
            title="Use my current location"
            className="flex size-[30px] items-center justify-center text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
          >
            {gpsBusy ? <Loader2Icon className="size-4 animate-spin" /> : <LocateFixedIcon className="size-4" />}
          </button>
        </div>
        {(() => {
          // Out of scope wins: the server check runs on a debounce, so during a
          // drag it still reports the previous pin as fine.
          const message = outOfScope
            ? `${OUT_OF_SCOPE_MESSAGE}. You may call 911.`
            : friendlyLocationMessage(value?.locationCheck)
          if (!message) return null
          return (
            <div
              className={cn(
                "absolute bottom-2 left-2 right-2 z-[600] rounded-lg border px-3 py-2 text-[12px] font-semibold shadow-sm backdrop-blur-sm",
                outOfScope
                  ? "border-sos/40 bg-sos text-white"
                  : "border-white/70 bg-white/95 text-neutral-700",
              )}
              role="status"
              aria-live="polite"
            >
              {message}
            </div>
          )
        })()}
        {/* Center pin overlay */}
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 z-[500] h-0 w-0"
          aria-hidden
        >
          <span
            className="absolute block"
            style={{ marginLeft: -7, marginTop: -7 }}
            dangerouslySetInnerHTML={{
              __html: dotPinHtml({
                color: outOfScope ? MAP_COLORS.emergency : MAP_COLORS.you,
                size: 14,
                live: !outOfScope,
              }),
            }}
          />
        </div>
        <style>{`
          .sos-loc-map.leaflet-container { width:100%; height:100%; background:#e8eef5; }
          .sos-loc-map img.leaflet-tile { max-width:none !important; }
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
        `}</style>
      </div>

      {error ? (
        <p className="text-[13px] font-medium text-neutral-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
