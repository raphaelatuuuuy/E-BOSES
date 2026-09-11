import type { LucideIcon } from "lucide-react"
import {
  ArrowLeftRightIcon,
  BanIcon,
  CheckIcon,
  ClockIcon,
  LoaderCircleIcon,
  MapPinIcon,
  PencilLineIcon,
  RadioIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { useIncidentActions } from "@/features/dashboard/components/responder/use-incident-actions"
import type { EmergencyStatus } from "@/features/dashboard/emergency-api"
import { statusWords } from "@/features/dashboard/lib/responder-format"

/**
 * One action, always in the same place.
 *
 * The old panel rendered up to four buttons at once inside a scrolling sheet,
 * so the thing the responder actually had to press could be off-screen and was
 * never in the same spot twice. The gating in `use-incident-actions` already
 * yields exactly one legal transition per status — this renders that one, at
 * 56px, full width, pinned.
 */

type Actions = ReturnType<typeof useIncidentActions>

interface Resolved {
  label: string
  icon: LucideIcon
  onClick?: () => void
  disabled: boolean
  spinning: boolean
  /** Terminal states are stated, not offered. */
  quiet: boolean
}

/** A stated, not offered, status line: no button, no spinner. */
function quiet(label: string, icon: LucideIcon): Resolved {
  return { label, icon, disabled: true, spinning: false, quiet: true }
}

/**
 * States the responder is parked in on purpose. The GPS loop and the
 * responder_actions endpoints advance these, never the action bar, so each
 * reads as a status line — the old fallback spun "Confirming you are en
 * route…" forever for these, which is how a `backup_requested` fire looked
 * stuck.
 */
const HOLDING: Record<string, { label: string; icon: LucideIcon }> = {
  submitted: { label: "Awaiting assignment", icon: ClockIcon },
  routing: { label: "Finding responder", icon: ClockIcon },
  awaiting_acknowledgment: { label: "Awaiting responder", icon: ClockIcon },
  backup_requested: { label: "Awaiting backup response", icon: RadioIcon },
  backup_assigned: { label: "Backup responder on the way", icon: RadioIcon },
  transfer_required: { label: "Transfer requested", icon: ArrowLeftRightIcon },
  escalation_required: { label: "Escalation pending", icon: ShieldAlertIcon },
  in_progress: { label: "On scene, incident in progress", icon: MapPinIcon },
  resident_safe: { label: "Resident safe", icon: ShieldCheckIcon },
}

function resolveAction(actions: Actions): Resolved {
  if (!actions.hasOwnAssignment) {
    return quiet("Awaiting assignment", ClockIcon)
  }
  if (actions.isCancelled) {
    return { label: "Dispatch cancelled", icon: BanIcon, disabled: true, spinning: false, quiet: true }
  }
  if (actions.resolvedReached) {
    return { label: "Incident resolved", icon: ShieldCheckIcon, disabled: true, spinning: false, quiet: true }
  }
  if (actions.canStartTravel) {
    return {
      label: "Start travelling",
      icon: CheckIcon,
      onClick: () => void actions.handleStartTravel(),
      disabled: Boolean(actions.busy),
      spinning: actions.busy === "start-travel",
      quiet: false,
    }
  }
  if (actions.canMarkArrived) {
    return {
      label: "I have arrived on scene",
      icon: MapPinIcon,
      onClick: () => void actions.handleArrived(),
      disabled: Boolean(actions.busy),
      spinning: actions.busy === "arrived",
      quiet: false,
    }
  }
  if (actions.canResolve) {
    return {
      label: "Update the status",
      icon: PencilLineIcon,
      onClick: () => void actions.handleResolve(),
      disabled: Boolean(actions.busy),
      spinning: actions.busy === "resolve",
      quiet: false,
    }
  }
  // Parked in a holding state: state the incident plainly instead of implying
  // a location ping is still expected.
  if (actions.holding) {
    const held = HOLDING[actions.status] ?? {
      label: statusWords[actions.status as EmergencyStatus] ?? "Awaiting update",
      icon: ClockIcon,
    }
    return quiet(held.label, held.icon)
  }
  // Defensive — should not be reachable while the gating stays sequential.
  return quiet("Awaiting update", ClockIcon)
}

export function DispatchActionBar({
  actions,
  className,
}: {
  actions: Actions
  className?: string
}) {
  const action = resolveAction(actions)
  const Icon = action.spinning ? LoaderCircleIcon : action.icon
  const backupPending =
    actions.status === "backup_requested" || actions.status === "backup_assigned"

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      <button
        type="button"
        onClick={action.onClick}
        disabled={action.disabled}
        aria-live="polite"
        className={cn(
          "flex h-14 w-full items-center justify-center gap-2 rounded-pill px-5 text-heading transition-colors duration-[--duration-micro]",
          action.quiet
            ? "cursor-default border border-card-line bg-card-raised text-subtle-foreground"
            : "bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong disabled:opacity-60",
        )}
      >
        <Icon className={cn("size-5 shrink-0", action.spinning && "animate-spin")} />
        {action.label}
      </button>
      {backupPending && !action.quiet ? (
        <p className="flex items-center justify-center gap-1.5 text-body text-subtle-foreground">
          <RadioIcon className="size-3.5" />
          Backup requested. Other responders alerted
        </p>
      ) : null}
      {!action.quiet && actions.lastConfirmed ? (
        <p
          key={actions.lastConfirmed.at}
          role="status"
          className="flex items-center justify-center gap-1.5 text-body font-medium text-subtle-foreground"
        >
          <CheckIcon className="size-3.5 text-orange-600" aria-hidden />
          {actions.lastConfirmed.label}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Backup, as the reference's floating "+".
 *
 * Positioned by the caller inside the map card rather than fixed to the
 * viewport, so on a phone it cannot land on top of the action bar or the
 * bottom nav pill.
 */
export function BackupFab({
  actions,
  className,
}: {
  actions: Actions
  className?: string
}) {
  if (!actions.canRequestBackup) return null

  return (
    <button
      type="button"
      onClick={() => void actions.handleBackup()}
      disabled={Boolean(actions.busy)}
      aria-label="Request backup"
      title="Request backup"
      className={cn(
        "flex size-14 items-center justify-center rounded-full bg-brand-orange text-brand-orange-ink shadow-glow-orange transition-transform duration-[--duration-micro] active:scale-95 disabled:opacity-60",
        className,
      )}
    >
      {actions.busy === "backup" ? (
        <LoaderCircleIcon className="size-6 animate-spin" />
      ) : (
        <RadioIcon className="size-6" />
      )}
    </button>
  )
}
