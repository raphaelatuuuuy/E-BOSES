import { useRef, useEffect } from "react"
import { Check as CheckIcon } from "@phosphor-icons/react"
import { cn } from "@workspace/ui/lib/utils"

const FEED_TABS = [
  { id: "for_you", label: "For you" },
  { id: "recent", label: "Recent" },
  { id: "nearby", label: "Nearby" },
  { id: "trending", label: "Trending" },
] as const

type FeedTab = (typeof FEED_TABS)[number]["id"]

export function HomeMobileFilterSheet({
  open,
  feedTab,
  onSelectTab,
  onClose,
}: {
  open: boolean
  feedTab: FeedTab
  onSelectTab: (tab: FeedTab) => void
  onClose: () => void
}) {
  const filterDialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open) filterDialogRef.current?.showModal()
    else filterDialogRef.current?.close()
  }, [open])

  if (!open) return null

  return (
      <dialog
        ref={filterDialogRef}
        aria-label="Filter by"
        className="z-[200] md:hidden backdrop:bg-black/30"
      >
        <div className="flex flex-col justify-end min-h-full">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Dismiss filters"
            className="min-h-0 flex-1 cursor-default"
            onClick={onClose}
          />
          <div className="rounded-t-3xl border border-neutral-200 border-b-0 bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_40px_rgba(15,23,42,0.14)]">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-300" />
          <h2 className="mb-2 px-1 text-[20px] font-bold tracking-tight text-neutral-900">
            Filter by
          </h2>
          <ul className="pb-2">
            {FEED_TABS.map((tab) => {
              const active = feedTab === tab.id
              return (
                <li key={tab.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectTab(tab.id)
                      onClose()
                    }}
                    className="flex min-h-12 w-full items-center justify-between px-1 py-3 text-left text-[16px] text-neutral-800 transition-colors hover:bg-neutral-50"
                  >
                    <span className={cn(active && "font-semibold text-neutral-900")}>
                      {tab.label}
                    </span>
                    {active ? (
                      <CheckIcon
                        className="size-5 shrink-0 text-neutral-900"
                        weight="bold"
                        aria-hidden
                      />
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </dialog>
  )
}