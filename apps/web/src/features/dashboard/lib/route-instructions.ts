import type { EmergencyRouteStep } from "@/features/dashboard/emergency-api"

/**
 * OSRM returns maneuver codes, not prose. This turns them into the sentences
 * the reference router shows — "Head northeast", "Turn left onto AN 2",
 * "You have arrived at your destination, on the right".
 */

const COMPASS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const

export function bearingWord(degrees: number | null | undefined) {
  if (degrees == null || !Number.isFinite(degrees)) return ""
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8
  return COMPASS[index]
}

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"]

function ordinal(value: number | null | undefined) {
  if (value == null || value < 1) return ""
  return ORDINALS[value] ?? `${value}th`
}

function roadName(step: EmergencyRouteStep) {
  const name = step.name?.trim() ?? ""
  const ref = step.ref?.trim() ?? ""
  if (name && ref && name !== ref) return name
  return name || ref
}

function onto(step: EmergencyRouteStep) {
  const road = roadName(step)
  return road ? ` onto ${road}` : ""
}

function towards(step: EmergencyRouteStep) {
  const road = roadName(step)
  return road ? ` on ${road}` : ""
}

function turnWord(modifier: string) {
  const value = modifier?.trim().toLowerCase() ?? ""
  if (!value || value === "straight") return "straight"
  if (value === "uturn") return "around"
  return value
}

export function instructionText(step: EmergencyRouteStep): string {
  const modifier = turnWord(step.modifier)

  switch (step.type) {
    case "depart":
      return `Head ${bearingWord(step.bearing_after)}${towards(step)}`.trimEnd()
    case "arrive":
      return ["left", "right"].includes(modifier)
        ? `You have arrived at your destination, on the ${modifier}`
        : "You have arrived at your destination"
    case "turn":
      return modifier === "around" ? `Make a U-turn${onto(step)}` : `Turn ${modifier}${onto(step)}`
    case "end of road":
      return `Turn ${modifier}${onto(step)}`
    case "new name":
      return `Continue${onto(step)}`
    case "continue":
      return modifier === "straight" ? `Continue${onto(step)}` : `Continue ${modifier}${onto(step)}`
    case "merge":
      return `Merge ${modifier}${onto(step)}`
    case "fork":
      return modifier === "straight" ? `Keep going at the fork` : `Keep ${modifier} at the fork`
    case "on ramp":
      return `Take the ramp on the ${modifier}${onto(step)}`
    case "off ramp":
      return `Take the exit on the ${modifier}${onto(step)}`
    case "roundabout":
    case "rotary": {
      const exit = ordinal(step.exit)
      return exit
        ? `Enter the roundabout and take the ${exit} exit${onto(step)}`
        : `Enter the roundabout${onto(step)}`
    }
    case "roundabout turn":
      return `At the roundabout, turn ${modifier}${onto(step)}`
    case "exit roundabout":
    case "exit rotary":
      return `Exit the roundabout${onto(step)}`
    case "notification":
      return `Continue ${modifier}${onto(step)}`
    default:
      return roadName(step) ? `Continue${onto(step)}` : "Continue"
  }
}

/** Rounds harder than the route total: 15 m, 150 m, 800 m, 1.2 km. */
export function formatStepDistance(meters: number | null | undefined) {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return ""
  if (meters < 10) return `${Math.round(meters)} m`
  if (meters < 1000) {
    const step = meters < 100 ? 5 : 10
    return `${Math.round(meters / step) * step} m`
  }
  return `${(meters / 1000).toFixed(1)} km`
}

export type ManeuverGlyph =
  | "depart"
  | "arrive"
  | "left"
  | "right"
  | "straight"
  | "uturn"
  | "roundabout"

export function maneuverGlyph(step: EmergencyRouteStep): ManeuverGlyph {
  if (step.type === "depart") return "depart"
  if (step.type === "arrive") return "arrive"
  if (step.type.includes("roundabout") || step.type.includes("rotary")) return "roundabout"
  const modifier = turnWord(step.modifier)
  if (modifier === "around") return "uturn"
  if (modifier.includes("left")) return "left"
  if (modifier.includes("right")) return "right"
  return "straight"
}
