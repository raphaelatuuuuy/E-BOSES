import { Capacitor } from "@capacitor/core"
import { Geolocation } from "@capacitor/geolocation"

export type SosLocationWatch =
  | { provider: "browser"; id: number }
  | { provider: "capacitor"; id: string }

function nativeLocationError(error: unknown): GeolocationPositionError {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "Could not find your location."
  const permissionDenied = /permission|denied|authorized/i.test(message)
  const code = permissionDenied ? 1 : 2
  return {
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError
}

function nativePosition(position: {
  timestamp: number
  coords: {
    latitude: number
    longitude: number
    accuracy: number
    altitude: number | null
    altitudeAccuracy: number | null | undefined
    heading: number | null
    speed: number | null
  }
}): GeolocationPosition {
  return {
    timestamp: position.timestamp,
    coords: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      altitude: position.coords.altitude,
      altitudeAccuracy: position.coords.altitudeAccuracy ?? null,
      heading: position.coords.heading,
      speed: position.coords.speed,
    },
  } as GeolocationPosition
}

export function usesNativeSosLocation() {
  return Capacitor.getPlatform() === "android"
}

export function hasSosLocationProvider() {
  return usesNativeSosLocation() || Boolean(navigator.geolocation)
}

export async function startSosLocationWatch(
  success: (position: GeolocationPosition) => void,
  error: (positionError: GeolocationPositionError) => void,
  options: PositionOptions
): Promise<SosLocationWatch> {
  if (!usesNativeSosLocation()) {
    if (!navigator.geolocation) throw new Error("GPS is unavailable")
    return {
      provider: "browser",
      id: navigator.geolocation.watchPosition(success, error, options),
    }
  }

  const permissions = await Geolocation.requestPermissions({
    permissions: ["location"],
  })
  if (permissions.location !== "granted") {
    throw nativeLocationError(new Error("Location permission was denied."))
  }

  const id = await Geolocation.watchPosition(
    {
      enableHighAccuracy: options.enableHighAccuracy,
      maximumAge: options.maximumAge,
      timeout: options.timeout,
      interval: 1000,
      minimumUpdateInterval: 1000,
      enableLocationFallback: true,
    },
    (position, watchError) => {
      if (watchError) {
        error(nativeLocationError(watchError))
      } else if (position) {
        success(nativePosition(position))
      }
    }
  )

  return { provider: "capacitor", id }
}

export function stopSosLocationWatch(watch: SosLocationWatch | null) {
  if (!watch) return
  if (watch.provider === "browser") {
    navigator.geolocation?.clearWatch(watch.id)
    return
  }
  void Geolocation.clearWatch({ id: watch.id }).catch(() => {})
}
