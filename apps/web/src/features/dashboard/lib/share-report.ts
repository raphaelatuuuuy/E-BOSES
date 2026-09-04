import { toast } from "sonner"

import type { Concern } from "@/features/dashboard/api"

function reportUrl(publicId: string) {
  if (typeof window === "undefined") return `/dashboard/reports/${publicId}`
  return `${window.location.origin}/dashboard/reports/${publicId}`
}

export function canShareConcern(
  report: Pick<Concern, "visibility" | "status">
) {
  return report.visibility === "community" && report.status !== "rejected"
}

export function canPublishConcern(
  report: Pick<Concern, "visibility" | "validation_status" | "status">
) {
  return (
    report.visibility === "private" &&
    report.validation_status === "accepted" &&
    report.status !== "rejected"
  )
}

export async function shareConcernReport(
  report: Pick<Concern, "public_id" | "title" | "summary" | "description">
) {
  const url = reportUrl(report.public_id)
  const canUseNativeShare =
    typeof navigator !== "undefined" && "share" in navigator
  try {
    if (canUseNativeShare) {
      await (
        navigator as Navigator & { share: (data: ShareData) => Promise<void> }
      ).share({
        title: report.title || "Community report",
        text: report.summary || report.description || "Community report",
        url,
      })
    } else {
      await navigator.clipboard.writeText(url)
    }
    toast.success(
      canUseNativeShare ? "Share sheet opened." : "Report link copied."
    )
    return true
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return false
    toast.error("Could not share this report.")
    return false
  }
}
