import { cn } from "@workspace/ui/lib/utils"
import type { EmergencyType } from "@/features/dashboard/emergency-api"
import {
  emergencies,
  SOS_ICON_WELL,
  type SosEmergencyOption,
} from "@/features/dashboard/components/sos/emergency-catalog"

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
      <p className="text-[14px] leading-6 text-white/70">
        Pick the closest match. Barangay responders will verify before
        dispatch.
      </p>
      <div className="grid grid-cols-2 gap-2">
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
                "flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors",
                selected
                  ? "border-brand-orange bg-brand-orange/15 ring-1 ring-brand-orange/40"
                  : "border-white/15 bg-white/5 hover:bg-white/10"
              )}
            >
              {item.iconImageUrl ? (
                <img src={item.iconImageUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
              ) : item.customIconLabel ? (
                <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-lg text-sm font-semibold", SOS_ICON_WELL)}>{item.customIconLabel}</span>
              ) : (
                <Icon
                  className={cn("size-12 shrink-0 rounded-lg p-2.5", SOS_ICON_WELL)}
                  strokeWidth={2}
                />
              )}
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-white">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-white/55">
                  {item.desc}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {error ? (
        <p className="text-[13px] font-medium text-sos-bright" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
