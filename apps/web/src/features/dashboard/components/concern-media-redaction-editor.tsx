import { useEffect, useRef, useState, type PointerEvent } from "react"

import { Button } from "@workspace/ui/components/button"

import {
  getConcernMediaRedactions,
  saveConcernMediaRedactions,
  type ConcernMedia,
  type ConcernMediaRedaction,
} from "@/features/dashboard/api"
import { getAccessToken } from "@/lib/api"

type Point = { x: number; y: number }

function normalizeRectangle(start: Point, end: Point): ConcernMediaRedaction | null {
  const x = Math.max(0, Math.min(start.x, end.x))
  const y = Math.max(0, Math.min(start.y, end.y))
  const width = Math.min(1 - x, Math.abs(end.x - start.x))
  const height = Math.min(1 - y, Math.abs(end.y - start.y))
  return width >= 0.01 && height >= 0.01 ? { x, y, width, height } : null
}

function pointFor(event: PointerEvent<HTMLDivElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  }
}

export function ConcernMediaRedactionEditor({
  media,
  onSaved,
}: {
  media: ConcernMedia
  onSaved?: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [source, setSource] = useState("")
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null)
  const [regions, setRegions] = useState<ConcernMediaRedaction[]>([])
  const [draft, setDraft] = useState<ConcernMediaRedaction | null>(null)
  const startRef = useRef<Point | null>(null)

  useEffect(() => {
    if (!pendingBlob) return
    const url = URL.createObjectURL(pendingBlob)
    setSource(url)
    return () => {
      URL.revokeObjectURL(url)
      setSource("")
    }
  }, [pendingBlob])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const controller = new AbortController()
    setError("")

    async function load() {
      try {
        setLoading(true)
        const token = getAccessToken()
        const [review, response] = await Promise.all([
          getConcernMediaRedactions(media.id),
          fetch(media.raw_url, {
            signal: controller.signal,
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          }),
        ])
        if (!response.ok) throw new Error("The private evidence file could not be loaded.")
        const blob = await response.blob()
        if (!cancelled) {
          setPendingBlob(blob)
        }
        if (!cancelled) {
          setRegions(review.regions)
        }
      } catch (cause) {
        if (!cancelled && !(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "Media review could not be loaded.")
        }
      } finally {
        setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
      setPendingBlob(null)
    }
  }, [media.id, media.raw_url, open])

  function close() {
    if (!saving) setOpen(false)
  }

  function startDraw(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointFor(event)
    startRef.current = point
    setDraft(null)
  }

  function moveDraw(event: PointerEvent<HTMLDivElement>) {
    if (!startRef.current) return
    setDraft(normalizeRectangle(startRef.current, pointFor(event)))
  }

  function endDraw(event: PointerEvent<HTMLDivElement>) {
    if (!startRef.current) return
    const rectangle = normalizeRectangle(startRef.current, pointFor(event))
    if (rectangle) setRegions((current) => [...current, rectangle])
    startRef.current = null
    setDraft(null)
  }

  async function save(state: "private" | "pending_redaction" | "public" | "withheld") {
    setSaving(true)
    setError("")
    try {
      await saveConcernMediaRedactions(media.id, { state, regions })
      await onSaved?.()
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The reviewed media state could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (open) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [open])

  if (!media.mime_type.startsWith("image/")) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs font-extrabold text-[#2447b3] hover:underline"
      >
        Review privacy &amp; redaction
      </button>

      {open ? (
        <dialog ref={dialogRef} aria-label="Review media privacy" className="z-50 p-4 backdrop:bg-[#07145f]/55">
          <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-[#07145f]">Review media privacy</h2>
                <p className="mt-1 text-sm text-[#43507f]">Draw only over sensitive details. The original stays private; publishing creates a separate reviewed preview.</p>
              </div>
              <button type="button" onClick={close} className="rounded-lg px-2 py-1 text-sm font-bold text-[#43507f] hover:bg-slate-100">Close</button>
            </div>

            {loading ? <p className="py-16 text-center text-sm font-semibold text-[#68739c]">Loading private evidence…</p> : null}
            {!loading && source ? (
              <div className="mt-5 overflow-auto rounded-xl bg-slate-950 p-3">
                <div
                  className="relative mx-auto w-fit touch-none select-none"
                  onPointerDown={startDraw}
                  onPointerMove={moveDraw}
                  onPointerUp={endDraw}
                  onPointerCancel={endDraw}
                  onLostPointerCapture={endDraw}
                >
                  <img src={source} alt={media.original_filename} className="block max-h-[58vh] max-w-full rounded-md" draggable={false} />
                  {[...regions, ...(draft ? [draft] : [])].map((region, index) => (
                    <div
                      key={region.id ?? `${region.x}-${region.y}-${region.width}-${region.height}`}
                      className="absolute border-2 border-[#ff6a1a] bg-[#ff6a1a]/20"
                      style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}
                    >
                      {index < regions.length ? (
                        <button
                          type="button"
                          aria-label={`Remove redaction ${index + 1}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            setRegions((current) => current.filter((_, regionIndex) => regionIndex !== index))
                          }}
                          className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-[#07145f] text-xs font-black text-white"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
            <p className="mt-3 text-xs font-semibold text-[#68739c]">{regions.length} reviewed region{regions.length === 1 ? "" : "s"}. Remove a box and redraw it to adjust its coverage.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => void save("private")}>Keep private</Button>
              <Button type="button" variant="outline" disabled={saving} onClick={() => void save("pending_redaction")}>Save for later</Button>
              <Button type="button" disabled={saving || regions.length === 0} onClick={() => void save("public")} className="bg-[#07145f] text-white hover:bg-[#0e227c]">{saving ? "Saving…" : "Publish reviewed preview"}</Button>
              <Button type="button" variant="outline" disabled={saving} onClick={() => void save("withheld")}>Withhold from public</Button>
            </div>
          </section>
        </dialog>
      ) : null}
    </>
  )
}
