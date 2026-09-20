import type { AuthUser } from "@/features/auth/api"
import { readRecentAccounts } from "@/features/auth/recent-accounts"


export function isResidentDevice(user: AuthUser | null): boolean {
  if (user) return user.role === "resident"
  return readRecentAccounts().some((account) => account.role === "resident")
}
