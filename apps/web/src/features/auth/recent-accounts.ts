import type { AuthUser } from "@/features/auth/api"

const STORAGE_KEY = "eboses:recent-login-accounts:v1"
const PASSWORD_STORAGE_KEY = "eboses:recent-login-passwords:v1"
const MAX_RECENT_ACCOUNTS = 5

export interface RecentAccount {
  id: number
  name: string
  identifier: string
  avatar?: string
  savedAt: number
}

function isRecentAccount(value: unknown): value is RecentAccount {
  if (!value || typeof value !== "object") return false
  const row = value as Partial<RecentAccount>
  return (
    typeof row.id === "number" &&
    typeof row.name === "string" &&
    typeof row.identifier === "string" &&
    row.identifier.includes("@") &&
    typeof row.savedAt === "number"
  )
}

export function readRecentAccounts(): RecentAccount[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]"
    )
    return Array.isArray(parsed)
      ? parsed.filter(isRecentAccount).slice(0, MAX_RECENT_ACCOUNTS)
      : []
  } catch {
    return []
  }
}

export function rememberRecentAccount(
  user: AuthUser,
  identifier: string
): RecentAccount[] {
  const normalizedIdentifier = (user.email || identifier).trim().toLowerCase()
  const name =
    user.full_name?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    identifier
  const account: RecentAccount = {
    id: user.id,
    name,
    identifier: normalizedIdentifier,
    avatar: user.avatar || undefined,
    savedAt: Date.now(),
  }
  const next = [
    account,
    ...readRecentAccounts().filter((row) => row.id !== user.id),
  ].slice(0, MAX_RECENT_ACCOUNTS)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  const allowed = new Set(next.map((row) => String(row.id)))
  const passwords = readPasswordMap()
  const pruned: Record<string, string> = {}
  for (const [key, value] of Object.entries(passwords)) {
    if (allowed.has(key)) pruned[key] = value
  }
  localStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify(pruned))
  return next
}

export function forgetRecentAccount(id: number): RecentAccount[] {
  const next = readRecentAccounts().filter((row) => row.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  clearRecentPassword(id)
  return next
}

function readPasswordMap(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(PASSWORD_STORAGE_KEY) ?? "{}"
    )
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {}
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (typeof value === "string" && value) next[key] = value
    }
    return next
  } catch {
    return {}
  }
}

export function readRecentPassword(id: number): string | null {
  return readPasswordMap()[String(id)] ?? null
}

export function saveRecentPassword(id: number, password: string) {
  if (!password) {
    clearRecentPassword(id)
    return
  }
  const next = readPasswordMap()
  next[String(id)] = password
  localStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify(next))
}

export function clearRecentPassword(id: number) {
  const next = readPasswordMap()
  if (!(String(id) in next)) return
  delete next[String(id)]
  localStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify(next))
}
