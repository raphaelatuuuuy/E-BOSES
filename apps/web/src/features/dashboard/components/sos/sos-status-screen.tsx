import {
  CircleCheck,
  MapPinIcon,
  MessageSquareIcon,
  NavigationIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

const SMS_STAGES = ["received", "en_route", "nearby", "arrived", "resolved"] as const

const STAGE_ICONS = {
  received: MessageSquareIcon,
  en_route: NavigationIcon,
  nearby: MapPinIcon,
  arrived: NavigationIcon,
  resolved: CircleCheck,
} as const

const STAGE_LABELS = {
  received: "Received",
  en_route: "Responders en route",
  nearby: "Responders nearby",
  arrived: "Responders on scene",
  resolved: "Resolved",
} as const

interface SosStatusScreenProps {
  onGoHome: () => void
  smsSentImmediately?: boolean
}

export function SosStatusScreen({ onGoHome, smsSentImmediately }: SosStatusScreenProps) {
  const showFooter = !smsSentImmediately
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 flex gap-1.5 px-5 pt-3" aria-hidden="true">
        {SMS_STAGES.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-[5px] flex-1 rounded-full",
              i < SMS_STAGES.length
                ? "bg-brand-orange shadow-[0_0_12px_rgba(255,106,26,0.7)]"
                : "bg-white/15",
            )}
          />
        ))}
      </div>

      <div className="px-5 pt-4 pb-6 overflow-y-auto overscroll-contain [-webkit-over-scroll-scrolling:touch]">
        <StatusItem icon={TriangleAlertIcon} label="Status" value="Sent" />
        <StatusItem icon={MessageSquareIcon} label="Status" value={STAGE_LABELS.received} showResend />

        {SMS_STAGES.slice(1).map((stage) => (
          <StatusItem
            key={stage}
            icon={STAGE_ICONS[stage as keyof typeof STAGE_ICONS]}
            label="Status"
            value={STAGE_LABELS[stage as keyof typeof STAGE_LABELS]}
          />
        ))}
      </div>

      <div className="shrink-0 px-5">
        <div className="flex items-center gap-3 border-t border-white/10 pt-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-[14px] font-bold text-white">RJ</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-bold leading-tight text-white">Juan Dela Cruz</p>
            <p className="truncate text-[12px] leading-tight text-white/40 font-variant-numeric">+6391900000005</p>
          </div>
          <a href="tel:+6391900000005" className="flex shrink-0 items-center justify-center rounded-full bg-brand-orange/15 px-3 py-2 text-[12px] font-bold text-brand-orange transition-colors hover:bg-brand-orange/25">Call</a>
          <button type="button" className="flex shrink-0 items-center justify-center rounded-full border border-white/15 px-3 py-2 text-[12px] font-bold text-white/70 transition-colors hover:bg-white/10">Chat</button>
        </div>
      </div>

      {showFooter ? (
        <div className="shrink-0 border-t border-white/10" />
      ) : (
        <div className="shrink-0 border-t border-white/10 bg-brand-navy px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-col items-center gap-2 py-2">
            <button type="button" onClick={onGoHome} className="h-[44px] rounded-full bg-white/10 px-6 text-[14px] font-semibold text-white transition-colors hover:bg-white/15">Go back to app</button>
            <span className="text-[12px] text-white/50">You are back online</span>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusItem({
  icon: Icon,
  label,
  value,
  showResend,
}: {
  icon: typeof TriangleAlertIcon
  label: string
  value: string
  showResend?: boolean
}) {
  return (
    <div className="relative flex gap-3 pb-[20px]">
      <span aria-hidden="true" className="absolute top-[42px] bottom-0 left-[19px] w-[2px] bg-[linear-gradient(rgba(255,106,26,0.6),rgba(255,106,26,0.08))]" />
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(160deg,#ff8a3d_0%,#f2541b_60%,#d9480f_100%)] text-white shadow-[0_6px_16px_rgba(242,84,27,0.4)]">
        <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold tracking-wide text-[#ff8a5c] uppercase">{label}</p>
        <p className="mt-0.5 text-[15.5px] leading-snug font-semibold break-words text-white">{value}</p>
        {showResend && (
          <button type="button" className="mt-2 flex min-h-10 shrink-0 items-center justify-center self-start rounded-[10px] px-3 text-[12px] font-bold text-white transition-colors hover:bg-white/10 active:scale-95">Resend</button>
        )}
      </div>
    </div>
  )
}
