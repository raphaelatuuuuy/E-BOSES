import type { ConcernPhotoVerdict } from "@/features/dashboard/api"

export const DUPLICATE_PHOTO_FEEDBACK =
  "Please use a different photo, this issue was already reported."

const PHOTO_WARNING_MESSAGES = new Set([
  "Please submit a photo that clearly shows the reported issue.",
  "Please remove photos that don't show the reported issue and upload clear ones.",
  "The photo contradicts the issue described. Upload a matching photo.",
  "The photo contradicts the issue described. Please submit a photo that shows the reported issue.",
  "The photo does not clearly show the issue described.",
])

export function duplicatePhotoFeedback(raw: unknown): {
  text: string
  tone: "info"
  actionLabel: "Click to see"
} | null {
  if (typeof raw !== "string") return null
  if (
    !/already used in another report|already uploaded|uploaded before|already reported/i.test(
      raw.trim()
    )
  ) {
    return null
  }
  return {
    text: DUPLICATE_PHOTO_FEEDBACK,
    tone: "info",
    actionLabel: "Click to see",
  }
}

export function duplicatePhotoFeedLocation(concernId: number) {
  return {
    pathname: "/dashboard/feed",
    search: `?highlightConcernId=${encodeURIComponent(concernId)}`,
    state: { highlightConcernId: concernId },
  }
}

export function duplicatePhotoReportIssueLocation(concernId: number) {
  return {
    pathname: "/report-issue",
    search: `?highlightConcernId=${encodeURIComponent(concernId)}`,
    state: { highlightConcernId: concernId },
  }
}

export function isPhotoVerdictRejected(
  verdict: ConcernPhotoVerdict | undefined
): boolean {
  return Boolean(verdict && verdict.state !== "relevant")
}

export function photoVerdictsWithWarningFallback(
  verdicts: ConcernPhotoVerdict[],
  messages: string[],
  photoCount: number
): ConcernPhotoVerdict[] {
  if (verdicts.some(isPhotoVerdictRejected) || photoCount <= 0) return verdicts
  const message = messages.find((item) => PHOTO_WARNING_MESSAGES.has(item))
  if (!message) return verdicts
  return Array.from({ length: photoCount }, (_, index) => ({
    index,
    state: "unrelated" as const,
    message,
  }))
}
