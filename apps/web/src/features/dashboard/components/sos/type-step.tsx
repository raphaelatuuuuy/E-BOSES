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
    <div className="flex min-h-full flex-col space-y-3">
      <p className="text-[14px] leading-6 text-white/70">
        Pick the closest match. Barangay responders will verify before
        dispatch.
      </p>
      <div className="grid flex-1 auto-rows-fr grid-cols-2 gap-2">
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
                "relative flex flex-col items-center justify-center gap-2.5 rounded-2xl border px-3 py-4 text-center transition-all",
                selected
                  ? "border-transparent bg-[linear-gradient(160deg,#ff8a3d_0%,#f2541b_60%,#d9480f_100%)] shadow-[0_12px_32px_rgba(242,84,27,0.5)]"
                  : "border-white/15 bg-white/5 hover:bg-white/10"
              )}
            >
              {item.iconImageUrl ? (
                <img src={item.iconImageUrl} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
              ) : item.customIconLabel ? (
                <span className={cn("flex size-14 shrink-0 items-center justify-center rounded-xl text-base font-semibold", selected ? "bg-white/20 text-white" : SOS_ICON_WELL)}>{item.customIconLabel}</span>
              ) : (
                <Icon
                  className={selected ? "size-[46px] shrink-0 text-white" : cn("size-14 shrink-0 rounded-xl p-3", SOS_ICON_WELL)}
                  strokeWidth={selected ? 2.2 : 2}
                />
              )}
              <span className="block text-[16px] leading-snug font-semibold text-white line-clamp-2">
                {item.label}
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
