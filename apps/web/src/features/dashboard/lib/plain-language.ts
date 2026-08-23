/**
 * Plain-language dictionary for staff-facing screens.
 *
 * Barangay Marikina Heights has two paid personnel; every other official and
 * responder is a volunteer whose software experience is Word and Excel
 * (research.md, "Peopleware/Manpower"). Machine vocabulary — raw enum values,
 * model names, confidence scores, pipeline states — must never reach them.
 *
 * This module is the single source of truth for turning system values into
 * barangay language. Prefer these helpers over `.replace(/_/g, " ")`, which
 * only reformats jargon instead of translating it.
 *
 * Each entry may carry a `help` sentence: the short explanation shown as
 * hover/secondary text so an official knows what to DO about the state.
 */

export interface PlainTerm {
  /** Short label for chips, badges, table cells. */
  label: string
  /** One sentence an official can act on. Optional. */
  help?: string
}

/** Title-case fallback for values we have not mapped yet. */
export function humanizeEnum(value: string): string {
  if (!value) return ""
  const spaced = value.replace(/[_-]+/g, " ").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

function lookup(map: Record<string, PlainTerm>, value: string | null | undefined): PlainTerm {
  if (!value) return { label: "—" }
  return map[value] ?? { label: humanizeEnum(value) }
}

/* ── Concerns ──────────────────────────────────────────────────────────── */

/**
 * Concern lifecycle in barangay terms. The codebase previously showed three
 * competing vocabularies for this one lifecycle (raw status, validation
 * labels, and filter chips); these are the canonical words.
 */
export const CONCERN_STATUS: Record<string, PlainTerm> = {
  submitted: { label: "Received", help: "Logged and waiting for an officer. Not yet routed to a unit." },
  under_review: { label: "Being checked", help: "An officer is confirming the category and details." },
  assigned: { label: "Reassigned to another unit", help: "Routed to a barangay unit that now owns it." },
  in_progress: { label: "Being worked on", help: "Work has started on the ground." },
  resolved: { label: "Resolved", help: "Finished, with proof attached." },
  rejected: { label: "Denied appeal", help: "Declined. The resident was given a reason." },
  appealed: { label: "Under appeal", help: "The resident objected. It is back with an officer." },
}

export function concernStatus(value: string | null | undefined): PlainTerm {
  return lookup(CONCERN_STATUS, value)
}

export const CONCERN_VALIDATION: Record<string, PlainTerm> = {
  pending: { label: "Not yet checked", help: "Waiting for an official to confirm the details." },
  accepted: { label: "Checked and valid", help: "Confirmed as a genuine barangay concern." },
  rejected: { label: "Not valid", help: "Found to be a duplicate, false, or out of scope." },
}

export function concernValidation(value: string | null | undefined): PlainTerm {
  return lookup(CONCERN_VALIDATION, value)
}

/* ── Automatic checks (formerly "AI assessment") ───────────────────────── */

/**
 * The system runs an automatic first-pass review of the description and the
 * photo. Officials do not need to know which model does it — only whether the
 * review finished and whether it wants a second look.
 */
export const AUTO_CHECK_STATUS: Record<string, PlainTerm> = {
  pending: {
    label: "Still checking",
    help: "The automatic check is running. You can review the report now — it does not have to wait.",
  },
  completed: {
    label: "Check finished",
    help: "The automatic check is done. It is guidance only — your decision is what counts.",
  },
  failed: {
    label: "Check unavailable",
    help: "The automatic check could not run. Review the report yourself as usual.",
  },
  not_configured: {
    label: "Check turned off",
    help: "Automatic checking is not switched on. Review the report yourself as usual.",
  },
}

export function autoCheckStatus(value: string | null | undefined): PlainTerm {
  return lookup(AUTO_CHECK_STATUS, value)
}

/**
 * Why the system asked for a second look. These are shown to officials as the
 * reason chips on a flagged concern.
 */
export const FLAG_REASON: Record<string, PlainTerm> = {
  suspicious_text: {
    label: "Wording looks off",
    help: "The description reads like a test entry, spam, or nonsense.",
  },
  irrelevant_text: {
    label: "Description doesn't match",
    help: "The written description does not seem to describe the chosen category.",
  },
  category_mismatch: {
    label: "Category may be wrong",
    help: "The report does not look like the category the resident picked. Change it if you agree.",
  },
  possible_duplicate: {
    label: "Possibly already reported",
    help: "A very similar report was filed nearby. Check before creating duplicate work.",
  },
  urgent_attention: {
    label: "May need urgent attention",
    help: "The report describes possible immediate danger. Open it before the rest of the queue.",
  },
  media_integrity: {
    label: "Photo may not be genuine",
    help: "The photo shows signs of editing, of being made by a computer, or of being a picture of a screen. This is a suspicion, not proof — open the photo and judge for yourself.",
  },
}

/**
 * What the picture check thought of a photo.
 *
 * Every label is written as an observation, never a verdict. "Looks genuine"
 * means only that nothing was found — it is not a guarantee, and the UI must
 * never present it as one.
 */
export const MEDIA_INTEGRITY_VERDICT: Record<string, PlainTerm> = {
  authentic: {
    label: "Nothing unusual found",
    help: "No sign of editing was seen. This is not proof the photo is genuine.",
  },
  suspected_edit: {
    label: "May have been edited",
    help: "Part of the photo does not match the rest — lighting, edges, or texture look inconsistent.",
  },
  suspected_ai: {
    label: "May be computer-made",
    help: "The photo has the smooth, grainless look of a generated image rather than a camera photo.",
  },
  impossible_content: {
    label: "Shows something that cannot be real",
    help: "The photo contains something that could not happen — a cartoon, a fictional creature, or an impossible object.",
  },
  photo_of_screen: {
    label: "Looks like a photo of a screen",
    help: "Glare, a pixel grid, or a device edge suggests this is a picture of a screen, not of the scene.",
  },
  inconclusive: {
    label: "Could not tell",
    help: "The photo is too dark, blurry, or plain to judge. This is normal and is not a concern.",
  },
}

export function mediaIntegrityVerdict(value: string | null | undefined): PlainTerm {
  return lookup(MEDIA_INTEGRITY_VERDICT, value)
}

export function flagReason(value: string | null | undefined): PlainTerm {
  return lookup(FLAG_REASON, value)
}

/* ── What the review assistant suggests ────────────────────────────────── */

/**
 * The next step the assistant recommends, in words that name an action an
 * official can take. These are suggestions: nothing here is a decision, and the
 * UI must never render them as Approved, Rejected, or Final Decision.
 */
export const RECOMMENDED_ACTION: Record<string, PlainTerm> = {
  accept: {
    label: "Accept and continue processing",
    help: "Nothing looks wrong with this report. Move it along as usual.",
  },
  accept_with_privacy_review: {
    label: "Continue using the protected image",
    help: "The report is fine. Show the protected copy of the photo, not the original.",
  },
  manual_review: {
    label: "Review the report manually",
    help: "Something did not line up. Read it yourself before deciding.",
  },
  request_more_information: {
    label: "Request additional details",
    help: "Message the resident for what is missing before acting.",
  },
  escalate_as_emergency: {
    label: "Notify the appropriate emergency personnel",
    help: "This may describe immediate danger. Do not leave it in the queue.",
  },
  reject_as_irrelevant: {
    label: "Review as a potentially unrelated submission",
    help: "This may not be a barangay concern. Check before turning it down.",
  },
}

export function recommendedAction(value: string | null | undefined): PlainTerm {
  return lookup(RECOMMENDED_ACTION, value)
}

/* ── Photo and privacy state ───────────────────────────────────────────── */

/**
 * What happened to the photo, as one message.
 *
 * These are mutually exclusive by construction — `photoStateOf` below picks
 * exactly one — which is what prevents the screen from ever showing "No photo
 * was submitted" beside a thumbnail, or "the photo supports the report" beside
 * "photo review unavailable".
 */
export type PhotoState =
  | "none"
  | "pending"
  | "review_failed"
  | "inconclusive"
  | "supports"
  | "partially_supports"
  | "mismatch"

export const PHOTO_STATE: Record<PhotoState, PlainTerm> = {
  none: { label: "No photo was submitted." },
  pending: { label: "Photo review is in progress." },
  review_failed: {
    label: "A photo was uploaded, but automatic review was unavailable. Please review it manually.",
  },
  inconclusive: {
    label: "The photo does not provide enough visible evidence to confirm the report.",
  },
  supports: { label: "The photo supports the report." },
  partially_supports: { label: "The photo supports part of the report." },
  mismatch: { label: "The photo may not match the description." },
}

/** Short badge wording for the same states, for chips beside a heading. */
export const PHOTO_STATE_BADGE: Record<PhotoState, string> = {
  none: "Text-Only Report",
  pending: "Photo Review in Progress",
  review_failed: "Photo Review Unavailable",
  inconclusive: "Photo Evidence Inconclusive",
  supports: "Supports Report",
  partially_supports: "Supports Report in Part",
  mismatch: "Possible Mismatch",
}

/**
 * Decide the photo state from the three facts that determine it, in priority
 * order. Taking one path through this function — rather than reading several
 * booleans at the point of display — is what makes contradictory states
 * unrepresentable.
 */
export function photoStateOf(input: {
  hasPhoto: boolean
  assessmentStatus: string | null | undefined
  imageReviewSucceeded: boolean | null | undefined
  evidenceRelationship: string | null | undefined
}): PhotoState {
  if (!input.hasPhoto) return "none"
  if (input.imageReviewSucceeded === false) return "review_failed"
  if (input.assessmentStatus === "pending" || input.imageReviewSucceeded == null) return "pending"
  switch (input.evidenceRelationship) {
    case "supports_report":
      return "supports"
    case "partially_supports_report":
      return "partially_supports"
    case "contradicts_report":
      return "mismatch"
    case "image_review_failed":
      return "review_failed"
    default:
      return "inconclusive"
  }
}

/**
 * What was done about privacy, per photo.
 *
 * Note what none of these say: that an image is safe. The automatic check only
 * ever looked for three things, and only when the review model asked it to, so
 * "nothing was found" is the strongest claim available.
 */
export const PRIVACY_STATE: Record<string, PlainTerm> = {
  not_required: {
    label: "No sensitive details requiring automatic protection were identified during the initial review.",
    help: "The photo can be shown publicly. Blur anything else you notice.",
  },
  queued: { label: "Privacy check is queued.", help: "The photo is not public until this finishes." },
  processing: { label: "Privacy check is in progress.", help: "The photo is not public until this finishes." },
  protected: {
    label: "Sensitive details were protected before public display.",
    help: "The public sees the blurred copy. You can still open the original.",
  },
  sensitive_review_required: {
    label: "Possible sensitive visual content was found. The image should remain restricted until an authorized official reviews it.",
    help: "Not shown publicly. Open it yourself and decide.",
  },
  no_match_found: {
    label: "No matching sensitive region was confirmed. Manual review may still be required.",
    help: "Not shown publicly yet. Blur anything you can see, or release it.",
  },
  failed_restricted: {
    label: "Automatic privacy protection could not be completed. The original image remains restricted pending review.",
    help: "Not shown publicly. Blur it yourself or try the check again.",
  },
}

export function privacyState(value: string | null | undefined): PlainTerm {
  return lookup(PRIVACY_STATE, value)
}

/** Short badge wording for privacy state. */
export const PRIVACY_STATE_BADGE: Record<string, string> = {
  not_required: "Privacy Check Not Required",
  queued: "Privacy Check in Progress",
  processing: "Privacy Check in Progress",
  protected: "Privacy Protected",
  sensitive_review_required: "Sensitive Media",
  no_match_found: "Needs Review",
  failed_restricted: "Sensitive Media",
}

/**
 * The message shown when a photo exists but Gemma never managed to look at it.
 * Kept separate from PRIVACY_STATE because it is a statement about the review,
 * not about the pipeline that follows it.
 */
export const PRIVACY_UNCHECKED =
  "The image could not be checked automatically for sensitive details. Manual privacy review is required."

/** Object names Gemma reported, title-cased for display. */
export function observedObjectLabel(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

/**
 * Turn a raw 0-1 confidence into words. Officials should never see a bare
 * percentage they cannot calibrate — "78% confident" means nothing to them.
 */
export function certaintyWord(confidence: number | null | undefined): PlainTerm {
  if (confidence == null || !Number.isFinite(confidence)) {
    return { label: "Not checked", help: "The system did not produce a result for this." }
  }
  const pct = confidence <= 1 ? confidence * 100 : confidence
  if (pct >= 85) return { label: "Very sure", help: "The system is highly confident about this." }
  if (pct >= 65) return { label: "Fairly sure", help: "The system is reasonably confident about this." }
  if (pct >= 40) return { label: "Not sure", help: "Treat this as a hint only — check it yourself." }
  return { label: "Unsure", help: "The system could not tell. Rely on your own review." }
}

/* ── Emergencies ───────────────────────────────────────────────────────── */

export const EMERGENCY_STATUS: Record<string, PlainTerm> = {
  submitted: { label: "Just sent", help: "The resident sent this. No responder assigned yet." },
  routed: { label: "Sent to responder", help: "A responder was picked and notified." },
  acknowledged: { label: "Responder accepted", help: "The responder saw it and accepted." },
  en_route: { label: "On the way", help: "The responder is travelling to the location." },
  nearby: { label: "Almost there", help: "The responder is close to the location." },
  arrived: { label: "On scene", help: "The responder has reached the location." },
  resolved: { label: "Finished", help: "The incident was handled and closed." },
  false_alarm: { label: "False alarm", help: "The alert was reviewed and flagged as not a real emergency." },
  invalid: { label: "Invalid", help: "The alert could not be accepted after review." },
  cancelled: { label: "Cancelled", help: "The alert was called off." },
}

export function emergencyStatus(value: string | null | undefined): PlainTerm {
  return lookup(EMERGENCY_STATUS, value)
}

export const EMERGENCY_TYPE: Record<string, PlainTerm> = {
  medical: { label: "Medical" },
  fire: { label: "Fire" },
  crime: { label: "Peace and order" },
  disaster: { label: "Disaster" },
  child_protection: { label: "Child protection" },
  domestic_violence: { label: "Domestic violence" },
}

export function emergencyType(value: string | null | undefined): PlainTerm {
  return lookup(EMERGENCY_TYPE, value)
}

/** Responder units, spelled out — never bare acronyms in a button. */
export const RESPONDER_UNIT: Record<string, PlainTerm> = {
  tanod: { label: "Barangay Tanod", help: "Peace and order, patrols, crime response." },
  bhw: { label: "Health Worker", help: "Barangay Health Worker — medical response and first aid." },
  bdrrmo: { label: "Disaster Response", help: "BDRRMO — fire, flood, and disaster response." },
  other: { label: "Other responder" },
  "": { label: "No unit yet", help: "This responder has not been given a unit." },
}

export function responderUnit(value: string | null | undefined): PlainTerm {
  if (value === "") return RESPONDER_UNIT[""]
  return lookup(RESPONDER_UNIT, value)
}

/* ── Accounts ──────────────────────────────────────────────────────────── */

export const ACCOUNT_STATUS: Record<string, PlainTerm> = {
  pending_otp: { label: "Signing up", help: "Has not confirmed their phone or email yet." },
  pending_profile: { label: "Signing up", help: "Has not finished filling in their details." },
  pending_verification: { label: "Waiting for approval", help: "Submitted an ID — needs your review." },
  verified: { label: "Active", help: "Can use the system normally." },
  rejected: { label: "Not approved", help: "Their ID was turned down. They cannot file reports." },
  suspended: { label: "Suspended", help: "Access is blocked. They cannot sign in." },
}

export function accountStatus(value: string | null | undefined): PlainTerm {
  return lookup(ACCOUNT_STATUS, value)
}

export const ACCOUNT_ROLE: Record<string, PlainTerm> = {
  resident: { label: "Resident", help: "Can file concerns and send emergency alerts." },
  barangay_official: { label: "Barangay Official", help: "Can review concerns and manage the barangay." },
  first_responder: { label: "Responder", help: "Receives emergency alerts and responds on the ground." },
}

export function accountRole(value: string | null | undefined): PlainTerm {
  return lookup(ACCOUNT_ROLE, value)
}

/* ── Community content ─────────────────────────────────────────────────── */

export const ANNOUNCEMENT_URGENCY: Record<string, PlainTerm> = {
  normal: { label: "Normal" },
  important: { label: "Important" },
  urgent: { label: "Urgent" },
}

export const ANNOUNCEMENT_AUDIENCE: Record<string, PlainTerm> = {
  all: { label: "Everyone" },
  residents: { label: "Residents only" },
  responders: { label: "Responders only" },
  officials: { label: "Officials only" },
}

export const CONTENT_FLAG_REASON: Record<string, PlainTerm> = {
  spam: { label: "Spam" },
  harassment: { label: "Harassment" },
  false_information: { label: "False information" },
  inappropriate: { label: "Inappropriate content" },
  other: { label: "Other reason" },
}

export const CONTENT_FLAG_STATUS: Record<string, PlainTerm> = {
  submitted: { label: "Needs review", help: "A resident reported this. Nobody has decided yet." },
  reviewed: { label: "Reviewed", help: "Looked at, no action needed." },
  dismissed: { label: "Dismissed", help: "Checked and found to be fine." },
  action_taken: { label: "Action taken", help: "The content was removed or the author warned." },
}

/* ── Privacy requests ──────────────────────────────────────────────────── */

export const PRIVACY_REQUEST_TYPE: Record<string, PlainTerm> = {
  data_export: { label: "Copy of their data", help: "The resident asked for a copy of their records." },
  deletion: { label: "Delete their account", help: "The resident asked to have their account removed." },
}

export const PRIVACY_REQUEST_STATUS: Record<string, PlainTerm> = {
  submitted: { label: "New request", help: "Waiting for an official to start." },
  reviewed: { label: "Being handled", help: "An official has started working on it." },
  completed: { label: "Done", help: "The request was carried out." },
  rejected: { label: "Declined", help: "The request was turned down, with a reason recorded." },
}

/* ── ID checking (formerly OCR) ────────────────────────────────────────── */

/**
 * "OCR" never appears in staff copy — it is "reading the ID". These describe
 * why a submitted ID landed in the review queue.
 */
export const ID_CHECK_REASON: Record<string, PlainTerm> = {
  low_confidence: { label: "Hard to read", help: "The photo was blurry or the text was unclear." },
  manual_review: { label: "Needs a person to check", help: "The system wants a human decision on this one." },
  unavailable: { label: "Could not be read", help: "The ID reader was unavailable. Check it yourself." },
  duplicate_identity: { label: "Matches another account", help: "This ID number is already used by a verified account." },
  mismatch: { label: "Doesn't match their form", help: "The ID details differ from what the resident typed." },
  expired: { label: "Expired ID", help: "The ID appears to be past its expiry date." },
}

export const ID_CHECK_STATUS: Record<string, PlainTerm> = {
  queued: { label: "Waiting", help: "In line to be read." },
  processing: { label: "Reading now", help: "The system is reading the ID." },
  manual_review: { label: "Needs your decision", help: "Open this and approve or reject it." },
  approved: { label: "Approved", help: "The resident was verified." },
  rejected: { label: "Rejected", help: "The proof was turned down." },
}

/* ── Formatting helpers ────────────────────────────────────────────────── */

/** Distance in words a barangay official would use. */
export function plainDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return "Distance unknown"
  if (meters < 100) return "Just steps away"
  if (meters < 1000) return `About ${Math.round(meters / 50) * 50} m away`
  return `About ${(meters / 1000).toFixed(1)} km away`
}

/** Relative time that reads like speech, not a log line. */
export function plainTimeAgo(value: string | null | undefined): string {
  if (!value) return ""
  const ms = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(ms)) return ""
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} wk ago`
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value))
}

/** "3 concerns" / "1 concern" without a bare number colliding with the noun. */
export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}
