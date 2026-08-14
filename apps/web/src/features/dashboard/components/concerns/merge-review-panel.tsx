import { useEffect, useState } from "react"
import { toast } from "sonner"
import { GitMergeIcon, Loader2Icon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import {
  decideMergeSuggestion,
  listMergeSuggestions,
  type MergeCandidateBrief,
  type MergeSuggestion,
} from "@/features/dashboard/api"
import { Band, Surface } from "@/features/dashboard/components/workspace/band"

function confidenceLabel(value: number) {
  if (value >= 0.9) return "Very likely the same"
  if (value >= 0.8) return "Likely the same"
  return "Possibly the same"
}

function CandidateCard({ brief, label }: { brief: MergeCandidateBrief; label: string }) {
  return (
    <div className="min-w-0 rounded-control border border-card-line bg-canvas p-3">
      <p className="text-micro text-subtle-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{brief.title}</p>
      <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-muted-foreground">
        {brief.description}
      </p>
      <p className="mt-2 text-micro text-subtle-foreground">
        {brief.tracking_id} · {brief.reporter_name} · {brief.address || "No address"}
      </p>
    </div>
  )
}

export function MergeReviewPanel({ onDecided }: { onDecided?: () => void }) {
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [notes, setNotes] = useState<Record<number, string>>({})

  useEffect(() => {
    let cancelled = false
    listMergeSuggestions()
      .then((items) => {
        if (!cancelled) setSuggestions(items)
      })
      .catch(() => {
        if (!cancelled) setSuggestions([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function decide(suggestion: MergeSuggestion, decision: "approve" | "reject") {
    setBusyId(suggestion.id)
    try {
      await decideMergeSuggestion(suggestion.id, decision, notes[suggestion.id] ?? "")
      setSuggestions((current) => current.filter((item) => item.id !== suggestion.id))
      toast.success(
        decision === "approve"
          ? `${suggestion.concern.tracking_id} merged into ${suggestion.primary.tracking_id}.`
          : `${suggestion.concern.tracking_id} kept as a separate concern.`,
      )
      onDecided?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That decision could not be saved.")
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <Surface>
        <Band label="Merge review">
          <p className="text-body text-muted-foreground">Loading suggestions…</p>
        </Band>
      </Surface>
    )
  }

  if (suggestions.length === 0) {
    return (
      <Surface>
        <Band label="Merge review">
          <p className="text-body text-muted-foreground">
            Nothing waiting. Reports that clearly match are merged automatically; anything less
            certain appears here for you to decide.
          </p>
        </Band>
      </Surface>
    )
  }

  return (
    <Surface>
      <Band
        label="Merge review"
        action={
          <span className="text-micro text-subtle-foreground">
            {suggestions.length} awaiting a decision
          </span>
        }
      >
        <ul className="space-y-4">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="rounded-panel border border-card-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <GitMergeIcon className="size-4 shrink-0 text-brand-orange" />
                <p className="text-sm font-semibold text-foreground">
                  {confidenceLabel(suggestion.confidence)}
                </p>
                <span className="rounded-pill bg-card-raised px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {Math.round(suggestion.confidence * 100)}% match
                </span>
                {suggestion.distance_meters != null ? (
                  <span className="text-micro text-subtle-foreground">
                    {suggestion.distance_meters} m apart
                  </span>
                ) : null}
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <CandidateCard brief={suggestion.concern} label="New report" />
                <CandidateCard brief={suggestion.primary} label="Existing concern" />
              </div>

              <input
                value={notes[suggestion.id] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [suggestion.id]: event.target.value }))
                }
                placeholder="Why? (kept with the decision)"
                className="mt-3 h-10 w-full rounded-control border border-card-line bg-canvas px-3 text-label text-foreground outline-none placeholder:text-faint-foreground focus:border-brand-orange"
              />

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === suggestion.id}
                  onClick={() => void decide(suggestion, "approve")}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-control bg-brand-orange px-3 text-label font-semibold text-white",
                    "transition-colors hover:bg-brand-orange-strong disabled:opacity-60",
                  )}
                >
                  {busyId === suggestion.id ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                  Same incident — merge
                </button>
                <button
                  type="button"
                  disabled={busyId === suggestion.id}
                  onClick={() => void decide(suggestion, "reject")}
                  className="inline-flex h-9 items-center rounded-control border border-card-line px-3 text-label font-semibold text-foreground transition-colors hover:bg-card-raised disabled:opacity-60"
                >
                  Separate incidents
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Band>
    </Surface>
  )
}
