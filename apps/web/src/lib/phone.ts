export function normalizePhoneNumber(raw: string) {
  const compact = raw.replace(/[\s().-]/g, "")
  const match = /^(?:\+?63|0)?(9\d{9})$/.exec(compact)
  return match ? `+63${match[1]}` : null
}
