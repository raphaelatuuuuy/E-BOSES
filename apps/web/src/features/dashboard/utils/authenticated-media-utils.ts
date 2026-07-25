import { apiBaseUrl, getAccessToken } from "@/lib/api"

export function mediaFetchUrl(src: string) {
  if (!src) return ""
  const base = apiBaseUrl()
  if (base === "/api") {
    try {
      const url = new URL(src, window.location.origin)
      if (url.pathname.startsWith("/api/")) return `${url.pathname}${url.search}`
    } catch {
      return src
    }
  }
  return src
}

export async function openAuthenticatedMedia(src: string, filename: string) {
  const token = getAccessToken()
  const response = await fetch(mediaFetchUrl(src), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: "include",
  })
  if (!response.ok) throw new Error("Could not open this file.")
  const objectUrl = URL.createObjectURL(await response.blob())
  try {
    const link = document.createElement("a")
    link.href = objectUrl
    link.download = filename
    link.rel = "noopener"
    link.click()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
