import { MapPin } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { Concern } from "@/features/dashboard/api"

export function ResponderNearbyConcerns({
  concerns,
  selectedConcernId,
  concernBusy,
  replyOpenId,
  replyDraft,
  concernCardRefs,
  onLike,
  onSetReplyOpen,
  onReplyDraftChange,
  onPostReply,
}: {
  concerns: Concern[]
  selectedConcernId: number | null
  concernBusy: number | null
  replyOpenId: number | null
  replyDraft: string
  concernCardRefs: React.MutableRefObject<Record<number, HTMLElement | null>>
  onSelect: (id: number) => void
  onLike: (concern: Concern) => void
  onSetReplyOpen: React.Dispatch<React.SetStateAction<number | null>>
  onReplyDraftChange: (value: string) => void
  onPostReply: (concern: Concern) => void
}) {
  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#07145f]">Nearby community alerts</p>
          <p className="mt-1 text-xs font-semibold text-neutral-500">Like, respond, or open a nearby thread without leaving the map.</p>
        </div>
        <MapPin className="size-5 text-[#ff6a1a]" />
      </div>
      <div className="mt-3 space-y-3">
        {concerns.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-200 p-4 text-xs font-semibold text-neutral-500">No nearby community alerts available.</p>
        ) : concerns.map((concern) => (
          <article
            key={concern.id}
            ref={(node) => { concernCardRefs.current[concern.id] = node }}
            className={cn(
              "rounded-2xl border bg-[#f8fafc] p-3 transition-colors",
              selectedConcernId === concern.id ? "border-[#ff6a1a] ring-2 ring-[#ff6a1a]/15" : "border-neutral-200",
            )}
          >
            <p className="text-sm font-black text-[#07145f]">{concern.title}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">{concern.description}</p>
            <p className="mt-2 text-[11px] font-bold text-neutral-500">{concern.address || concern.barangay} · {concern.vote_count} support · {concern.comment_count} replies</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={concernBusy === concern.id} onClick={() => onLike(concern)}>
                {concern.user_vote === 1 ? "Supported" : "Like"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => onSetReplyOpen((value) => value === concern.id ? null : concern.id)}>
                Respond / Reply
              </Button>
            </div>
            {replyOpenId === concern.id ? (
              <div className="mt-3 space-y-2">
                <textarea value={replyDraft} onChange={(e) => onReplyDraftChange(e.target.value)} aria-label="Write a useful response" placeholder="Write a useful response…" rows={2} className="w-full resize-none rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#ff6a1a]" />
                <Button type="button" size="sm" disabled={concernBusy === concern.id || !replyDraft.trim()} onClick={() => onPostReply(concern)} className="bg-[#07145f] text-white hover:bg-[#10227a]">Post response</Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
