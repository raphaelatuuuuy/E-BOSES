import type { ConcernPhotoVerdict } from "@/features/dashboard/api"

export function isPhotoVerdictRejected(
  verdict: ConcernPhotoVerdict | undefined
): boolean {
  return Boolean(verdict && verdict.state !== "relevant")
}
