import { useEffect, useState, type FormEvent } from "react"
import { MapPinnedIcon, MessageSquareIcon, SaveIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import {
  getMapDispatchPolicy,
  updateMapDispatchPolicy,
  type MapDispatchPolicy,
} from "@/features/dashboard/api"
import { usePageTitle } from "@/hooks/use-page-title"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { ConfigShell } from "@/features/dashboard/components/config/config-shell"
import { ZoneMap } from "@/features/dashboard/components/config/zone-map"

type Draft = {
  acceptance_center_latitude: string
  acceptance_center_longitude: string
  acceptance_radius_meters: string
  out_of_zone_action: MapDispatchPolicy["out_of_zone_action"]
  witness_radius_meters: string
  emergency_sms_number: string
  responder_nearby_radius_meters: string
}

function draftFromPolicy(policy: MapDispatchPolicy): Draft {
  return {
    acceptance_center_latitude: String(policy.acceptance_center_latitude),
    acceptance_center_longitude: String(policy.acceptance_center_longitude),
    acceptance_radius_meters: String(policy.acceptance_radius_meters),
    out_of_zone_action: policy.out_of_zone_action,
    witness_radius_meters: String(policy.witness_radius_meters),
    emergency_sms_number: policy.emergency_sms_number ?? "",
    responder_nearby_radius_meters: String(policy.responder_nearby_radius_meters),
  }
}

export default function OfficialMapDispatchPolicyPage() {
  usePageTitle("Map & Dispatch")
  const navigate = useNavigate()
  const [policy, setPolicy] = useState<MapDispatchPolicy | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const next = await getMapDispatchPolicy()
        if (cancelled) return
        setPolicy(next)
        setDraft(draftFromPolicy(next))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load map dispatch policy.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    try {
      const saved = await updateMapDispatchPolicy({
        acceptance_center_latitude: Number(draft.acceptance_center_latitude),
        acceptance_center_longitude: Number(draft.acceptance_center_longitude),
        acceptance_radius_meters: Number(draft.acceptance_radius_meters),
        out_of_zone_action: draft.out_of_zone_action,
        witness_radius_meters: Number(draft.witness_radius_meters),
        emergency_sms_number: draft.emergency_sms_number.trim(),
        responder_nearby_radius_meters: Number(draft.responder_nearby_radius_meters),
      })
      setPolicy(saved)
      setDraft(draftFromPolicy(saved))
      toast.success("Map dispatch policy saved")
    } catch (error) {
      toast.error(describeApiError(error, "Could not save map dispatch policy."))
    } finally {
      setSaving(false)
    }
  }

  function patch(next: Partial<Draft>) {
    setDraft((current) => current ? { ...current, ...next } : current)
  }

  const dirty = draft && policy ? JSON.stringify(draft) !== JSON.stringify(draftFromPolicy(policy)) : false

  return (
    <ConfigShell
      icon={MapPinnedIcon}
      eyebrow="Operations"
      title="Coverage & SMS fallback"
      description="Where reports are accepted, how far a neighbour alert reaches, and the SMS number residents fall back to when they have no mobile data."
      stats={
        draft
          ? [
              { label: "Accept within", value: `${draft.acceptance_radius_meters}m` },
              { label: "Alert neighbours", value: `${draft.witness_radius_meters}m` },
              { label: "Nearby responder", value: `${draft.responder_nearby_radius_meters}m` },
              {
                label: "SMS fallback",
                value: draft.emergency_sms_number ? "Set" : "Not set",
                alarm: !draft.emergency_sms_number,
              },
            ]
          : undefined
      }
    >
      {loading || !draft ? (
        <p className="rounded-2xl border border-card-line bg-card p-6 text-sm font-semibold text-muted-foreground">
          Loading policy…
        </p>
      ) : (
        <form onSubmit={save} className="space-y-5">
          {/* The map is the control, not an illustration: the rings on it and
              the numbers below are the same values. */}
          <ZoneMap
            value={{
              latitude: Number(draft.acceptance_center_latitude) || 14.6507,
              longitude: Number(draft.acceptance_center_longitude) || 121.1133,
              acceptanceRadius: Number(draft.acceptance_radius_meters) || 0,
              witnessRadius: Number(draft.witness_radius_meters) || 0,
              responderRadius: Number(draft.responder_nearby_radius_meters) || 0,
            }}
            onCenterChange={(latitude, longitude) =>
              patch({
                acceptance_center_latitude: String(latitude),
                acceptance_center_longitude: String(longitude),
              })
            }
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <RadiusField
              label="Reports accepted within"
              hint="A pin outside this ring is handled by the rule below."
              min={100}
              max={5000}
              value={draft.acceptance_radius_meters}
              onChange={(value) => patch({ acceptance_radius_meters: value })}
            />
            <RadiusField
              label="Alert neighbours within"
              hint="Verified residents this close to an SOS are asked to help."
              min={50}
              max={3000}
              value={draft.witness_radius_meters}
              onChange={(value) => patch({ witness_radius_meters: value })}
            />
            <RadiusField
              label="Responder counts as nearby"
              hint="Used to mark a responder as on-scene."
              min={10}
              max={1000}
              value={draft.responder_nearby_radius_meters}
              onChange={(value) => patch({ responder_nearby_radius_meters: value })}
            />
          </div>

          <section className="rounded-2xl border border-card-line bg-card p-4">
            <h2 className="text-sm font-bold text-foreground">
              When a pin falls outside the accepted zone
            </h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {OUT_OF_ZONE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`cursor-pointer rounded-xl border p-3 transition ${
                    draft.out_of_zone_action === option.value
                      ? "border-accent bg-accent/10"
                      : "border-card-line bg-canvas hover:border-accent/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="out_of_zone_action"
                    className="sr-only"
                    checked={draft.out_of_zone_action === option.value}
                    onChange={() => patch({ out_of_zone_action: option.value })}
                  />
                  <span className="block text-sm font-bold text-foreground">{option.label}</span>
                  <span className="mt-0.5 block text-xs font-medium text-muted-foreground">
                    {option.hint}
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* SMS lives here rather than on its own tab: it is part of how an
              emergency reaches the barangay, alongside the radii. */}
          <section
            className={`rounded-2xl border p-4 ${
              draft.emergency_sms_number
                ? "border-card-line bg-card"
                : "border-neutral-300 bg-neutral-50"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <MessageSquareIcon className="size-4" aria-hidden />
                  SMS fallback
                </h2>
                <p className="mt-1 max-w-xl text-xs font-medium leading-relaxed text-muted-foreground">
                  Signal is uneven across the barangay and most residents rely on mobile data. When
                  a resident has none, the SOS screen offers to text this number their location and
                  emergency type. Leave it blank to hide that option entirely.
                </p>
              </div>
              <label className="w-full sm:w-64">
                <span className="sr-only">SMS fallback number</span>
                <input
                  type="tel"
                  inputMode="tel"
                  maxLength={16}
                  placeholder="+639XXXXXXXXX"
                  value={draft.emergency_sms_number}
                  onChange={(event) => patch({ emergency_sms_number: event.target.value })}
                  className="h-11 w-full rounded-xl border border-card-line bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-accent"
                />
              </label>
            </div>
            {!draft.emergency_sms_number ? (
              <p className="mt-3 text-xs font-bold text-neutral-600">
                Not set — a resident with no mobile data currently has no way to raise an SOS.
              </p>
            ) : null}
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={saving || !dirty}
              className="rounded-xl bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
            >
              <SaveIcon className="size-4" />
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <button
              type="button"
              onClick={() => navigate("/dashboard/alerts-map")}
              className="text-xs font-bold text-muted-foreground transition hover:text-foreground"
            >
              Open the Alert Map
            </button>
            <span className="ml-auto text-xs font-medium text-muted-foreground">
              {policy?.updated_at
                ? `Updated ${new Date(policy.updated_at).toLocaleString()}`
                : "Using defaults"}
            </span>
          </div>
        </form>
      )}
    </ConfigShell>
  )
}

const OUT_OF_ZONE_OPTIONS: {
  value: Draft["out_of_zone_action"]
  label: string
  hint: string
}[] = [
  { value: "block", label: "Block it", hint: "The resident cannot submit." },
  { value: "warn", label: "Warn and allow", hint: "They are told, then may continue." },
  { value: "review", label: "Send for review", hint: "It arrives flagged for an official." },
]

/** A radius input paired with a slider: typing 800 gives no sense of scale,
 *  while dragging against the live rings does. */
function RadiusField({
  label,
  hint,
  min,
  max,
  value,
  onChange,
}: {
  label: string
  hint: string
  min: number
  max: number
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block rounded-2xl border border-card-line bg-card p-4">
      <span className="text-[11px] font-bold text-muted-foreground">
        {label}
      </span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <input
          required
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-24 border-0 bg-transparent p-0 font-heading text-3xl font-bold tabular-nums text-foreground outline-none"
        />
        <span className="text-sm font-bold text-muted-foreground">metres</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={10}
        value={Number(value) || min}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="mt-2 w-full accent-accent"
      />
      <span className="mt-1 block text-xs font-medium leading-relaxed text-muted-foreground">
        {hint}
      </span>
    </label>
  )
}
