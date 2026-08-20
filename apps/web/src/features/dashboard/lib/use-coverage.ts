import { useEffect, useState } from "react"

import { apiRequest } from "@/lib/api"
import type { LiveMapGeometry, MapDispatchPolicy } from "@/features/dashboard/api"

export interface CoverageContext {
  center: { latitude: number; longitude: number; zoom: number }
  bounds: {
    min_latitude: number
    max_latitude: number
    min_longitude: number
    max_longitude: number
  }
  boundary: { name: string; geometry: LiveMapGeometry | null }
  dispatch_policy: MapDispatchPolicy | null
  soft_buffer_meters: number
  hard_reject_meters: number
}

const TTL_MS = 5 * 60 * 1000

let cached: { at: number; value: CoverageContext } | null = null
let inflight: Promise<CoverageContext> | null = null

/**
 * One request for the coverage rules, shared by every map that draws them.
 * Each screen used to fetch this for itself, so opening the report dialog on
 * top of a map asked the server the same question twice.
 */
export function loadCoverageContext(): Promise<CoverageContext> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value)
  if (inflight) return inflight
  inflight = apiRequest<CoverageContext>("/locations/map-context/")
    .then((value) => {
      cached = { at: Date.now(), value }
      return value
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Drops the cache so an edited boundary shows up without a page reload. */
export function invalidateCoverageContext() {
  cached = null
}

export function useCoverageContext(enabled = true) {
  const [context, setContext] = useState<CoverageContext | null>(
    () => (cached && Date.now() - cached.at < TTL_MS ? cached.value : null),
  )

  useEffect(() => {
    if (!enabled || context) return
    let cancelled = false
    void loadCoverageContext()
      .then((value) => {
        if (!cancelled) setContext(value)
      })
      .catch(() => {
        if (!cancelled) setContext(null)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, context])

  return context
}
