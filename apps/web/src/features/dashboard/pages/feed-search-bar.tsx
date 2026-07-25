import { Faders, MagnifyingGlass } from "@phosphor-icons/react"
import { Input } from "@workspace/ui/components/input"

export function FeedSearchBar({
  search,
  onSearchChange,
  onReset,
}: {
  search: string
  onSearchChange: (v: string) => void
  onReset: () => void
}) {
  return (
    <div className="mt-5 flex gap-3">
      <div className="relative min-w-0 flex-1">
        <MagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#2447b3]" />
        <Input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search posts, concerns, or keywords"
          className="h-12 rounded-lg border-[#cbd8ee] bg-white pl-12 text-sm font-semibold text-[#07145f] placeholder:text-[#8b96b8] focus-visible:border-[#ff6a1a] focus-visible:ring-[#ff6a1a]/20"
          aria-label="Search validated community concerns"
        />
      </div>
      <button
        type="button"
        onClick={onReset}
        className="hidden h-12 items-center gap-2 rounded-lg border border-[#cbd8ee] bg-white px-5 text-sm font-bold text-[#07145f] transition-colors hover:border-[#ff6a1a] hover:text-[#ff6a1a] sm:inline-flex"
      >
        <Faders className="size-4" />
        Reset
      </button>
    </div>
  )
}
