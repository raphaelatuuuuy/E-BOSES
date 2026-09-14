import type { EmergencyQuickQuestion } from "@/features/dashboard/emergency-api"

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
  triage?: SosTriageAnswers
  createdAt: string
  retryCount: number
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

/**
 * Triage answers collected by the SOS wizard.
 *
 * These are rendered into the SMS as ordinary English clauses rather than
 * codes, because the message has to be readable by a person on duty at the
 * barangay hall as well as parseable by the backend. The exact wording is a
 * contract: `apps/api/apps/sms/parsing.py` reads these sentences back out, and
 * the golden fixtures in this file's test suite pin both sides together.
 */
export interface SosTriageAnswers {
  peopleAffected?: "one" | "few" | "many" | "unknown"
  injuries?: "yes" | "no" | "unknown"
  detail?: string
  [key: string]: string | undefined
}

const PEOPLE_CLAUSE: Record<string, string> = {
  one: "1 person affected",
  few: "2-5 people affected",
  many: "6 or more people affected",
  unknown: "number of people affected is unknown",
}

const INJURY_CLAUSE: Record<string, string> = {
  yes: "someone is injured",
  no: "no one is injured",
  unknown: "injuries are unknown",
}

const DETAIL_CLAUSE: Record<string, string> = {
  spreading: "fire is still spreading",
  contained: "fire is not spreading",
  conscious: "person is conscious and breathing",
  unconscious: "person is not conscious or not breathing",
  ankle: "water is ankle deep",
  knee: "water is knee deep",
  waist: "water is waist deep or higher",
  present: "the person is still there",
  gone: "the person has left",
  immediate_danger: "someone is in immediate danger",
  no_immediate_danger: "no one is in immediate danger",
  loose: "the animal is still loose",
  animal_contained: "the animal is contained",
  trapped: "people are trapped",
  not_trapped: "no one is trapped",
}

/** Wizard answers -> the snake_case shape the API and parser store. */
export function toServerTriage(triage: SosTriageAnswers) {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(triage)) {
    if (!value) continue
    const normalizedKey = key === "peopleAffected" ? "people_affected" : key
    out[normalizedKey] =
      normalizedKey === "detail" && value === "animal_contained"
        ? "contained"
        : value
  }
  return out
}

/** Short plain-language recap for the review screen. */
export function describeTriage(
  triage: SosTriageAnswers,
  questions: EmergencyQuickQuestion[] = []
): string {
  const parts = triageClauses(triage, questions)
  if (!parts.length) return ""
  const [first, ...rest] = parts
  return [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(", ")
}

/** GSM-7 concatenated segments are 153 characters; three is the working budget. */

/** "Medical Emergency" -> "Medical", so the sentence is not "a Medical Emergency emergency". */
function categoryNoun(label: string) {
  const trimmed = (label ?? "").trim() || "Other Emergency"
  return trimmed.replace(/\s+emergency$/i, "").trim() || "Other"
}

function article(word: string) {
  return /^[aeiou]/i.test(word) ? "an" : "a"
}

function triageClauses(
  triage?: SosTriageAnswers,
  questions: EmergencyQuickQuestion[] = []
): string[] {
  if (!triage) return []
  const knownKeys = new Set([
    "peopleAffected",
    "people_affected",
    "detail",
    "injuries",
  ])
  const known = [
    triage.peopleAffected || triage.people_affected
      ? PEOPLE_CLAUSE[triage.peopleAffected || triage.people_affected!]
      : "",
    triage.detail ? DETAIL_CLAUSE[triage.detail] : "",
    triage.injuries ? INJURY_CLAUSE[triage.injuries] : "",
  ].filter(Boolean) as string[]
  const configured = questions
    .filter((question) => !knownKeys.has(question.key))
    .map((question) => {
      const answer = triage[question.key]
      if (!answer) return ""
      const choice = question.choices.find((item) => item.value === answer)
      return `${question.question.toLowerCase()} ${choice?.label ?? answer}`
    })
    .filter(Boolean)
  return [...known, ...configured]
}

/**
 * Compose the offline emergency SMS.
 *
 * Deliberately contains no E-BOSES prefix, no user id, no database id, no
 * timestamp and no "Latitude:"/"Longitude:" labels. Those were meaningful only
 * to the parser; to the resident reading their own outbox, and to whoever picks
 * up the barangay handset, they were noise that buried the actual emergency.
 *
 * The optional `LOC:` footer stays because the backend needs it to place a map
 * pin. It is the only machine-readable part of the message.
 */
export function buildEmergencySmsMessage(payload: {
  emergencyType: string
  readableArea?: string
  latitude?: number | null
  longitude?: number | null
  triage?: SosTriageAnswers
  questions?: EmergencyQuickQuestion[]
  note?: string
}) {
  const category = categoryNoun(payload.emergencyType)
  const rawArea = (payload.readableArea ?? "").trim()
  const area =
    rawArea.length > 160 ? `${rawArea.slice(0, 157).trimEnd()}…` : rawArea
  const hasCoordinates =
    typeof payload.latitude === "number" &&
    typeof payload.longitude === "number" &&
    Number.isFinite(payload.latitude) &&
    Number.isFinite(payload.longitude)

  const locFooter = hasCoordinates
    ? `LOC:${payload.latitude!.toFixed(6)},${payload.longitude!.toFixed(6)}`
    : ""
  const note = (payload.note ?? "").trim()

  const compose = (clauses: string[], includeNote: boolean) => {
    const opening = area
      ? `I need immediate help. This is ${article(category)} ${category} emergency near ${area}.`
      : `I need immediate help. This is ${article(category)} ${category} emergency.`
    const middle = clauses.length ? ` ${clauses.join(", ")}.` : ""
    const lines = [`${opening}${middle} Please send assistance.`]
    if (includeNote && note) lines.push(note)
    if (locFooter) lines.push(locFooter)
    return lines.join("\n")
  }

  const complete = compose(
    triageClauses(payload.triage, payload.questions),
    true
  )
  return complete.length <= 153 * 3
    ? complete
    : compose(triageClauses(payload.triage, payload.questions), false)
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
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open SOS queue."))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openSosDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const request = run(tx.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("SOS queue failed."))
    tx.oncomplete = () => db.close()
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error("SOS queue transaction failed."))
    }
  })
}

export async function enqueueSosEmergency(payload: QueuedSosPayload) {
  const existing = await listQueuedSosEmergencies()
  for (const item of existing.slice(0, Math.max(0, existing.length - 2)))
    await deleteQueuedSosEmergency(item.id)
  await withStore("readwrite", (store) =>
    store.put({ ...payload, retryCount: payload.retryCount ?? 0 })
  )
}

export function listQueuedSosEmergencies() {
  return withStore<QueuedSosPayload[]>("readonly", (store) => store.getAll())
}

export function deleteQueuedSosEmergency(id: string) {
  return withStore<undefined>(
    "readwrite",
    (store) => store.delete(id) as IDBRequest<undefined>
  )
}

export function buildPinnedCoordinateAddress(_lat: number, _lng: number) {
  // Deliberately no raw numbers. When reverse geocoding can't name the spot,
  // the resident still dropped a pin the responder can see on the map — a
  // "14.648073, 121.119719" string in the address field only travelled through
  // to officials as noise they could not read.
  return {
    primary: "Pinned location",
    full: "Pinned location on the map",
  }
}

export function isSosLocationReady(
  value: {
    lat: number
    lng: number
  } | null
) {
  if (!value) return false
  return Number.isFinite(value.lat) && Number.isFinite(value.lng)
}
