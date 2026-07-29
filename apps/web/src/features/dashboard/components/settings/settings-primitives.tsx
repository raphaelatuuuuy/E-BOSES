import { ChevronRightIcon } from "lucide-react"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { Skeleton } from "@workspace/ui/components/skeleton"

/**
 * Reusable settings-page primitives, extracted verbatim from
 * pages/settings.tsx (resident settings) so the official settings page can
 * reuse the same hub-row / toggle-row / field-shell / skeleton patterns
 * without duplicating markup. Pure extraction — no visual change intended;
 * pages/settings.tsx re-imports these under their original names.
 */

/** Resident settings keys that can be toggled from the privacy/notifications panels. */
export type SettingKey =
  | "push_alerts"
  | "report_updates"
  | "community_sharing"
  | "location_confirmation"

export function SettingsSkeleton() {
  return (
    <div className="min-w-0 flex-1 bg-white px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4 md:px-8 md:pb-12 md:pt-6">
      <div className="mx-auto max-w-lg">
        <Skeleton className="mx-auto h-6 w-28 bg-neutral-100" />
        <div className="mt-8 space-y-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-14 w-full rounded-none border-b border-neutral-100 bg-neutral-100"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function HubRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[56px] w-full items-center gap-3.5 border-b border-neutral-200 px-1 py-3.5 text-left transition-colors hover:bg-neutral-50"
    >
      <Icon className="size-5 shrink-0 text-neutral-800" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 text-[16px] font-normal text-neutral-900">{label}</span>
      <ChevronRightIcon className="size-5 shrink-0 text-neutral-400" strokeWidth={2} />
    </button>
  )
}

export function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  busy,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  busy?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-200 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[15px] font-medium text-neutral-900">
          {label}
        </label>
        <p className="mt-1 text-[13px] leading-5 text-neutral-500">{description}</p>
      </div>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled || busy}
        aria-busy={busy}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5"
      />
    </div>
  )
}

export function FieldShell({
  label,
  children,
  hint,
}: {
  label?: string
  children: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <div className="mb-4">
      {label ? (
        <p className="mb-2 text-[13px] font-semibold text-neutral-700">{label}</p>
      ) : null}
      {children}
      {hint}
    </div>
  )
}
