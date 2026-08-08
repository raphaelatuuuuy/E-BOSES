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
  iconBg: string
  iconColor: string
}

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
    iconBg: "bg-emerald-500/20",
    iconColor: "text-emerald-400",
  },
  {
    label: "Fire",
    value: "fire" as const,
    icon: Flame,
    desc: "Building, house, residence",
    iconBg: "bg-orange-500/20",
    iconColor: "text-orange-400",
  },
  {
    label: "Crime",
    value: "crime" as const,
    icon: ShieldAlert,
    desc: "Assault, theft, threat",
    iconBg: "bg-violet-500/20",
    iconColor: "text-violet-400",
  },
  {
    label: "Disaster",
    value: "disaster" as const,
    icon: CloudRainWind,
    desc: "Flood, quake, storm",
    iconBg: "bg-blue-500/20",
    iconColor: "text-blue-400",
  },
  {
    label: "Child Protection",
    value: "child_protection" as const,
    icon: ShieldAlert,
    desc: "Child abuse, neglect, exploitation",
    iconBg: "bg-pink-500/20",
    iconColor: "text-pink-300",
  },
  {
    label: "Domestic Violence",
    value: "domestic_violence" as const,
    icon: ShieldAlert,
    desc: "Violence at home, VAWC cases",
    iconBg: "bg-red-500/20",
    iconColor: "text-red-300",
  },
  {
    label: "Drug-Related",
    value: "drug_related" as const,
    icon: ShieldAlert,
    desc: "Drug-related incident or concern",
    iconBg: "bg-amber-500/20",
    iconColor: "text-amber-300",
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
    iconBg: "bg-white/10",
    iconColor: "text-white",
  }))
}