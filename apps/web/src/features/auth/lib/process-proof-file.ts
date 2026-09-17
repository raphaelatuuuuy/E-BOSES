/**
 * Residence-proof pipeline:
 *
 * On each file upload (immediate, fail-closed):
 *  1) Client type / size
 *  2) Client duplicate check
 *  3) POST /auth/register/proof/check/ — media_forensics Layers 1–5 plus the
 *     side-aware LLM picture/template check on ORIGINAL
 *  4) Keep ORIGINAL for registration (server normalizes once)
 *
 * On Verify (after all required sides pass forensics):
 *  5) POST /auth/register/proof/detect/ — OCR (the same picture gate is rerun
 *     server-side before text extraction)
 */

import {
  checkRegistrationProof,
  detectRegistrationProof,
  type ResidenceProofCheckResult,
  type ResidenceProofDetectResult,
} from "@/features/auth/api"
import { getProofOfResidencyFileError } from "@/features/auth/schemas/sign-up-schema"
import type { ProofSide, ResidenceProofOption } from "@/features/ocr/api"
import { ApiError, apiBaseUrl, networkErrorMessage } from "@/lib/api"

export type ProcessProofOk = {
  ok: true
  /** Original file for registration (server normalizes). */
  file: File
  side: ProofSide
  option: ResidenceProofOption
  check: ResidenceProofCheckResult
  detect: ResidenceProofDetectResult | null
}

export type ProcessProofFail = {
  ok: false
  message: string
  detect: ResidenceProofDetectResult | null
}

export type ProcessProofResult = ProcessProofOk | ProcessProofFail

export function sidesForOption(option: ResidenceProofOption | null): ProofSide[] {
  if (!option) return ["front"]
  const sides = option.required_sides?.length ? option.required_sides : ["front"]
  const needsBoth = sides.includes("front") && sides.includes("back")
  if (needsBoth || ((option.max_files ?? 1) >= 2 && sides.includes("back"))) {
    return ["front", "back"]
  }
  if (sides.includes("back") && !sides.includes("front")) {
    return ["back"]
  }
  return ["front"]
}

/** Always Front / Back — never "Document". */
export function sideLabel(side: ProofSide): string {
  if (side === "back") return "Back"
  return "Front"
}

/**
 * Turn API/OCR failures into short, direct language for residents.
 * Drops jargon, redundant side prefixes, and long wording.
 */
export function humanizeProofError(message: string, _side?: ProofSide | null): string {
  let text = (message || "").trim()
  if (!text) {
    return "Could not verify this photo. Please try a clearer one."
  }

  // Drop redundant side prefixes ("On the front of your ID: …")
  text = text
    .replace(/^On the (front|back) of your ID:\s*/i, "")
    .replace(/^(Front|Back):\s*/i, "")
    .trim()

  if (/duplicate proof|document has already been used|already attached|same image/i.test(text)) {
    return "This document was already used; please submit a different one."
  }
  if (/AI-generated/i.test(text)) {
    return "Please upload a real photo of your ID. AI-generated images are not accepted."
  }
  if (/edited or digitally altered|digitally manipulated/i.test(text)) {
    return "Please upload the original, unedited photo."
  }
  if (/photo of (a )?screen/i.test(text)) {
    return "Please upload a direct photo of the physical ID, not a photo of a screen."
  }
  if (/media authenticity|C2PA/i.test(text)) {
    return "Please upload a different photo. This one could not be verified."
  }

  // The picture check found something. Already short and already says what to
  // do, so it is returned untouched rather than run through the rewrites
  // below, which are written for OCR field wording.
  if (/does not look like an original photo of a real document/i.test(text)) {
    return text
  }

  // Expiry — short and direct
  text = text
    .replace(
      /This ID expired on ([^.]+)\.\s*Please use a valid,? unexpired ID\.?/gi,
      "Please use a valid ID, this one has already expired.",
    )
    .replace(
      /This ID has already expired\.?/gi,
      "Please use a valid ID, this one has already expired.",
    )
    .replace(
      /This ID looks expired or the expiry date could not be read\.\s*Please use a valid ID\.?/gi,
      "Please use a valid ID, this one is expired or the date could not be read.",
    )
    .replace(
      /We could not read the expiry date on your ID\.\s*Please retake a clearer photo(?: of that section)?\.?/gi,
      "Please retake a clearer photo, we could not read the expiry date.",
    )
    .replace(
      /We could not find the expiry date on this photo\.\s*Please retake a clearer photo(?: of your ID)?\.?/gi,
      "Please retake a clearer photo, we could not find the expiry date.",
    )

  // Other common long forms → shorter
  text = text
    .replace(
      /We could not find the (.+?) on this photo\.\s*Use a clearer photo of the correct side of your ID\.?/gi,
      (_m: string, f: string) =>
        `Please retake a clearer photo, we could not find the ${f.toLowerCase()}.`,
    )
    .replace(
      /We could not read the (.+?) clearly(?: on this photo)?\.\s*Please retake a clearer photo(?: and make sure the text is not cut off)?(?: of the correct side of your ID)?\.?/gi,
      (_m: string, f: string) =>
        `Please retake a clearer photo, we could not read the ${f.toLowerCase()} clearly.`,
    )
    .replace(
      /The (.+?) on your ID does not match what you entered on the form\.\s*Check your details or upload a clearer photo\.?/gi,
      (_m: string, f: string) =>
        `Please check your details, your ${f.toLowerCase()} does not match what you entered.`,
    )
    .replace(
      /This document looks too old\.\s*Please use a more recent ID if you can\.?/gi,
      "Please use a more recent document, this one looks too old.",
    )
    .replace(
      /We could not confirm the (.+?) on this photo\.\s*Please try a clearer photo of the correct document\.?/gi,
      (_m: string, f: string) =>
        `Please retake a clearer photo, we could not confirm the ${f.toLowerCase()}.`,
    )
    .replace(
      /We could not verify the (.+?) on this photo\.\s*Please retake a clearer photo(?: of your ID)?\.?/gi,
      (_m: string, f: string) =>
        `Please retake a clearer photo, we could not verify the ${f.toLowerCase()}.`,
    )
    .replace(
      /We could not read the date of birth on your ID\.\s*Please retake a clearer photo\.?/gi,
      "Please retake a clearer photo, we could not read the date of birth.",
    )
    .replace(
      /The date of birth on this photo looks incorrect\.\s*Please (?:check the photo and try again|retake a clearer photo(?: of your ID)?)\.?/gi,
      "Please retake a clearer photo, the date of birth looks incorrect.",
    )
    .replace(
      /We could not verify this photo\.\s*Please try a clearer photo of your ID\.?/gi,
      "Please retake a clearer photo, we could not verify this photo.",
    )

  return text.replace(/\s{2,}/g, " ").trim()
}

async function fileDigest(file: File) {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function humanError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    const msg = (error.message || "").trim()
    if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg) || error.status === 0) {
      return networkErrorMessage(error)
    }
    if (msg) return msg
    if (error.data && typeof error.data === "object") {
      const data = error.data as Record<string, unknown>
      for (const key of ["detail", "message", "proof", "non_field_errors"]) {
        const value = data[key]
        if (typeof value === "string" && value.trim()) {
          if (/failed to fetch/i.test(value)) return networkErrorMessage(error)
          return value.trim()
        }
        if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
          if (/failed to fetch/i.test(value[0])) return networkErrorMessage(error)
          return value[0].trim()
        }
      }
    }
  }
  if (error instanceof Error && error.message.trim()) {
    if (/failed to fetch/i.test(error.message)) return networkErrorMessage(error)
    return error.message
  }
  return fallback
}

async function withNetworkRetry<T>(_label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const msg = error instanceof Error ? error.message : ""
    const retriable =
      error instanceof ApiError &&
      (error.status === 0 ||
        error.status >= 500 ||
        /cannot reach the api|timed out|failed to fetch/i.test(msg))
    if (!retriable) throw error
    await new Promise((r) => window.setTimeout(r, 700))
    return await fn()
  }
}

/**
 * Immediate per-file gate: media forensics on ORIGINAL (fail-closed).
 * Does NOT re-encode; does NOT run OCR.
 */
export async function checkProofSide(args: {
  file: File
  sideIndex: number
  option: ResidenceProofOption
  alreadyCaptured: File[]
  onStatus?: (message: string) => void
  email?: string
  communityResolutionToken?: string
}): Promise<ProcessProofResult> {
  const { file: rawFile, sideIndex: idx, option, alreadyCaptured, onStatus } = args
  const sides = sidesForOption(option)
  const side = sides[idx] ?? "front"

  const typeError = getProofOfResidencyFileError(rawFile)
  if (typeError) {
    return { ok: false, message: typeError, detect: null }
  }

  onStatus?.("Checking for duplicates…")
  for (const existing of alreadyCaptured) {
    if (
      existing.name === rawFile.name &&
      existing.size === rawFile.size &&
      existing.lastModified === rawFile.lastModified
    ) {
      return { ok: false, message: "This file is already attached.", detect: null }
    }
    try {
      const a = await fileDigest(existing)
      const b = await fileDigest(rawFile)
      if (a === b) {
        return {
          ok: false,
          message:
            "This image is the same as one you already uploaded. Use a different photo for this side.",
          detect: null,
        }
      }
    } catch {
      // digest unsupported
    }
  }

  onStatus?.("Running checks…")
  const checkData = new FormData()
  checkData.append("proof_type", option.key)
  checkData.append("proof", rawFile)
  checkData.append("proof_side", side)
  if (args.email) checkData.append("email", args.email)
  if (args.communityResolutionToken) checkData.append("community_resolution_token", args.communityResolutionToken)
  try {
    const check = await withNetworkRetry("Quality check", () => checkRegistrationProof(checkData))
    return {
      ok: true,
      file: rawFile,
      side,
      option,
      check,
      detect: null,
    }
  } catch (error) {
    // Fail closed — including network/status-0
    const message = humanizeProofError(
      humanError(
        error,
        "Could not verify this photo. Check your connection and try again.",
      ),
      side,
    )
    return {
      ok: false,
      message,
      detect: null,
    }
  }

}

/**
 * OCR / template match only — after all sides passed media forensics.
 * Pass ``side`` so only front fields are read from the front photo (and back from back).
 */
export async function detectProofOcr(args: {
  file: File
  option: ResidenceProofOption
  side?: ProofSide
  profile?: {
    first_name?: string
    middle_name?: string
    last_name?: string
    date_of_birth?: string
    gender?: string
    address?: string
  }
  onStatus?: (message: string) => void
  email?: string
  communityResolutionToken?: string
}): Promise<
  | { ok: true; detect: ResidenceProofDetectResult }
  | { ok: false; message: string; detect: ResidenceProofDetectResult | null }
> {
  const { file, option, side, profile, onStatus } = args
  const label = side === "back" ? "back" : side === "front" ? "front" : "document"
  onStatus?.(`Reading ${label}…`)

  const detectData = new FormData()
  detectData.append("proof", file)
  detectData.append("proof_type", option.key)
  if (args.email) detectData.append("email", args.email)
  if (args.communityResolutionToken) detectData.append("community_resolution_token", args.communityResolutionToken)
  if (side) {
    detectData.append("proof_side", side)
  }
  // Registrant profile so backend can run admin-configured profile_match
  // rules (e.g. "Match date of birth") against what the sign-up form claims.
  if (profile) {
    for (const [key, value] of Object.entries(profile)) {
      if (!value) continue
      detectData.append(key, value)
    }
  }

  let detectResult: ResidenceProofDetectResult
  try {
    detectResult = await withNetworkRetry("Matching template", () =>
      detectRegistrationProof(detectData),
    )
  } catch (error) {
    const data =
      error instanceof ApiError && error.data && typeof error.data === "object"
        ? (error.data as ResidenceProofDetectResult)
        : null
    if (error instanceof ApiError && error.status === 0) {
      return {
        ok: false,
        message: humanError(error, networkErrorMessage()),
        detect: {
          detected: false,
          message: humanError(error, networkErrorMessage()),
          reasons: [humanError(error, "Network error"), `API: ${apiBaseUrl()}`],
        },
      }
    }
    detectResult = data ?? {
      detected: false,
      message: humanError(error, "We could not read the document. Try a clearer photo."),
      reasons: [humanError(error, "Detection failed")],
    }
  }

  if (!detectResult.detected) {
    const raw =
      (detectResult.message || "").trim() ||
      (detectResult.reasons?.find((r) => (r || "").trim()) || "").trim() ||
      "This document could not be verified. Try a clearer photo."
    return { ok: false, message: humanizeProofError(raw, side), detect: detectResult }
  }

  return { ok: true, detect: detectResult }
}
