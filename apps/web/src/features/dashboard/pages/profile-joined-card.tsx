import { CaretRight, ChatCircle, Globe, DotsThree as MoreHorizontalIcon } from "@phosphor-icons/react"

export function ProfileJoinedCard({
  letter,
  fullName,
  barangay,
  memberSince,
  joinedLine,
  onEdit,
}: {
  letter: string
  fullName: string
  barangay: string
  memberSince: string
  joinedLine: string
  onEdit: () => void
}) {
  return (
    <article className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start gap-2.5">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] text-[15px] font-bold text-[#2c3a5a]">{letter}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-neutral-900">{fullName}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[13px] text-neutral-500">
                <span>{barangay}</span><span aria-hidden>·</span><span>{memberSince}</span><Globe className="size-3.5" />
              </p>
            </div>
            <button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100" aria-label="More">
              <MoreHorizontalIcon className="size-5" />
            </button>
          </div>
          <p className="mt-2 text-[15px] leading-snug text-neutral-800">{joinedLine}</p>

          <button type="button" onClick={onEdit} className="mt-3 flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-left transition-colors hover:bg-neutral-100">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-neutral-600 ring-1 ring-neutral-200">
              <ChatCircle className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-neutral-900">Add an intro</span>
              <span className="mt-0.5 block text-[12px] text-neutral-500">Say hello and introduce yourself</span>
            </span>
            <CaretRight className="size-5 shrink-0 text-neutral-400" />
          </button>
        </div>
      </div>
    </article>
  )
}
