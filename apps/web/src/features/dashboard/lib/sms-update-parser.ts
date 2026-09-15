export type SmsUpdateStage =
  | "received"
  | "en_route"
  | "nearby"
  | "arrived"
  | "resolved"

const STAGE_PHRASES: Array<[SmsUpdateStage, string]> = [
  ["nearby", "responders are almost there"],
  ["en_route", "responders are on the way"],
  ["arrived", "responders have arrived"],
  ["resolved", "marked resolved"],
  ["received", "responders have been notified"],
  ["received", "still arranging responders"],
]

export function parseSmsUpdate(body: string): SmsUpdateStage | null {
  const text = (body ?? "").trim()
  if (!text) return null
  if (/otp|verification code|expires in/i.test(text)) return null
  const lower = text.toLowerCase()
  for (const [stage, phrase] of STAGE_PHRASES) {
    if (lower.includes(phrase)) return stage
  }
  return null
}

export function normalizeSmsSender(value: string) {
  return (value ?? "").replace(/\D/g, "").slice(-10)
}

export function isGatewaySender(sender: string, gateway: string) {
  const from = normalizeSmsSender(sender)
  const expected = normalizeSmsSender(gateway)
  return Boolean(from && expected && from === expected)
}
