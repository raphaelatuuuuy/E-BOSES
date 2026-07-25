import { House, Minus, NavigationArrow, Plus } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { MapControlButton, MapWeatherButton, MapWeatherDetails } from "@/features/dashboard/components/map-weather"
import type { LayerKey } from "./alerts-map-view"

export function MapControls({
  onGoHome,
  onGoToLocation,
  locating,
  weatherOpen,
  weather,
  onWeatherToggle,
  onZoomIn,
  onZoomOut,
}: {
  onGoHome: () => void
  onGoToLocation: () => void
  locating: boolean
  weatherOpen: boolean
  weather: ReturnType<typeof import("@/features/dashboard/components/map-weather").useMapWeather>
  onWeatherToggle: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}) {
  return (
    <div className="absolute right-3 top-3 z-[600] flex flex-col items-end gap-2 sm:right-4 sm:top-4">
      <MapControlButton label="Barangay" icon={<House className="size-4" />} onClick={onGoHome} />
      <MapControlButton label="Current location" icon={<NavigationArrow className="size-4" />} onClick={onGoToLocation} loading={locating} />
      <div className="relative">
        <MapWeatherButton weather={weather} open={weatherOpen} onClick={onWeatherToggle} />
        {weatherOpen ? (
          <div className="absolute right-0 top-12 z-[650] w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-[#dfe7f5] bg-white p-4 text-[#07145f] shadow-2xl">
            <div className="border-b border-neutral-100 pb-3">
              <p className="text-base font-black">{weather.placeName}</p>
              <p className="text-xs font-semibold text-[#687599]">Live barangay weather</p>
            </div>
            <MapWeatherDetails weather={weather} />
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MapControlButton label="Zoom in" icon={<Plus className="size-5" />} onClick={onZoomIn} showLabel={false} />
        <MapControlButton label="Zoom out" icon={<Minus className="size-5" />} onClick={onZoomOut} showLabel={false} />
      </div>
    </div>
  )
}

export function MapLegend({
  layers,
  counts,
  onToggle,
  onReset,
  open,
  onOpenChange,
}: {
  layers: Record<LayerKey, boolean>
  counts: { residents: number; responders: number; officials: number; emergencies: number; concerns: number; routes: number }
  onToggle: (key: LayerKey) => void
  onReset: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <div className="absolute bottom-4 right-4 z-[500] w-auto min-w-[140px] rounded-xl bg-white/95 p-3 text-xs font-bold text-[#43507f] shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => onOpenChange(!open)} className="flex items-center gap-1.5 text-sm font-black text-[#07145f]">
          {open ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
          Legend
        </button>
        {open && (
          <button type="button" onClick={onReset} className="text-[11px] font-black text-[#2447b3]">Reset All</button>
        )}
      </div>
      {open && (
      <div className="mt-2 flex flex-col gap-1">
        <button type="button" className="flex cursor-pointer items-center justify-between gap-2" onClick={() => onToggle("boundary")} aria-pressed={layers.boundary}>
          <span className="flex items-center gap-2">
            <span className={cn("h-0.5 w-4", layers.boundary ? "bg-red-500" : "bg-neutral-300")} />
            <span className={cn("text-xs font-bold", layers.boundary ? "text-[#43507f]" : "text-neutral-400")}>Boundary</span>
          </span>
        </button>
        <button type="button" className="flex cursor-pointer items-center justify-between gap-2 text-left w-full" onClick={() => onToggle("streets")} aria-pressed={layers.streets}>
          <span className="flex items-center gap-2">
            <span className={cn("h-0.5 w-4", layers.streets ? "bg-blue-500" : "bg-neutral-300")} />
            <span className={cn("text-xs font-bold", layers.streets ? "text-[#43507f]" : "text-neutral-400")}>Streets</span>
          </span>
        </button>
        <button type="button" className="flex cursor-pointer items-center justify-between gap-2 text-left w-full" onClick={() => onToggle("routes")} aria-pressed={layers.routes}>
          <span className="flex items-center gap-2">
            <span className={cn("h-0 w-4 border-t-2", layers.routes ? "border-blue-500 border-dashed" : "border-neutral-300")} />
            <span className={cn("text-xs font-bold", layers.routes ? "text-[#43507f]" : "text-neutral-400")}>Routes</span>
          </span>
          <span className={cn("text-[11px] font-bold", layers.routes ? "text-[#2447b3]" : "text-neutral-400")}>{counts.routes}</span>
        </button>
        <button type="button" className="flex cursor-pointer items-center justify-between gap-2 text-left w-full" onClick={() => onToggle("acceptance_zone")} aria-pressed={layers.acceptance_zone}>
          <span className="flex items-center gap-2">
            <span className={cn("h-0 w-4 rounded-full border", layers.acceptance_zone ? "border-[#94a3b8] bg-[#94a3b8]/20" : "border-neutral-300")} />
            <span className={cn("text-xs font-bold", layers.acceptance_zone ? "text-[#43507f]" : "text-neutral-400")}>Acceptance Zone</span>
          </span>
        </button>
        <div className="my-1 border-t border-neutral-200" />
        <button type="button" className="flex cursor-pointer items-center justify-between gap-2 text-left w-full" onClick={() => onToggle("residents")} aria-pressed={layers.residents}>
          <span className="flex items-center gap-2">
            <span className={cn("flex size-3 shrink-0 items-center justify-center rounded-full", layers.residents ? "bg-emerald-500" : "bg-neutral-300")} />
            <span className={cn("text-xs font-bold", layers.residents ? "text-[#43507f]" : "text-neutral-400")}>Residents</span>
          </span>
          <span className={cn("text-[11px] font-bold", layers.residents ? "text-[#2447b3]" : "text-neutral-400")}>{counts.residents}</span>
        </button>
        <button type="button" className="flex cursor-pointer items-center justify-between gap-2 text-left w-full" onClick={() => onToggle("responders")} aria-pressed={layers.responders}>
          <span className="flex items-center gap-2">
            <span className={cn("flex size-3 shrink-0 items-center justify-center rounded-full", layers.responders ? "bg-blue-600" : "bg-neutral-300")} />
            <span className={cn("text-xs font-bold", layers.responders ? "text-[#43507f]" : "text-neutral-400")}>Responders</span>
          </span>
          <span className={cn("text-[11px] font-bold", layers.responders ? "text-[#2447b3]" : "text-neutral-400")}>{counts.responders}</span>
        </button>
        <button type="button" className="flex cursor-pointer items-center justify-between gap-2 text-left w-full" onClick={() => onToggle("officials")} aria-pressed={layers.officials}>
          <span className="flex items-center gap-2">
            <span className={cn("flex size-3 shrink-0 items-center justify-center rounded-full", layers.officials ? "bg-purple-600" : "bg-neutral-300")} />
            <span className={cn("text-xs font-bold", layers.officials ? "text-[#43507f]" : "text-neutral-400")}>Officials</span>
          </span>
          <span className={cn("text-[11px] font-bold", layers.officials ? "text-[#2447b3]" : "text-neutral-400")}>{counts.officials}</span>
        </button>
        <button type="button" className="flex cursor-pointer items-center justify-between gap-2 text-left w-full" onClick={() => onToggle("emergencies")} aria-pressed={layers.emergencies}>
          <span className="flex items-center gap-2">
            <span className={cn("flex size-3 shrink-0 items-center justify-center rounded-full", layers.emergencies ? "bg-red-600" : "bg-neutral-300")} />
            <span className={cn("text-xs font-bold", layers.emergencies ? "text-[#43507f]" : "text-neutral-400")}>Emergencies</span>
          </span>
          <span className={cn("text-[11px] font-bold", layers.emergencies ? "text-[#2447b3]" : "text-neutral-400")}>{counts.emergencies}</span>
        </button>
        <button type="button" className="flex cursor-pointer items-center justify-between gap-2 text-left w-full" onClick={() => onToggle("concerns")} aria-pressed={layers.concerns}>
          <span className="flex items-center gap-2">
            <span className={cn("flex size-3 shrink-0 items-center justify-center rounded-full", layers.concerns ? "bg-orange-500" : "bg-neutral-300")} />
            <span className={cn("text-xs font-bold", layers.concerns ? "text-[#43507f]" : "text-neutral-400")}>Concerns</span>
          </span>
          <span className={cn("text-[11px] font-bold", layers.concerns ? "text-[#2447b3]" : "text-neutral-400")}>{counts.concerns}</span>
        </button>
      </div>
      )}
    </div>
  )
}

export function StreetFilterBadge({ selectedStreetNames }: { selectedStreetNames: Set<string> }) {
  if (!selectedStreetNames.size) return null
  return (
    <div className="absolute bottom-4 right-4 z-[500] max-w-xs rounded-xl bg-white/95 px-4 py-3 text-xs font-semibold text-[#43507f] shadow-lg">
      Street filter: {[...selectedStreetNames].slice(0, 3).join(", ")}{selectedStreetNames.size > 3 ? ` +${selectedStreetNames.size - 3}` : ""}
    </div>
  )
}

export function AcceptanceZoneEditor({
  zoneDraft,
  zoneDirty,
  zoneSaving,
  onSave,
}: {
  zoneDraft: { acceptance_radius_meters: string | number; out_of_zone_action: string }
  zoneDirty: boolean
  zoneSaving: boolean
  onSave: () => void
}) {
  return (
    <div className="w-[min(15rem,calc(100vw-2rem))] rounded-lg border border-[#dfe7f5] bg-white/95 p-3 text-left shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase text-[#68739c]">Acceptance Zone</p>
          <p className="mt-0.5 text-sm font-black text-[#07145f]">{Math.round(Number(zoneDraft.acceptance_radius_meters) || 0)} m</p>
          <p className="mt-0.5 text-[11px] font-bold capitalize text-[#68739c]">{zoneDraft.out_of_zone_action.replace(/_/g, " ")}</p>
        </div>
        <Button type="button" size="sm" disabled={!zoneDirty || zoneSaving} onClick={onSave} className="h-8 rounded-md bg-[#07145f] px-3 text-xs font-black text-white hover:bg-[#0d217e]">
          Save
        </Button>
      </div>
      <p className="mt-2 text-[11px] font-semibold leading-4 text-[#68739c]">Drag the center or edge handle, then save.</p>
    </div>
  )
}
