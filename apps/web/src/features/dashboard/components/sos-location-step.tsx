"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2Icon } from "lucide-react"
import type leaflet from "leaflet"

import { cn } from "@workspace/ui/lib/utils"
import { matchMarikinaHeightsStreet } from "@/features/auth/lib/marikina-heights-streets"
import { reverseGeocodeToMarikinaStreet } from "@/features/auth/lib/reverse-geocode"
import { buildPinnedCoordinateAddress } from "@/features/dashboard/components/sos-fallback"

const DEFAULT_CENTER: [number, number] = [14.6507, 121.1133]

export type SosLocationValue = {
  lat: number
  lng: number
  accuracy?: number | null
  source: "gps" | "manual"
  address: string
  addressPrimary: string
}

async function reverseStreet(
  lat: number,
  lng: number
): Promise<{ primary: string; full: string }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return buildPinnedCoordinateAddress(lat, lng)
  }
  try {
    const matched = await reverseGeocodeToMarikinaStreet(lat, lng)
    if (matched.ok && matched.street) {
      const primary = matched.houseNumber
        ? `${matched.houseNumber} ${matched.street}`
        : matched.street
      return { primary, full: `${primary}, Marikina Heights` }
    }
  } catch {
    /* fall through */
  }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "E-Boses/1.0 (sos-location)",
      },
    })
    if (!res.ok) throw new Error("reverse failed")
    const data = (await res.json()) as {
      address?: Record<string, string>
      display_name?: string
    }
    const a = data.address ?? {}
    const road = (a.road || a.pedestrian || a.residential || "").trim()
    const curated = road ? matchMarikinaHeightsStreet(road) : null
    const primary =
      curated ||
      road ||
      (data.display_name ?? "").split(",")[0]?.trim() ||
      "Pinned location"
    if (
      /^lat\b/i.test(primary) ||
      primary.toLowerCase() === "marikina heights"
    ) {
      return { primary: "Move pin to a street", full: "" }
    }
    const secondary = a.suburb || a.neighbourhood || "Marikina Heights"
    return { primary, full: `${primary}, ${secondary}` }
  } catch {
    return buildPinnedCoordinateAddress(lat, lng)
  }
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
  const [geocoding, setGeocoding] = useState(false)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [error, setError] = useState("")
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  )
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
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
          setGeocoding(true)
          const street = await reverseStreet(lat, lng)
          if (cancelled) return
          setGeocoding(false)
          setGpsBusy(false)
          setError(
            street.primary === "Pinned coordinates"
              ? "Street lookup is unavailable. Your exact pinned coordinates can still be sent."
              : ""
          )
          onChangeRef.current({
            lat,
            lng,
            accuracy: pos.coords.accuracy,
            source: "gps",
            address: street.full || street.primary,
            addressPrimary: street.primary,
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
      L.control.zoom({ position: "topright" }).addTo(map)
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 19,
        }
      ).addTo(map)

      map.on("moveend", () => {
        if (ignoreMove.current || !map) return
        const c = map.getCenter()
        if (geocodeTimer) window.clearTimeout(geocodeTimer)
        geocodeTimer = window.setTimeout(() => {
          void (async () => {
            setGeocoding(true)
            const street = await reverseStreet(c.lat, c.lng)
            setGeocoding(false)
            setError(
              street.primary === "Pinned coordinates"
                ? "Street lookup is unavailable. Your exact pinned coordinates can still be sent."
                : ""
            )
            onChangeRef.current({
              lat: c.lat,
              lng: c.lng,
              accuracy: null,
              source: "manual",
              address: street.full || street.primary,
              addressPrimary: street.primary,
            })
          })()
        }, 350)
      })

      mapRef.current = map
      requestAnimationFrame(() => map?.invalidateSize())
    }

    void init()
    return () => {
      cancelled = true
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

  const primary = value?.addressPrimary || value?.address || ""
  const usable =
    Boolean(primary) &&
    primary !== "Move pin to a street" &&
    !/^lat\b/i.test(primary)

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      {!isOnline ? (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13px] leading-5 text-amber-900"
          role="status"
          aria-live="polite"
        >
          You’re offline. Street names and map tiles may not load, but you can
          still move the pin and send its coordinates. An SMS backup appears on
          Review when configured.
        </div>
      ) : null}

      <div
        className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3.5 py-3"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <img
          src="/contents/map-pin-gps.png"
          alt=""
          className="size-6 shrink-0 object-contain"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-neutral-900">
            {gpsBusy || geocoding
              ? "Finding street…"
              : usable
                ? primary
                : "Move pin to a street"}
          </p>
          <p className="text-[12px] text-neutral-500">
            Drag the map to adjust · pin stays centered
          </p>
        </div>
        {(gpsBusy || geocoding) && (
          <Loader2Icon
            className="size-4 shrink-0 animate-spin text-neutral-400"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="relative min-h-[220px] flex-1 overflow-hidden rounded-xl border border-neutral-200 bg-[#e8eef5]">
        <div
          ref={containerRef}
          className="sos-loc-map absolute inset-0 z-0 h-full w-full"
          aria-label="Emergency location map. Drag the map to move the centered pin."
        />
        {/* Center pin overlay */}
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 z-[500] h-0 w-0"
          aria-hidden
        >
          <span
            className="absolute block size-3.5 rounded-full border-[2.5px] border-white bg-[#2b7fff] shadow-[0_2px_8px_rgba(37,99,235,.45)]"
            style={{ marginLeft: -7, marginTop: -7 }}
          />
          <span
            className="absolute size-5 rounded-full bg-[#2b7fff]/20"
            style={{ marginLeft: -10, marginTop: -10 }}
          />
        </div>
        <style>{`
          .sos-loc-map.leaflet-container { width:100%; height:100%; background:#e8eef5; }
          .sos-loc-map .leaflet-control-zoom {
            border:1px solid #e5e7eb !important; border-radius:10px !important; overflow:hidden;
            box-shadow:0 4px 14px rgba(15,23,42,.1);
          }
          .sos-loc-map .leaflet-control-zoom a {
            width:30px !important; height:30px !important; line-height:30px !important;
            color:#171717 !important; background:#fff !important;
          }
          .sos-loc-map img.leaflet-tile { max-width:none !important; }
        `}</style>
      </div>

      {error ? (
        <p className="text-[13px] font-medium text-amber-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
