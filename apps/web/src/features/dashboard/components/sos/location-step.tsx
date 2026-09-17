"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import LocationPickerModal, {
  type LocationConfirmPayload,
  type PinState,
} from "@/features/dashboard/components/location-picker"
import {
  nearestOfflineStreet,
} from "@/features/dashboard/components/sos/offline-sos-config"
import { OfflineSosMap } from "@/features/dashboard/components/sos/offline-sos-map"
import { cn } from "@workspace/ui/lib/utils"

export type SosLocationValue = {
  lat: number
  lng: number
  accuracy?: number | null
  source: "gps" | "manual"
  address: string
  addressPrimary: string
  addressResolved?: boolean
  streetDistanceMeters?: number | null
  streetConfidence?: "high" | "medium" | null
  /** Local boundary/radius result used when the network validator is offline or unavailable. */
  coverageAccepted?: boolean
  locationCheck?: SosLocationCheck | null
}

export type SosLocationCheck = {
  accepted: boolean
  status: string
  zone: string
  message: string
  warning?: string | null
  acceptance_zone?: {
    within: boolean
    distance_meters?: number
    radius_meters?: number
  }
}

function acceptedLocationCheck(check: SosLocationCheck | null | undefined) {
  // `accepted` is the server's final boundary-or-acceptance-zone decision.
  // Status is descriptive (and has historically varied between `inside` and
  // `edge`), so it must not become a second, stricter rejection rule.
  return check?.accepted === true
}

export function acceptedSosLocation(
  value: SosLocationValue | null | undefined
) {
  if (value?.coverageAccepted != null) return value.coverageAccepted === true
  return Boolean(acceptedLocationCheck(value?.locationCheck))
}

export function friendlyLocationMessage(
  check: SosLocationCheck | null | undefined
) {
  if (!check || acceptedLocationCheck(check)) return ""
  return (
    check.message ||
    "This location may be outside the service area. Check your pin."
  )
}

function usableAddressPart(value: string | null | undefined) {
  const normalized = value?.trim() || ""
  if (!normalized) return false
  if (
    /^(finding street…|finding street\.\.\.|move the map to adjust|selected location|pinned location)$/i.test(
      normalized
    )
  ) {
    return false
  }
  return !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(normalized)
}

function pendingLocationCheck(): SosLocationCheck {
  return {
    accepted: false,
    status: "pending",
    zone: "",
    message:
      "This location is still being checked. Move the map or wait a moment.",
  }
}

function acceptedLocationCheckValue(): SosLocationCheck {
  return {
    accepted: true,
    status: "inside",
    zone: "",
    message: "",
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
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false
  )
  const [mapFallback, setMapFallback] = useState(false)

  useEffect(() => {
    const update = () => {
      setOffline(navigator.onLine === false)
      setMapFallback(false)
    }
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const applyPinState = useCallback((pin: PinState | null) => {
    if (!pin) return

    const nearbyStreet = nearestOfflineStreet(pin.lat, pin.lng)
    const fallbackPrimary = nearbyStreet
      ? `Nearby ${nearbyStreet}`
      : "Pinned location"
    const primary = usableAddressPart(pin.addressPrimary)
      ? pin.addressPrimary.trim()
      : fallbackPrimary
    const address = usableAddressPart(pin.address)
      ? pin.address.trim()
      : nearbyStreet
        ? `${fallbackPrimary} on the map`
        : "Pinned location on the map"
    const offline =
      typeof navigator !== "undefined" && navigator.onLine === false
    const next: SosLocationValue = {
      lat: pin.lat,
      lng: pin.lng,
      source: pin.source === "gps" ? "gps" : "manual",
      accuracy: pin.accuracy ?? null,
      address,
      addressPrimary: primary,
      addressResolved: pin.ready || Boolean(nearbyStreet),
      // The shared picker is the online authority. Offline SOS remains usable
      // with finite coordinates and the local address fallback.
      coverageAccepted: pin.ready || offline,
      locationCheck: pin.ready
        ? acceptedLocationCheckValue()
        : offline
          ? null
          : pendingLocationCheck(),
    }

    const previous = valueRef.current
    if (
      previous &&
      previous.lat === next.lat &&
      previous.lng === next.lng &&
      previous.source === next.source &&
      previous.accuracy === next.accuracy &&
      previous.address === next.address &&
      previous.addressPrimary === next.addressPrimary &&
      previous.addressResolved === next.addressResolved &&
      previous.coverageAccepted === next.coverageAccepted &&
      previous.locationCheck?.accepted === next.locationCheck?.accepted &&
      previous.locationCheck?.status === next.locationCheck?.status
    ) {
      return
    }

    valueRef.current = next
    onChangeRef.current(next)
  }, [])

  const confirmPin = useCallback(
    (payload: LocationConfirmPayload) => {
      applyPinState({
        lat: payload.lat,
        lng: payload.lng,
        address: payload.address,
        addressPrimary: payload.addressPrimary,
        addressSecondary: payload.addressSecondary,
        ready: true,
        source: payload.source,
        accuracy: null,
      })
    },
    [applyPinState]
  )

  return (
    <div
      className={cn(
        "relative isolate flex h-full min-h-[320px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-neutral-100 text-neutral-900",
        className
      )}
    >
      {offline && !mapFallback ? (
        <OfflineSosMap
          initialLat={value?.lat ?? null}
          initialLng={value?.lng ?? null}
          initialAddress={value?.addressPrimary ?? value?.address ?? ""}
          onPinStateChange={applyPinState}
          onConfirm={confirmPin}
          onFallback={() => setMapFallback(true)}
          className="min-h-[320px] flex-1"
        />
      ) : (
        <LocationPickerModal
          open
          renderInline
          showSearch={false}
          recenterOnOpen
          showStreetView={false}
          coverageScope="served"
          onClose={() => {}}
          onConfirm={confirmPin}
          onPinStateChange={applyPinState}
          initialLat={value?.lat ?? null}
          initialLng={value?.lng ?? null}
          initialAddress={value?.addressPrimary ?? value?.address ?? ""}
        />
      )}
    </div>
  )
}
