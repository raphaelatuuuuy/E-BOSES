import type { OcrDocumentType } from "@/features/ocr/api"

export type ProofListStatus = "live" | "hidden" | "needs_setup"

function hasSample(doc: OcrDocumentType): boolean {
  if (doc.samples?.some((s) => Boolean(s.url))) return true
  return Boolean(doc.sample_url)
}

function hasAnyRegion(doc: OcrDocumentType): boolean {
  return doc.fields.some((f) => {
    const r = f.extraction_hints?.region
    return r && typeof r.x === "number" && r.w > 0 && r.h > 0
  })
}

/** Status for home cards. Live = enabled; Needs setup if enabled-looking but missing sample/boxes. */
export function deriveProofStatus(doc: OcrDocumentType): ProofListStatus {
  if (doc.enabled === false) return "hidden"
  if (!hasSample(doc) || !hasAnyRegion(doc) || !doc.name?.trim()) return "needs_setup"
  return "live"
}

export function proofStatusLabel(status: ProofListStatus): string {
  if (status === "live") return "Live on sign-up"
  if (status === "hidden") return "Hidden from sign-up"
  return "Needs setup"
}
