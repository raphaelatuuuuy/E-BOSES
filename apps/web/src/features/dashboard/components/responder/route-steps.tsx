import {
  ArrowUpIcon,
  BikeIcon,
  CarIcon,
  CornerUpLeftIcon,
  CornerUpRightIcon,
  FootprintsIcon,
  LoaderCircleIcon,
  MapPinIcon,
  NavigationIcon,
  RotateCcwIcon,
  RotateCwIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type {
  EmergencyRoute,
  TravelProfile,
} from "@/features/dashboard/emergency-api"
import { formatEta, formatKm } from "@/features/dashboard/lib/responder-format"
import {
  formatStepDistance,
  instructionText,
  maneuverGlyph,
  type ManeuverGlyph,
} from "@/features/dashboard/lib/route-instructions"
import {
  Empty,
  Segmented,
} from "@/features/dashboard/components/responder/dispatch-surface"
import type { StepProgress } from "@/features/dashboard/lib/route-progress"

/** Turn-by-turn for the responder working the dispatch. */

const PROFILES = [
  { id: "car", label: "Car" },
  { id: "bike", label: "Bike" },
  { id: "foot", label: "Foot" },
] as const satisfies ReadonlyArray<{ id: TravelProfile; label: string }>

const PROFILE_ICONS: Record<TravelProfile, LucideIcon> = {
  car: CarIcon,
  bike: BikeIcon,
  foot: FootprintsIcon,
}

const GLYPH_ICONS: Record<ManeuverGlyph, LucideIcon> = {
  depart: NavigationIcon,
  arrive: MapPinIcon,
  left: CornerUpLeftIcon,
  right: CornerUpRightIcon,
  straight: ArrowUpIcon,
  uturn: RotateCcwIcon,
  roundabout: RotateCwIcon,
}

export function RouteSteps({
  route,
  progress,
  profile,
  onProfileChange,
  busy = false,
  className,
}: {
  route: EmergencyRoute | null
  /** Null without a live fix; the list then reads as a plain itinerary. */
  progress: StepProgress | null
  profile: TravelProfile
  onProfileChange: (next: TravelProfile) => void
  busy?: boolean
  className?: string
}) {
  const ProfileIcon = PROFILE_ICONS[profile]
  const steps = route?.steps ?? []
  const usable = route != null && route.status !== "unavailable"
  const activeIndex = progress?.activeIndex ?? -1

  return (
    <div className={cn("min-w-0", className)}>
      <Segmented
        options={PROFILES}
        value={profile}
        onChange={onProfileChange}
        label="Travel profile"
      />

      {usable ? (
        <div className="mt-4 flex items-baseline justify-between gap-3 border-b border-card-line pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <ProfileIcon className="size-4 shrink-0 text-subtle-foreground" />
            <p className="truncate text-heading text-foreground">
              {route.summary || "Fastest route"}
            </p>
          </div>
          <p className="shrink-0 text-body text-subtle-foreground tabular-nums">
            {formatKm(
              (progress?.metersRemaining ?? route.distance_meters ?? 0) / 1000
            )}
            , {formatEta(route.eta_seconds)}
          </p>
        </div>
      ) : null}

      {/* The next turn, lifted out of the list so it can be read at a glance
          rather than found in it. */}
      {progress && steps[activeIndex] ? (
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-ice/25 bg-ice/10 px-3 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-ice/20 text-ice">
            {(() => {
              const Icon = GLYPH_ICONS[maneuverGlyph(steps[activeIndex])]
              return <Icon className="size-4" />
            })()}
          </span>
          <p className="min-w-0 flex-1 text-body leading-5 font-semibold text-foreground">
            {instructionText(steps[activeIndex])}
          </p>
          <span className="shrink-0 text-heading text-ice tabular-nums">
            {formatStepDistance(progress.metersToNext)}
          </span>
        </div>
      ) : null}

      {busy ? (
        <p className="mt-4 flex items-center gap-2 text-body text-subtle-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          Recalculating on {profile}…
        </p>
      ) : !usable ? (
        <div className="mt-4">
          <Empty>
            No route yet. Directions appear once the router has a position for
            you and a pin for the incident.
          </Empty>
        </div>
      ) : steps.length === 0 ? (
        <div className="mt-4">
          <Empty>
            The router returned this leg without turn-by-turn directions.
          </Empty>
        </div>
      ) : (
        <ol className="mt-1">
          {steps.map((step, index) => {
            const Icon = GLYPH_ICONS[maneuverGlyph(step)]
            const active = index === activeIndex
            // Only dim once we know where the responder is; without a fix the
            // list is an itinerary and every step still matters.
            const passed = activeIndex >= 0 && index < activeIndex
            const distance = active
              ? formatStepDistance(progress?.metersToNext ?? step.distance)
              : formatStepDistance(step.distance)
            return (
              <li
                key={`${step.type}-${index}`}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex items-start gap-3 border-b border-card-line py-3 last:border-b-0",
                  passed && "opacity-40"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg",
                    active ? "bg-ice text-ink" : "bg-ice/10 text-ice"
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <p
                  className={cn(
                    "min-w-0 flex-1 text-body leading-6",
                    active ? "font-semibold text-foreground" : "text-foreground"
                  )}
                >
                  {instructionText(step)}
                </p>
                {distance ? (
                  <span
                    className={cn(
                      "shrink-0 pt-0.5 text-body tabular-nums",
                      active ? "text-ice" : "text-subtle-foreground"
                    )}
                  >
                    {distance}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
