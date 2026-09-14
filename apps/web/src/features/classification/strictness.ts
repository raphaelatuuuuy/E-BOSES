import type {
  ConcernClassificationConfig,
  EmergencyMediaIntegrityAction,
  MediaIntegrityAction,
} from "./api"

/**
 * Plain-language presets over the AI thresholds.
 *
 * Officials were being asked to set a "relevance threshold" as a decimal.
 * Nobody outside the project can reason about 0.80 versus 0.65 — but everyone
 * can reason about "check carefully, expect more reports to need a look" versus
 * "let most through".
 *
 * There used to be an "image confidence threshold" here too. It set the minimum
 * score an object detector needed before it would report a box; with the
 * detector gone there is no such number to tune.
 *
 * The presets are the primary control; the underlying numbers stay reachable
 * behind an advanced disclosure so the values remain auditable for the
 * capstone write-up.
 */

export type Strictness = "lenient" | "balanced" | "strict"

export interface StrictnessPreset {
  key: Strictness
  label: string
  summary: string
  /** What an official should expect day to day if they pick this. */
  consequence: string
  text_relevance_threshold: number
  duplicate_similarity_threshold: number
  minimum_description_length: number
}

export const STRICTNESS_PRESETS: StrictnessPreset[] = [
  {
    key: "lenient",
    label: "Light review",
    summary: "Only hold reports that are clearly empty, spam, or unrelated.",
    consequence:
      "Residents get fewer interruptions, but officials may review more weak reports later.",
    text_relevance_threshold: 0.5,
    duplicate_similarity_threshold: 0.92,
    minimum_description_length: 10,
  },
  {
    key: "balanced",
    label: "Standard review",
    summary:
      "Ask for clarification when text, category, or photo does not clearly line up.",
    consequence:
      "Most valid reports continue, while unclear ones get checked first.",
    text_relevance_threshold: 0.65,
    duplicate_similarity_threshold: 0.85,
    minimum_description_length: 20,
  },
  {
    key: "strict",
    label: "Careful review",
    summary:
      "Ask for clearer details when the report is incomplete or evidence does not match.",
    consequence:
      "Residents may correct more reports before submitting, reducing weak reports in the queue.",
    text_relevance_threshold: 0.8,
    duplicate_similarity_threshold: 0.78,
    minimum_description_length: 40,
  },
]

/**
 * Which preset the saved numbers correspond to, or null when they have been
 * hand-tuned. Returning null matters: silently snapping a custom setup to the
 * nearest preset would change behaviour the official chose deliberately.
 */
export function detectStrictness(
  config: ConcernClassificationConfig
): Strictness | null {
  const match = STRICTNESS_PRESETS.find(
    (preset) =>
      Math.abs(
        preset.text_relevance_threshold - config.text_relevance_threshold
      ) < 0.001 &&
      Math.abs(
        preset.duplicate_similarity_threshold -
          config.duplicate_similarity_threshold
      ) < 0.001 &&
      preset.minimum_description_length === config.minimum_description_length
  )
  return match?.key ?? null
}

export function applyStrictness(
  config: ConcernClassificationConfig,
  key: Strictness
): ConcernClassificationConfig {
  const preset = STRICTNESS_PRESETS.find((item) => item.key === key)
  if (!preset) return config
  return {
    ...config,
    text_relevance_threshold: preset.text_relevance_threshold,
    duplicate_similarity_threshold: preset.duplicate_similarity_threshold,
    minimum_description_length: preset.minimum_description_length,
  }
}

/**
 * What happens when a photo looks edited, AI-made, or impossible.
 *
 * The check reads the picture, not the file. Editor tags and AI metadata are
 * already caught at upload; this is for a screenshot of an AI image, an object
 * pasted into a real scene, or a photo of a screen — cases where nothing in
 * the file is wrong and only the scene gives it away.
 *
 * Default is "Hold for review". A wrong flag on a real resident's report is
 * worse than a fake report reaching an official, so nothing is turned down
 * automatically unless a barangay chooses it.
 */
export const MEDIA_INTEGRITY_OPTIONS: {
  value: MediaIntegrityAction
  label: string
  hint: string
}[] = [
  {
    value: "flag_notify",
    label: "Accept and note it",
    hint: "The report continues. The finding is shown to the official.",
  },
  {
    value: "hold",
    label: "Hold for review",
    hint: "An official checks the photo before routing. Recommended.",
  },
  {
    value: "request_resubmission",
    label: "Ask the resident to resubmit",
    hint: "They are asked for a photo taken directly from their camera.",
  },
  {
    value: "auto_reject",
    label: "Turn it down automatically",
    hint: "No official sees it first. Use with care.",
  },
]

/**
 * The same check on emergency photos. Only two choices, on purpose.
 *
 * A photo that looks fabricated is still possibly attached to someone in real
 * trouble. The check runs after responders are already notified, so it can
 * only add a note to what they have — it can never hold, reject, or delay an
 * alert. The backend enum has no other values either; this is not a UI-only
 * restriction.
 */
export const EMERGENCY_MEDIA_INTEGRITY_OPTIONS: {
  value: EmergencyMediaIntegrityAction
  label: string
  hint: string
}[] = [
  {
    value: "flag_notify",
    label: "Note it for the responder",
    hint: "The alert is dispatched first. The responder sees the finding.",
  },
  {
    value: "hold",
    label: "Also flag for an official",
    hint: "The alert still dispatches. An official reviews the photo after.",
  },
]
