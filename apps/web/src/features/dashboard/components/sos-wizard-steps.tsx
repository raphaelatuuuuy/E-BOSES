import { Camera as CameraIcon, Check as CheckIcon, FirstAidKit, Fire, Phone as PhoneIcon, ShieldWarning, Tornado } from "@phosphor-icons/react"
import type { CSSProperties } from "react"

import { cn } from "@workspace/ui/lib/utils"

import type { EmergencyType } from "@/features/dashboard/emergency-api"
import type { SosLocationValue } from "@/features/dashboard/components/sos-location-step"
import { SosLocationStep } from "@/features/dashboard/components/sos-location-step"
import { stepIndex, type WizardStep } from "@/features/dashboard/components/sos-wizard-types"

const categoryItems = [
  {
    label: "Medical",
    value: "medical" as const,
    Icon: FirstAidKit,
    color: "#ef4444",
    desc: "Injury, illness, rescue",
  },
  {
    label: "Fire",
    value: "fire" as const,
    Icon: Fire,
    color: "#f97316",
    desc: "Building, forest, vehicle",
  },
  {
    label: "Crime",
    value: "crime" as const,
    Icon: ShieldWarning,
    color: "#8b5cf6",
    desc: "Assault, theft, threat",
  },
  {
    label: "Disaster",
    value: "disaster" as const,
    Icon: Tornado,
    color: "#0ea5e9",
    desc: "Flood, quake, storm",
  },
]

const WIZARD_LABELS = ["Type", "Location", "Details", "Review"] as const

export function WizardProgressBar({ step }: { step: WizardStep }) {
  if (step === "countdown") return null

  return (
    <div className="mb-5">
      <div className="mb-3 flex items-center justify-between gap-1">
        {WIZARD_LABELS.map((label, i) => {
          const n = i + 1
          const current = Math.min(stepIndex(step), 4)
          const done = n < current
          const active = n === current
          return (
            <div
              key={label}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-[11px] font-bold",
                  done && "bg-emerald-500 text-white",
                  active &&
                    "bg-[#ff6a1a] text-white shadow-[0_0_0_3px_rgba(255,106,26,0.28)]",
                  !done &&
                    !active &&
                    "border border-white/25 bg-transparent text-white/45",
                )}
              >
                {done ? (
                  <CheckIcon className="size-3.5" weight="bold" />
                ) : (
                  n
                )}
              </span>
              <span
                className={cn(
                  "truncate text-[10px] font-semibold",
                  active
                    ? "text-white"
                    : done
                      ? "text-white/70"
                      : "text-white/40",
                )}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-[#ff6a1a] transition-all duration-300"
          style={{
            width: `${(Math.min(stepIndex(step), 4) / 4) * 100}%`,
          }}
        />
      </div>
    </div>
  )
}

export function CategoryStep({
  emergency,
  fieldError,
  onSelect,
}: {
  emergency: EmergencyType | ""
  fieldError?: string
  onSelect: (value: EmergencyType) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-[14px] leading-6 text-white/75">
        Pick the closest match. Barangay responders will verify before dispatch.
      </p>
      <div className="space-y-2">
        {categoryItems.map((item) => {
          const selected = emergency === item.value
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(item.value)}
              style={
                selected
                  ? ({
                      borderColor: item.color,
                      boxShadow: `0 0 0 1px ${item.color}80`,
                    } as CSSProperties)
                  : undefined
              }
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3.5 text-left transition-colors",
                selected
                  ? "bg-white/15"
                  : "border-white/15 bg-white/5 hover:bg-white/10",
              )}
            >
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${item.color}26` }}
              >
                <item.Icon
                  className="size-6"
                  style={{ color: item.color }}
                  weight="fill"
                  aria-hidden="true"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-white">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[13px] text-white/60">
                  {item.desc}
                </span>
              </span>
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full border"
                style={
                  selected
                    ? {
                        borderColor: item.color,
                        backgroundColor: item.color,
                        color: "#fff",
                      }
                    : undefined
                }
              >
                {selected ? (
                  <CheckIcon className="size-3.5" weight="bold" />
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
      {fieldError ? (
        <p className="text-[13px] font-medium text-red-300" role="alert">
          {fieldError}
        </p>
      ) : null}
    </div>
  )
}

export function LocationStepField({
  value,
  onChange,
  fieldError,
}: {
  value: SosLocationValue | null
  onChange: (value: SosLocationValue | null) => void
  fieldError?: string
}) {
  return (
    <div className="flex min-h-[360px] flex-col">
      <p className="mb-3 text-[14px] leading-6 text-white/75">
        GPS first: drag the map so help goes to the right pin.
      </p>
      <SosLocationStep
        value={value}
        onChange={onChange}
        className="min-h-[280px]"
      />
      {fieldError ? (
        <p className="mt-2 text-[13px] font-medium text-red-300" role="alert">
          {fieldError}
        </p>
      ) : null}
    </div>
  )
}

export function DetailsStepField({
  note,
  mediaFiles,
  fieldError,
  onNoteChange,
  onMediaSelect,
  onMediaClear,
}: {
  note: string
  mediaFiles: File[]
  fieldError?: string
  onNoteChange: (value: string) => void
  onMediaSelect: (files: FileList | null) => void
  onMediaClear: () => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-6 text-white/75">
        Optional: a photo or note helps responders prepare.
      </p>
      <input
        id="sos-media-input"
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={(e) => onMediaSelect(e.target.files)}
      />
      <label
        htmlFor="sos-media-input"
        className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 text-[14px] font-semibold text-white hover:bg-white/15"
      >
        <CameraIcon className="size-4" />
        {mediaFiles.length
          ? `${mediaFiles.length} photo(s) selected`
          : "Add photo"}
      </label>
      {mediaFiles.length ? (
        <div className="flex flex-wrap gap-2">
          {mediaFiles.map((file) => (
            <span
              key={file.name}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[12px] font-medium text-white/90"
            >
              {file.name}
            </span>
          ))}
          <button
            type="button"
            onClick={onMediaClear}
            className="text-[12px] font-semibold text-white/60 underline"
          >
            Clear
          </button>
        </div>
      ) : null}
      {fieldError ? (
        <p className="text-[13px] font-medium text-red-300" role="alert">
          {fieldError}
        </p>
      ) : null}
      <textarea
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        aria-label="Quick note for responders" placeholder="Quick note for responders (optional)"
        rows={4}
        className="w-full resize-none rounded-xl border border-white/15 bg-black/25 px-3.5 py-3 text-[14px] text-white outline-none placeholder:text-white/40 focus:border-[#ff6a1a]"
      />
    </div>
  )
}

export function ReviewStepView({
  emergency,
  location,
  mediaFiles,
  note,
  isOnline,
  submitError,
  emergencySmsHref,
  onSendSmsFallback,
}: {
  emergency: string
  location: SosLocationValue | null
  mediaFiles: File[]
  note: string
  isOnline: boolean
  submitError: string
  emergencySmsHref: string
  onSendSmsFallback: () => void
}) {
  const typeMeta = categoryItems.find((e) => e.value === emergency)

  return (
    <div className="space-y-3">
      {!isOnline ? (
        <div
          className="rounded-xl border border-amber-300/60 bg-amber-400/15 p-4 text-amber-50"
          role="status"
          aria-live="polite"
        >
          <p className="text-[14px] font-semibold">You're offline</p>
          <p className="mt-1 text-[13px] leading-5 text-amber-50/80">
            Your entries remain on this screen. Reconnect to use online responder routing
            {emergencySmsHref ? ", or open the SMS backup below." : "."}
          </p>
          {!emergencySmsHref ? (
            <p className="mt-2 text-[12px] leading-5 text-white/65">
              SMS backup is not configured on this device. If anyone is in immediate danger, call your local emergency number.
            </p>
          ) : (
            <p className="mt-2 text-[12px] leading-5 text-white/65">
              Opening SMS creates a draft only. Review it and press Send in your phone's messaging app.
            </p>
          )}
        </div>
      ) : null}
      {submitError ? (
        <div
          className="rounded-xl border border-red-400/50 bg-red-500/15 p-4"
          role="alert"
        >
          <p className="text-[14px] font-semibold text-red-100">Alert was not sent</p>
          <p className="mt-1 text-[13px] leading-5 text-red-100/80">{submitError}</p>
          <p className="mt-2 text-[12px] leading-5 text-white/65">Check your connection and try again. Your details are still here.</p>
          {emergencySmsHref ? (
            <a
              href={emergencySmsHref}
              onClick={onSendSmsFallback}
              className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-3.5 text-[13px] font-bold text-[#050e45] hover:bg-white/90"
            >
              <PhoneIcon className="size-4" />
              Open SMS backup
            </a>
          ) : null}
          {emergencySmsHref ? (
            <p className="mt-2 text-[11px] leading-4 text-white/55">This opens your phone's SMS app. Review the message and press send.</p>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-xl border border-white/15 bg-white/10 p-4">
        <p className="text-[11px] font-semibold tracking-wide text-white/55 uppercase">Emergency type</p>
        <p className="mt-1 text-[15px] font-semibold text-white">{typeMeta?.label ?? "-"}</p>
      </div>
      <div className="rounded-xl border border-white/15 bg-white/10 p-4">
        <p className="text-[11px] font-semibold tracking-wide text-white/55 uppercase">Location</p>
        <p className="mt-1 text-[15px] font-semibold text-white">{location?.addressPrimary || location?.address || "-"}</p>
      </div>
      <div className="rounded-xl border border-white/15 bg-white/10 p-4">
        <p className="text-[11px] font-semibold tracking-wide text-white/55 uppercase">Evidence</p>
        <p className="mt-1 text-[15px] font-semibold text-white">{mediaFiles.length ? `${mediaFiles.length} photo(s)` : "None"}</p>
        {note.trim() ? (
          <p className="mt-2 text-[14px] leading-6 text-white/75">{note.trim()}</p>
        ) : null}
      </div>
      <div className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-[13px] leading-5 text-amber-100">
        False or misleading alerts are logged. Repeated abuse can suspend your account. Accidental alerts can be cancelled afterward with a reason.
      </div>
    </div>
  )
}

export function CountdownStepView({
  countdown,
  submitting,
  typeLabel,
  location,
}: {
  countdown: number
  submitting: boolean
  typeLabel?: string
  location: SosLocationValue | null
}) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-4 text-center">
      <div className="relative flex size-36 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-red-500/15" />
        <span className="absolute inset-3 rounded-full bg-red-500/20" />
        <p
          className="relative text-6xl font-black text-red-300 tabular-nums"
          aria-hidden="true"
        >
          {submitting ? "..." : countdown}
        </p>
      </div>
      <p className="mt-5 text-[12px] font-bold tracking-wide text-white/55 uppercase">
        {submitting ? "Sending alert..." : "Broadcasting in"}
      </p>
      <p className="mt-2 max-w-xs text-[15px] font-medium text-white">
        Tap cancel if you sent this by accident.
      </p>
      <div className="mt-6 w-full max-w-xs rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-[12px] text-white/70">
        <p>
          <span className="font-semibold text-white">
            {typeLabel ?? "Emergency"}
          </span>
          {" \u00B7 "}
          {location?.addressPrimary || location?.address || "Pinned location"}
        </p>
        <p className="mt-1 text-white/45">After sending, cancellation requires a reason.</p>
      </div>
    </div>
  )
}
