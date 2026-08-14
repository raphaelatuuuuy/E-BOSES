/** Buffers responder GPS pings while the connection is down. */

export interface QueuedGpsPing {
  alertId: number
  latitude: number
  longitude: number
  /** Absent when the fix was restored from storage without one. */
  accuracy?: number
}

const STORAGE_KEY = "eboses:offline-gps-pings"
/** A position every 15s for 75s of dead signal is plenty of context. */
const MAX_QUEUED_PINGS = 5

function read(): QueuedGpsPing[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QueuedGpsPing[]) : []
  } catch {
    return []
  }
}

function write(pings: QueuedGpsPing[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pings))
  } catch {
    // Private mode: the live loop stays the only reporter.
  }
}

/** Keep the latest fix so a dead connection does not cost the journey. */
export function enqueueGpsPing(ping: QueuedGpsPing) {
  write([...read(), ping].slice(-MAX_QUEUED_PINGS))
}

/** Return and clear the pings buffered for one dispatch while offline. */
export function drainGpsPings(alertId: number): QueuedGpsPing[] {
  const pending = read()
  const kept = pending.filter((ping) => ping.alertId !== alertId)
  write(kept)
  return pending.filter((ping) => ping.alertId === alertId)
}
