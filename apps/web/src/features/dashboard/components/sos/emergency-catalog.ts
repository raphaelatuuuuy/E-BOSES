// apps/web/src/features/dashboard/components/sos/emergency-catalog.ts

import {
  Activity,
  Ambulance,
  Baby,
  BadgeAlert,
  Bell,
  CloudRainWind,
  Flame,
  HeartCrack,
  Home,
  MapPin,
  Pill,
  ShieldAlert,
  Siren,
  Stethoscope,
  Waves,
  Zap,
} from "lucide-react"

import type { EmergencyCategory, EmergencyType } from "@/features/dashboard/emergency-api"

export const ICON_BY_KEY = {
  activity: Activity,
  ambulance: Ambulance,
  baby: Baby,
  "badge-alert": BadgeAlert,
  bell: Bell,
  "cloud-rain-wind": CloudRainWind,
  flame: Flame,
  "heart-crack": HeartCrack,
  home: Home,
  "map-pin": MapPin,
  pill: Pill,
  "shield-alert": ShieldAlert,
  siren: Siren,
  stethoscope: Stethoscope,
  waves: Waves,
  zap: Zap,
} as const

export interface SosEmergencyOption {
  label: string
  value: EmergencyType
  icon: typeof Activity
  customIconLabel?: string
  iconImageUrl?: string
  desc: string
}

/**
 * One treatment for every emergency type.
 *
 * Each type used to carry its own `iconBg`/`iconColor` pair, so the SOS wizard
 * opened as an eight-colour chart in which no colour meant anything. The icon
 * says what the emergency is; the surface says only "pick one".
 */
export const SOS_ICON_WELL = "bg-brand-orange/15 text-brand-orange"

/**
 * Emergency type catalogue — shared by the type-select step and the
 * review/countdown step (which needs the label for the selected type).
 */
export const emergencies: SosEmergencyOption[] = [
  {
    label: "Medical",
    value: "medical" as const,
    icon: Activity,
    desc: "Injury, illness, rescue",
  },
  {
    label: "Fire",
    value: "fire" as const,
    icon: Flame,
    desc: "Building, house, residence",
  },
  {
    label: "Crime",
    value: "crime" as const,
    icon: ShieldAlert,
    desc: "Assault, theft, threat",
  },
  {
    label: "Disaster",
    value: "disaster" as const,
    icon: CloudRainWind,
    desc: "Flood, quake, storm",
  },
  {
    label: "Child Protection",
    value: "child_protection" as const,
    icon: ShieldAlert,
    desc: "Child abuse, neglect, exploitation",
  },
  {
    label: "Domestic Violence",
    value: "domestic_violence" as const,
    icon: ShieldAlert,
    desc: "Violence at home, VAWC cases",
  },
]

export function emergencyOptionsFromCategories(categories: EmergencyCategory[]) {
  return categories.filter((category) => category.is_active).map((category) => ({
    label: category.label,
    value: category.code as EmergencyType,
    icon: ICON_BY_KEY[category.icon_key as keyof typeof ICON_BY_KEY] ?? Siren,
    customIconLabel: category.custom_icon_label,
    iconImageUrl: category.icon_image_url,
    desc: category.subtext,
  }))
}