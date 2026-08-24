import * as React from "react"
import { LoaderCircleIcon, MapPinIcon, UsersIcon } from "lucide-react"
import type leaflet from "leaflet"

import { FieldError } from "@workspace/ui/components/field"
import { StepContinueButton, StepTitle } from "@/features/auth/components/sign-up-shell"
import type { CommunityResolveResult } from "@/features/auth/api"
import type { SignUpValues } from "@/features/auth/schemas/sign-up-schema"
import { searchGeocode } from "@/lib/geocode"
import { useWeather, weatherLabel } from "@/lib/weather"

interface VerifiedPeekStepProps {
  values: SignUpValues
  resolving: boolean
  onResolve: (input: { latitude: number; longitude: number; accuracy?: number | null; source: "gps" | "search" | "manual" }) => Promise<CommunityResolveResult>
  onContinue: () => void
}

function formatNeighbors(value: number) {
  if (!Number.isFinite(value) || value < 10) return "A growing community"
  if (value < 1000) return `${Math.floor(value / 10) * 10}+ residents`
  return `${Math.round(value / 100) / 10}k+ residents`
}

export function NeighborhoodPeekCards({ street, houseNumber }: { street: string; houseNumber?: string }) {
  return (
    <div className="border-y border-border py-5">
      <p className="text-sm text-muted-foreground">Saved home address</p>
      <p className="mt-1 font-semibold">{[houseNumber, street].filter(Boolean).join(" ")}</p>
    </div>
  )
}

export function VerifiedPeekStep({ values, resolving, onResolve, onContinue }: VerifiedPeekStepProps) {
  const mapElement = React.useRef<HTMLDivElement>(null)
  const map = React.useRef<leaflet.Map | null>(null)
  const marker = React.useRef<leaflet.Marker | null>(null)
  const [error, setError] = React.useState("")
  const autoAttempted = React.useRef(false)
  const match = values.communityMatch
  const weather = useWeather(
    match?.center.latitude ?? values.homeLatitude,
    match?.center.longitude ?? values.homeLongitude,
    match?.name ?? "Your community",
  )

  const confirm = React.useCallback(async (latitude?: number, longitude?: number, source?: "gps" | "search" | "manual") => {
    setError("")
    let lat = latitude ?? values.homeLatitude
    let lng = longitude ?? values.homeLongitude
    let resolvedSource = source ?? values.homeLocationSource ?? "manual"
    if (lat == null || lng == null) {
      const hits = await searchGeocode(values.address, 1)
      lat = Number(hits[0]?.lat)
      lng = Number(hits[0]?.lon)
      resolvedSource = "search"
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("We could not find this address. Use your current location or enter a more complete address.")
      return
    }
    try {
      await onResolve({ latitude: lat!, longitude: lng!, accuracy: values.homeAccuracyMeters, source: resolvedSource })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This point is not inside an active community.")
    }
  }, [onResolve, values.address, values.homeAccuracyMeters, values.homeLatitude, values.homeLocationSource, values.homeLongitude])

  React.useEffect(() => {
    if (match || resolving || autoAttempted.current) return
    autoAttempted.current = true
    void confirm()
  }, [confirm, match, resolving])

  React.useEffect(() => {
    if (!mapElement.current || values.homeLatitude == null || values.homeLongitude == null) return
    let cancelled = false
    void import("leaflet").then((module) => {
      if (cancelled || !mapElement.current) return
      const L = module.default
      map.current?.remove()
      const nextMap = L.map(mapElement.current, { zoomControl: true, attributionControl: true })
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        maxZoom: 20,
      }).addTo(nextMap)
      const point = L.latLng(values.homeLatitude!, values.homeLongitude!)
      marker.current = L.marker(point, { draggable: true }).addTo(nextMap)
      marker.current.on("dragend", () => {
        const moved = marker.current?.getLatLng()
        if (moved) void confirm(moved.lat, moved.lng, "manual")
      })
      if (match?.boundary) {
        const boundary = L.geoJSON(match.boundary as never, {
          style: { color: "#334155", weight: 2, fillColor: "#f97316", fillOpacity: 0.08 },
        }).addTo(nextMap)
        nextMap.fitBounds(boundary.getBounds().extend(point), { padding: [24, 24], maxZoom: 17 })
      } else {
        nextMap.setView(point, 17)
      }
      map.current = nextMap
    })
    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
    }
  }, [confirm, match?.boundary, values.homeLatitude, values.homeLongitude])

  return (
    <div className="flex flex-1 flex-col pt-2">
      <StepTitle>{match ? `Your community is ${match.name}.` : "Confirm your community."}</StepTitle>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        We use the boundary line, not a radius. Drag the pin if it is not on your home.
      </p>

      <div className="relative mt-6 h-64 overflow-hidden rounded-2xl border border-border bg-muted">
        <div ref={mapElement} className="h-full w-full" aria-label="Community boundary and home pin" />
        {resolving ? (
          <div className="absolute inset-0 z-[500] grid place-items-center bg-background/75">
            <LoaderCircleIcon className="size-6 animate-spin" />
          </div>
        ) : null}
      </div>

      {match ? (
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-4 text-sm">
          <div className="flex items-center gap-2"><MapPinIcon className="size-4" />Inside the boundary</div>
          <div className="flex items-center gap-2"><UsersIcon className="size-4" />{formatNeighbors(match.neighbors)}</div>
          <div className="col-span-2 text-muted-foreground">
            Weather: {weather.temperature != null ? `${Math.round(weather.temperature)}°C, ${weatherLabel(weather.code)}` : "—"}
          </div>
        </div>
      ) : null}
      {error ? <FieldError className="mt-3">{error}</FieldError> : null}
      <StepContinueButton disabled={!match || resolving} onClick={onContinue}>Continue</StepContinueButton>
    </div>
  )
}
