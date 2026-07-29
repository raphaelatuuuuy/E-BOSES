import {
  Activity,
  Ambulance,
  Baby,
  BadgeAlert,
  Bell,
  CheckIcon,
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

import { cn } from "@workspace/ui/lib/utils"
import type { EmergencyCategory, EmergencyType } from "@/features/dashboard/emergency-api"

const ICON_BY_KEY = {
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

export function SosTypeStep({
  value,
  onSelect,
  error,
  options = emergencies,
}: {
  value: EmergencyType | ""
  onSelect: (next: EmergencyType) => void
  error?: string
  options?: SosEmergencyOption[]
}) {
  return (
    <div className="space-y-3">
      <p className="text-[14px] leading-6 text-white/75">
        Pick the closest match. Barangay responders will verify before
        dispatch.
      </p>
      <div className="space-y-2">
        {options.map((item) => {
          const selected = value === item.value
          const Icon = item.icon
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(item.value)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3.5 text-left transition-colors",
                selected
                  ? "border-brand-orange bg-white/15 ring-1 ring-brand-orange/50"
                  : "border-white/15 bg-white/5 hover:bg-white/10"
              )}
            >
              {item.iconImageUrl ? (
                <img src={item.iconImageUrl} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
              ) : item.customIconLabel ? (
                <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg text-sm font-black", item.iconBg, item.iconColor)}>{item.customIconLabel}</span>
              ) : (
                <Icon
                  className={cn("size-11 shrink-0 rounded-lg p-2", item.iconBg, item.iconColor)}
                  strokeWidth={2}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-white">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[13px] text-white/60">
                  {item.desc}
                </span>
              </span>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border",
                  selected
                    ? "border-brand-orange bg-brand-orange text-white"
                    : "border-white/30 bg-transparent"
                )}
              >
                {selected ? (
                  <CheckIcon className="size-3.5" strokeWidth={3} />
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
      {error ? (
        <p className="text-[13px] font-medium text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
