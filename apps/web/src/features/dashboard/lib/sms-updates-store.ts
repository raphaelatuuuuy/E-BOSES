import type { SmsUpdateStage } from "./sms-update-parser"

export interface StoredSmsUpdate {
  stage: SmsUpdateStage
  body: string
  receivedAt: string
}

const STORAGE_KEY = "eboses:sms-updates:v1"
const MAX_UPDATES = 10

type StoredShape = Record<string, Record<string, StoredSmsUpdate[]>>

function keyFor(userId: number | null | undefined) {
  return `user:${userId ?? "guest"}`
}

function readAll(): StoredShape {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null
      ? (parsed as StoredShape)
      : {}
  } catch {
    return {}
  }
}

function writeAll(shape: StoredShape) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape))
  } catch {
    // Private mode: SMS updates simply do not persist.
  }
}

export function listSmsUpdates(
  userId: number | null | undefined,
  alertId: number
): StoredSmsUpdate[] {
  const scoped = readAll()[keyFor(userId)]?.[String(alertId)]
  return Array.isArray(scoped) ? scoped : []
}

export function saveSmsUpdate(
  userId: number | null | undefined,
  alertId: number,
  entry: StoredSmsUpdate
): StoredSmsUpdate[] {
  const all = readAll()
  const userKey = keyFor(userId)
  const scoped = { ...(all[userKey] ?? {}) }
  const next = [
    ...(scoped[String(alertId)] ?? []).filter(
      (item) => item.stage !== entry.stage
    ),
    entry,
  ].slice(-MAX_UPDATES)
  writeAll({ ...all, [userKey]: { ...scoped, [String(alertId)]: next } })
  return next
}

export function clearSmsUpdates(
  userId: number | null | undefined,
  alertId: number
) {
  const all = readAll()
  const userKey = keyFor(userId)
  const scoped = { ...(all[userKey] ?? {}) }
  delete scoped[String(alertId)]
  writeAll({ ...all, [userKey]: scoped })
}
