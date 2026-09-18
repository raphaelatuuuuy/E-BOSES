export const SMS_MAX_PARTS = 5
const CONCAT_SEGMENT_CHARS = 153

export function normalizeSmsRecipient(raw: string) {
  const compact = (raw ?? "").trim().replace(/[\s().-]/g, "")
  return /^\+?\d{7,15}$/.test(compact) ? compact : ""
}

export function smsBodyTooLong(body: string) {
  return (body ?? "").length > SMS_MAX_PARTS * CONCAT_SEGMENT_CHARS
}
