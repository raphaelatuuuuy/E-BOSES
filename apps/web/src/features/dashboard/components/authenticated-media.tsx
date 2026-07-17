import { useEffect, useState } from "react"
import { ImageIcon, Loader2Icon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { getAccessToken } from "@/lib/api"


export function AuthenticatedMediaImage({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  const [objectUrl, setObjectUrl] = useState("")
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let nextObjectUrl = ""
    const token = getAccessToken()

    async function load() {
      setFailed(false)
      try {
        const response = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (!response.ok) throw new Error("Media request failed")
        nextObjectUrl = URL.createObjectURL(await response.blob())
        if (!cancelled) setObjectUrl(nextObjectUrl)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    void load()
    return () => {
      cancelled = true
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl)
    }
  }, [src])

  if (failed) {
    return (
      <span className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <ImageIcon className="size-5" aria-hidden="true" />
        <span className="sr-only">Preview unavailable</span>
      </span>
    )
  }
  if (!objectUrl) {
    return (
      <span className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading preview</span>
      </span>
    )
  }
  return <img src={objectUrl} alt={alt} className={className} />
}


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
