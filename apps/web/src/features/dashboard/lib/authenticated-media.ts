// apps/web/src/features/dashboard/lib/authenticated-media.ts

import { getAccessToken } from "@/lib/api"

/**
 * Open an authenticated blob (bearer token) as a download. Also used by the
 * report/media previews that live on the alerts map.
 */
export async function openAuthenticatedMedia(src: string, filename: string) {
  const token = getAccessToken()
  const response = await fetch(src, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!response.ok) throw new Error("Could not open this file.")
  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = filename
  link.rel = "noopener"
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
}