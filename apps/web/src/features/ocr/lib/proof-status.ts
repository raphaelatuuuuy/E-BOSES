import type { OcrDocumentType, ProofSide } from "@/features/ocr/api"

export type ProofListStatus = "live" | "hidden" | "needs_setup"

function requiredSampleSides(doc: OcrDocumentType): ProofSide[] {
  const sides = doc.required_sides?.length ? doc.required_sides : (["single"] as ProofSide[])
  if (sides.includes("front") && sides.includes("back")) return ["front", "back"]
  if (sides.includes("front")) return ["front"]
  if (sides.includes("back")) return ["back"]
  return ["single"]
}

function hasRequiredSamples(doc: OcrDocumentType): boolean {
  const required = requiredSampleSides(doc)
  const listed = doc.samples ?? []
  return required.every((side) => {
    if (listed.some((sample) => sample.side === side && Boolean(sample.url))) return true
    if (
      (side === "front" || side === "single") &&
      (doc.sample_url ||
        listed.some(
          (sample) =>
            (sample.side === "front" || sample.side === "single") && Boolean(sample.url),
        ))
    ) {
      return true
    }
    return false
  })
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
  if (!hasRequiredSamples(doc) || !hasAnyRegion(doc) || !doc.name?.trim()) return "needs_setup"
  return "live"
}

export function proofStatusLabel(status: ProofListStatus): string {
  if (status === "live") return "Live on sign-up"
  if (status === "hidden") return "Hidden from sign-up"
  return "Needs setup"
}
