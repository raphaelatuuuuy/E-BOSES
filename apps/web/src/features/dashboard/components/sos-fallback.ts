const SMS_RECIPIENT_PATTERN = /^\+?\d{7,15}$/

const DB_NAME = "eboses-sos"
const DB_VERSION = 1
const STORE_NAME = "queued-emergencies"

export interface QueuedSosPayload {
  id: string
  clientRequestId: string
  userId: number | null
  type: string
  note: string
  latitude: number
  longitude: number
  address: string
  locationSource: "gps" | "manual_pin" | "network" | "sms" | "sms_landmark"
  locationAccuracy: number | null
  mediaFiles: File[]
  createdAt: string
  retryCount: number
  smsFallbackOpenedAt?: string
}

export function buildEmergencySmsHref(
  configuredRecipient: string,
  message: string
) {
  const recipient = configuredRecipient.trim().replace(/[\s().-]/g, "")
  const body = message.trim()

  if (!SMS_RECIPIENT_PATTERN.test(recipient) || !body) return ""

  return `sms:${recipient}?body=${encodeURIComponent(body)}`
}

export function buildEmergencySmsMessage(payload: {
  requestId?: string
  userId?: number | null
  emergencyType: string
  latitude: number
  longitude: number
  timestamp?: Date
  note?: string
}) {
  const timestamp = payload.timestamp ?? new Date()
  const date = timestamp.toLocaleString("en-PH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  })
  return [
    "EBOSES-SOS",
    "",
    payload.requestId ? `Request ID: ${payload.requestId}` : "",
    `User ID: ${payload.userId ?? ""}`,
    `Emergency Type: ${payload.emergencyType}`,
    `Latitude: ${payload.latitude.toFixed(7)}`,
    `Longitude: ${payload.longitude.toFixed(7)}`,
    `Timestamp: ${date}`,
    "",
    payload.note?.trim() || "Need Immediate Assistance",
  ].filter((line, index) => index < 2 || line !== "").join("\n")
}

function openSosDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Offline queue is not available in this browser."))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Could not open SOS queue."))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openSosDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const request = run(tx.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("SOS queue failed."))
    tx.oncomplete = () => db.close()
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error("SOS queue transaction failed."))
    }
  })
}

export async function enqueueSosEmergency(payload: QueuedSosPayload) {
  const existing = await listQueuedSosEmergencies()
  for (const item of existing.slice(0, Math.max(0, existing.length - 2))) await deleteQueuedSosEmergency(item.id)
  await withStore("readwrite", (store) =>
    store.put({ ...payload, retryCount: payload.retryCount ?? 0, mediaFiles: payload.mediaFiles.slice(0, 2) }),
  )
}

export function listQueuedSosEmergencies() {
  return withStore<QueuedSosPayload[]>("readonly", (store) => store.getAll())
}

export function deleteQueuedSosEmergency(id: string) {
  return withStore<undefined>("readwrite", (store) => store.delete(id) as IDBRequest<undefined>)
}

export function buildPinnedCoordinateAddress(lat: number, lng: number) {
  const coordinates = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  return {
    primary: "Pinned coordinates",
    full: `Pinned coordinates: ${coordinates}`,
  }
}

export function isSosLocationReady(
  value: {
    lat: number
    lng: number
    address?: string
    addressPrimary?: string
  } | null
) {
  if (!value) return false
  const primary = (value.addressPrimary || value.address || "").trim()
  if (!primary || primary === "Move pin to a street") return false
  if (/^lat\b/i.test(primary)) return false
  return Number.isFinite(value.lat) && Number.isFinite(value.lng)
}
