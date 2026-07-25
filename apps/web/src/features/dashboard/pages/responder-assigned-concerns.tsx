import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import type { Concern } from "@/features/dashboard/api"
import { ConcernConversation } from "@/features/dashboard/components/concern-conversation"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"

export function ResponderAssignedConcerns({
  assignedConcerns,
  onRefresh,
}: {
  assignedConcerns: Concern[]
  onRefresh: () => void
}) {
  const [assignedChatId, setAssignedChatId] = useState<number | null>(null)

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#07145f]">Assigned concerns</p>
          <p className="mt-1 text-xs font-semibold text-neutral-500">
            Field reports assigned to you by barangay officials.
          </p>
        </div>
        <span className="rounded-full bg-[#eef3ff] px-2.5 py-1 text-xs font-black text-[#07145f]">
          {assignedConcerns.length}
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {assignedConcerns.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-200 p-4 text-xs font-semibold text-neutral-500">
            No active concern assignments.
          </p>
        ) : assignedConcerns.map((concern) => (
          <article key={concern.id} className="rounded-2xl border border-neutral-200 bg-[#f8fafc] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-[#07145f]">{concern.title}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">{concern.description}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-[#43507f] ring-1 ring-neutral-200">
                {concern.status.replace(/_/g, " ")}
              </span>
            </div>
            <p className="mt-2 text-[11px] font-bold text-neutral-500">
              {concern.address || concern.barangay} · {concern.tracking_id}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setAssignedChatId((current) => current === concern.id ? null : concern.id)}
            >
              {assignedChatId === concern.id ? "Close report chat" : "Open report chat"}
            </Button>
            {assignedChatId === concern.id ? (
              <div className="mt-3 space-y-3">
                <ConcernConversation items={concern.conversation ?? []} />
                <ReportChatPanel
                  concernId={concern.id}
                  open
                  disabled={false}
                  showHistory={false}
                  title="Message this case"
                  subtitle="Your message is added to the shared case conversation."
                  onMessageSent={onRefresh}
                />
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
