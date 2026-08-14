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

export type MediaPreviewItem = {
  src: string
  filename: string
  kind: "image" | "video" | "file"
}

/**
 * Maps a backend media type ("image/jpeg", "video/mp4", "audio/ogg", or the
 * chat-style shorthand "video") to the preview kind. Unknown types fall back
 * to a file tile — the lightbox still offers the download for those.
 */
export function toMediaPreviewItem(
  src: string,
  filename: string,
  mimeOrKind?: string | null,
): MediaPreviewItem {
  const value = mimeOrKind || ""
  if (value.startsWith("video/") || value === "video") return { src, filename, kind: "video" }
  if (value.startsWith("image/") || value === "image" || !value) return { src, filename, kind: "image" }
  return { src, filename, kind: "file" }
}

export function mediaDisplaySource(media: {
  preview_url?: string | null
  raw_url?: string | null
}): string {
  return media.preview_url || media.raw_url || ""
}
