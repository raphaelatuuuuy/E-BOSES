import { useRef, useState } from "react"
import { toast } from "sonner"
import { EraserIcon, Loader2Icon, XIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import {
  addConcernMediaRedactions,
  removeConcernMediaRedaction,
  type ConcernMedia,
} from "@/features/dashboard/api"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"

interface Draft {
  x: number
  y: number
  width: number
  height: number
}

function normalisedPoint(event: React.PointerEvent<HTMLDivElement>, element: HTMLDivElement) {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  }
}

export function MediaBlurEditor({
  media,
  onClose,
  onUpdated,
}: {
  media: ConcernMedia
  onClose: () => void
  onUpdated: (media: ConcernMedia) => void
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const originRef = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState<Draft[]>([])
  const [busy, setBusy] = useState(false)

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!surfaceRef.current || busy) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = normalisedPoint(event, surfaceRef.current)
    originRef.current = point
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 })
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const origin = originRef.current
    if (!origin || !surfaceRef.current) return
    const point = normalisedPoint(event, surfaceRef.current)
    setDraft({
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      width: Math.abs(point.x - origin.x),
      height: Math.abs(point.y - origin.y),
    })
  }

  function onPointerUp() {
    const box = draft
    originRef.current = null
    setDraft(null)

    if (!box || box.width < 0.01 || box.height < 0.01) return
    setPending((current) => [...current, box])
  }

  async function save() {
    if (!pending.length) return
    setBusy(true)
    try {
      const next = await addConcernMediaRedactions(media.id, pending)
      onUpdated(next)
      setPending([])
      toast.success("The photo was updated with your blurred areas.")
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The blurred areas could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  async function removeSaved(redactionId: number) {
    setBusy(true)
    try {
      onUpdated(await removeConcernMediaRedaction(media.id, redactionId))
      toast.success("The blurred area was removed.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The blurred area could not be removed.")
    } finally {
      setBusy(false)
    }
  }

  async function removeAllSaved() {
    const regions = (media.redactions ?? []).slice()
    if (!regions.length) return
    setBusy(true)
    try {
      let current = media
      for (const region of regions) {
        current = await removeConcernMediaRedaction(media.id, region.id)
      }
      onUpdated(current)
      toast.success("All blurred areas were removed.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The blurred areas could not be removed.")
    } finally {
      setBusy(false)
    }
  }

  const saved = media.redactions ?? []

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-panel bg-card">
        <header className="flex items-start gap-3 border-b border-card-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-heading text-foreground">Blur an area</h3>
            <p className="mt-0.5 text-body text-muted-foreground">
              Drag across anything that should not be public. The blur is applied to the copy residents see; the
              original stays available to you.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-card-raised"
          >
            <XIcon className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div
            ref={surfaceRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDragStart={(event) => event.preventDefault()}
            className="relative mx-auto w-fit max-w-full cursor-crosshair touch-none select-none overflow-hidden rounded-control border border-card-line"
          >
            <AuthenticatedMediaImage
              src={media.raw_url || media.preview_url}
              alt={media.original_filename}
              className="pointer-events-none max-h-[52vh] w-auto max-w-full select-none object-contain"
              draggable={false}
            />
            {[...saved, ...pending, ...(draft ? [draft] : [])].map((box, index) => (
              <span
                key={`${box.x}-${box.y}-${index}`}
                aria-hidden
                className={cn(
                  "pointer-events-none absolute border-2",
                  index < saved.length
                    ? "border-status-closed bg-status-closed/35"
                    : "border-brand-orange bg-brand-orange/35",
                )}
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                }}
              />
            ))}
          </div>

          {saved.length ? (
            <div className="mt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-micro text-subtle-foreground">Already blurred</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeAllSaved()}
                  className="inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-[12px] font-medium text-severity-critical transition-colors hover:bg-severity-critical-surface disabled:opacity-50"
                >
                  <EraserIcon className="size-3.5" />
                  Remove all blur
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {saved.map((region, index) => (
                  <button
                    key={region.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void removeSaved(region.id)}
                    className="inline-flex items-center gap-1.5 rounded-pill bg-card-raised px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    <EraserIcon className="size-3.5" />
                    Area {index + 1}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-card-line px-4 py-3">
          <p className="mr-auto text-body text-muted-foreground">
            {pending.length ? `${pending.length} new area${pending.length === 1 ? "" : "s"}` : "Drag on the photo to add an area."}
          </p>
          {pending.length ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setPending([])}>
              Clear
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={busy || !pending.length}
            onClick={() => void save()}
            className="bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong"
          >
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {busy ? "Saving…" : "Save blurred areas"}
          </Button>
        </footer>
      </div>
    </div>
  )
}
