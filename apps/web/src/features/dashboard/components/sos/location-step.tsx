"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import LocationPickerModal, {
  type LocationConfirmPayload,
  type PinState,
} from "@/features/dashboard/components/location-picker"
import {
  nearestOfflineStreet,
} from "@/features/dashboard/components/sos/offline-sos-config"
import { watchSosNetwork } from "@/features/dashboard/components/sos/offline-sos-network"
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
  onBack,
  onAdvance,
  error,
  className,
}: {
  value: SosLocationValue | null
  onChange: (next: SosLocationValue) => void
  onBack?: () => void
  onAdvance?: (next: SosLocationValue) => void
  error?: string
  className?: string
}) {
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onAdvanceRef = useRef(onAdvance)
  useEffect(() => {
    onAdvanceRef.current = onAdvance
  }, [onAdvance])
  // `navigator.onLine` only says a network interface exists — a dead hotspot or
  // a reachable network with a down server still reports `true`. The probe
  // answers whether the shared picker can reach its basemap and geocoder;
  // tiles already viewed stay available offline through the map cache.
  const [networkReachable, setNetworkReachable] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false
  )
  const networkRef = useRef(networkReachable)

  useEffect(() => {
    networkRef.current = networkReachable
  }, [networkReachable])

  useEffect(() => {
    const stopWatching = watchSosNetwork((reachable) => {
      setNetworkReachable(reachable)
    })
    return stopWatching
  }, [])

  useEffect(() => {
    valueRef.current = value
  }, [])

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const buildSosLocation = useCallback(
    (pin: PinState): SosLocationValue => {
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
      const offline = networkRef.current === false
      return {
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
    },
    []
  )

  const applyPinState = useCallback(
    (pin: PinState | null) => {
      if (!pin) return
      const next = buildSosLocation(pin)

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
    },
    [buildSosLocation]
  )

  const confirmPin = useCallback(
    (payload: LocationConfirmPayload) => {
      const pin: PinState = {
        lat: payload.lat,
        lng: payload.lng,
        address: payload.address,
        addressPrimary: payload.addressPrimary,
        addressSecondary: payload.addressSecondary,
        ready: true,
        source: payload.source,
        accuracy: null,
      }
      applyPinState(pin)
      // Full-page map has no wizard footer: the pill confirms AND advances.
      const next = buildSosLocation(pin)
      valueRef.current = next
      onChangeRef.current(next)
      onAdvanceRef.current?.(next)
    },
    [applyPinState, buildSosLocation]
  )

  return (
    <div
      className={cn(
        "relative isolate flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-neutral-100 text-neutral-900",
        className
      )}
    >
      {error ? (
        <p
          role="alert"
          className="absolute top-3 right-3 left-3 z-30 rounded-2xl border border-sos/50 bg-[#1a0f0d]/95 px-4 py-2.5 text-center text-[13px] font-medium text-sos-bright shadow-lg"
        >
          {error}
        </p>
      ) : null}
      <LocationPickerModal
        open
        renderInline
        showSearch={false}
        sosStreetSearch
        recenterOnOpen
        showStreetView={false}
        coverageScope="served"
        onClose={() => {}}
        onBackRequest={onBack}
        onConfirm={confirmPin}
        onPinStateChange={applyPinState}
        initialLat={value?.lat ?? null}
        initialLng={value?.lng ?? null}
        initialAddress={value?.addressPrimary ?? value?.address ?? ""}
        offline={!networkReachable}
        offlineAddressLabel={(lat, lng) => nearestOfflineStreet(lat, lng) || null}
      />
    </div>
  )
}
