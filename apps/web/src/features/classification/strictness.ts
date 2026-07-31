import type { ConcernClassificationConfig } from "./api"

/**
 * Plain-language presets over the AI thresholds.
 *
 * Officials were being asked to set an "image confidence threshold" and a
 * "relevance threshold" as decimals. Nobody outside the project can reason about
 * 0.70 versus 0.65 — but everyone can reason about "check carefully, expect more
 * reports to need a look" versus "let most through".
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
  image_confidence_threshold: number
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
    image_confidence_threshold: 0.55,
    text_relevance_threshold: 0.5,
    duplicate_similarity_threshold: 0.92,
    minimum_description_length: 10,
  },
  {
    key: "balanced",
    label: "Standard review",
    summary: "Ask for clarification when text, category, or photo does not clearly line up.",
    consequence:
      "Most valid reports continue, while unclear ones get checked first.",
    image_confidence_threshold: 0.7,
    text_relevance_threshold: 0.65,
    duplicate_similarity_threshold: 0.85,
    minimum_description_length: 20,
  },
  {
    key: "strict",
    label: "Careful review",
    summary: "Ask for clearer details when the report is incomplete or evidence does not match.",
    consequence:
      "Residents may correct more reports before submitting, reducing weak reports in the queue.",
    image_confidence_threshold: 0.85,
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
export function detectStrictness(config: ConcernClassificationConfig): Strictness | null {
  const match = STRICTNESS_PRESETS.find(
    (preset) =>
      Math.abs(preset.image_confidence_threshold - config.image_confidence_threshold) < 0.001 &&
      Math.abs(preset.text_relevance_threshold - config.text_relevance_threshold) < 0.001 &&
      Math.abs(preset.duplicate_similarity_threshold - config.duplicate_similarity_threshold) <
        0.001 &&
      preset.minimum_description_length === config.minimum_description_length,
  )
  return match?.key ?? null
}

export function applyStrictness(
  config: ConcernClassificationConfig,
  key: Strictness,
): ConcernClassificationConfig {
  const preset = STRICTNESS_PRESETS.find((item) => item.key === key)
  if (!preset) return config
  return {
    ...config,
    image_confidence_threshold: preset.image_confidence_threshold,
    text_relevance_threshold: preset.text_relevance_threshold,
    duplicate_similarity_threshold: preset.duplicate_similarity_threshold,
    minimum_description_length: preset.minimum_description_length,
  }
}

/** Plain-language names for the settings that stay visible. */
export const MISMATCH_OPTIONS: {
  value: ConcernClassificationConfig["mismatch_action"]
  label: string
  hint: string
}[] = [
  {
    value: "manual_review",
    label: "Hold it for an official",
    hint: "The report waits in your queue. Recommended.",
  },
  {
    value: "request_resubmission",
    label: "Ask the resident to redo it",
    hint: "They are asked for a clearer photo or description.",
  },
  {
    value: "reject",
    label: "Turn it down automatically",
    hint: "No official sees it first. Use with care.",
  },
]
