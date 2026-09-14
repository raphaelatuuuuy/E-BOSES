import { CircleCheck, SearchIcon, SlidersHorizontalIcon } from "lucide-react"

import { ALERT_FEED_CHIPS } from "./alerts-feed"

export function AlertsSearchRow({
  query,
  onQuery,
  filterOpen,
  onToggleFilter,
  chip,
  onSelectChip,
}: {
  query: string
  onQuery: (value: string) => void
  filterOpen: boolean
  onToggleFilter: () => void
  chip: string
  onSelectChip: (key: string) => void
}) {
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleFilter}
          aria-label={filterOpen ? "Hide filters" : "Show filters"}
          aria-expanded={filterOpen}
          aria-pressed={filterOpen}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 transition-colors hover:bg-neutral-200"
        >
          <SlidersHorizontalIcon className="size-5" aria-hidden="true" />
        </button>
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full bg-neutral-100 pr-4 pl-4">
          <SearchIcon
            className="size-5 shrink-0 text-neutral-500"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search alerts"
            aria-label="Search alerts"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400"
          />
        </label>
      </div>
      {filterOpen ? (
        <>
          <button
            type="button"
            aria-label="Close filters"
            onClick={onToggleFilter}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
          />
          <div
            role="listbox"
            aria-label="Alert filters"
            className="absolute top-full right-0 left-0 z-50 mt-2 overflow-hidden rounded-[20px] bg-white p-1.5 shadow-lg ring-1 ring-neutral-200"
          >
            {ALERT_FEED_CHIPS.map((option) => {
              const selected = chip === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onSelectChip(option.key)
                    onToggleFilter()
                  }}
                  className="flex w-full items-center gap-3 rounded-[12px] px-4 py-2.5 text-left transition hover:bg-neutral-50"
                >
                  <span className="min-w-0 flex-1 text-[15px] font-medium text-neutral-900">
                    {option.label}
                  </span>
                  {selected ? (
                    <CircleCheck
                      className="size-4 shrink-0 text-green-600"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}
