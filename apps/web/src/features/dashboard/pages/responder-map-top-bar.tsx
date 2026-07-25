import { Crosshair, NavigationArrow, CircleNotch, Radio } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

export function ResponderMapTopBar({
  routeSummary,
  routeLoading,
  routeStatus,
  userPos,
  error,
  busy,
  onLocateMe,
}: {
  routeSummary: string
  routeLoading: boolean
  routeStatus: string | undefined
  userPos: GeolocationPosition | null
  error: string
  busy: string
  onLocateMe: () => void
}) {
  return (
    <div className="absolute left-3 top-3 z-[650] max-w-[calc(100%-5.5rem)] rounded-2xl border border-neutral-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:left-4 sm:top-4 sm:max-w-md sm:p-4 md:max-w-[min(28rem,calc(100%-27rem))]">
      <p className="text-[11px] font-black uppercase tracking-wide text-[#ff6a1a]">Responder map</p>
      <div className="mt-1 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-black text-[#07145f] sm:text-lg">Assigned incidents near you</h1>
          <p className="mt-0.5 hidden text-xs font-semibold text-neutral-600 sm:block">Your live GPS pin updates automatically while responding.</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={onLocateMe} aria-label="Recenter on my current location">
          {busy === "locate" ? <CircleNotch className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
          <span className="hidden sm:inline">Recenter</span>
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black",
          routeStatus === "ok"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-amber-200 bg-amber-50 text-amber-700",
        )}>
          {routeLoading ? <CircleNotch className="size-3.5 animate-spin" /> : <NavigationArrow className="size-3.5" />}
          {routeSummary}
        </span>
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black",
          userPos ? "border-blue-200 bg-blue-50 text-blue-700" : "border-neutral-200 bg-neutral-50 text-neutral-600",
        )}>
          <Radio className="size-3.5" />
          {userPos ? "GPS live" : "GPS needed"}
        </span>
      </div>
      {error ? <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">{error}</p> : null}
    </div>
  )
}
