import { cn } from "@workspace/ui/lib/utils"

export function MapPinOverlay({
  sheetMode,
  locationClass,
  geocoding,
  previewParts,
  canConfirm,
  handleConfirm,
}: {
  sheetMode: string
  locationClass: { warning?: string | null; accepted: boolean; message: string } | null
  geocoding: boolean
  previewParts: { primary: string; secondary: string; full: string }
  canConfirm: boolean
  handleConfirm: () => void
}) {
  if (sheetMode === "expanded") return null

  return (
    <>
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1100] h-0 w-0 overflow-visible" aria-hidden>
        <img src="/contents/map-pin-gps.png" alt="" width={56} height={56}
          className="absolute left-0 top-0 h-14 w-14 max-w-none object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]"
          style={{ marginLeft: -28, marginTop: -(56 + 28) }} draggable={false} />
        <span className="eboses-pin-pulse absolute left-0 top-0 size-3 rounded-full bg-[#2b7fff]"
          style={{ marginLeft: -6, marginTop: -6, boxShadow: "0 1px 4px rgba(0,0,0,0.35)" }} />
      </div>

      <div className={cn("pointer-events-none absolute inset-x-0 z-[1100] flex flex-col items-center gap-2 px-4", sheetMode === "peek" ? "top-[calc(50%+24px)]" : "top-[calc(50%+36px)]")}>
        {locationClass?.warning ? (
          <p className="pointer-events-none max-w-[min(100%,320px)] rounded-xl bg-amber-50 px-3 py-2 text-center text-[12px] font-medium text-amber-800 shadow-sm ring-1 ring-amber-200/80">{locationClass.warning}</p>
        ) : null}
        {locationClass && !locationClass.accepted ? (
          <p className="pointer-events-none max-w-[min(100%,320px)] rounded-xl bg-red-50 px-3 py-2 text-center text-[12px] font-medium text-red-700 shadow-sm ring-1 ring-red-200/80">{locationClass.message}</p>
        ) : null}
        <button type="button" onClick={handleConfirm} disabled={!canConfirm || geocoding}
          className={cn("pointer-events-auto flex max-w-[min(100%,340px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-7 py-3.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform", canConfirm ? "hover:scale-[1.02] active:scale-[0.99]" : "cursor-not-allowed opacity-60")}>
          <span className="text-[16px] font-semibold leading-none text-neutral-900">Use this location</span>
          <span className="mt-1.5 line-clamp-2 text-[14px] font-medium leading-snug text-neutral-500">
            {geocoding ? "Finding address…" : previewParts.primary}
          </span>
        </button>
      </div>
    </>
  )
}

export function MapSearchSheet({
  sheetMode,
  search,
  onSearchChange,
  onSearchFocusedChange,
  searching,
  hasQuery,
  results,
  onFlyTo,
  searchInputRef,
}: {
  sheetMode: "collapsed" | "peek" | "expanded"
  search: string
  onSearchChange: (value: string) => void
  onSearchFocusedChange: (focused: boolean) => void
  searching: boolean
  hasQuery: boolean
  results: Array<{ lat: number; lng: number; label: string; primary: string; secondary: string }>
  onFlyTo: (lat: number, lng: number) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <div className={cn("absolute inset-x-0 bottom-0 z-[1400] flex h-full flex-col overflow-hidden bg-white rounded-t-2xl border-t border-neutral-200 shadow-[0_-8px_28px_rgba(0,0,0,0.12)] transition-transform duration-300 ease-out will-change-transform",
      sheetMode === "expanded" && "translate-y-0 rounded-none border-0 shadow-none",
      sheetMode === "peek" && "translate-y-[calc(100%-100px)]",
      sheetMode === "collapsed" && "translate-y-[calc(100%-72px)]")}>
      <div className="shrink-0 px-4 pb-2 pt-3">
        {sheetMode === "peek" ? (
          <button type="button" className="mb-2 h-6 w-full rounded-full text-xs font-semibold text-neutral-500" onClick={() => onSearchFocusedChange(true)}>Expand search</button>
        ) : null}
        <div className="relative">
          <svg className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/></svg>
          <input ref={searchInputRef} type="text" value={search} onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => onSearchFocusedChange(true)} onBlur={() => window.setTimeout(() => onSearchFocusedChange(false), 180)}
            aria-label="Search streets" placeholder="Search streets in Marikina Heights" autoComplete="off"
            className="h-11 w-full rounded-full border border-neutral-200 bg-white pl-10 pr-4 text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100" />
        </div>
      </div>

      <ul className={cn("min-h-0 flex-1 list-none overflow-y-auto", sheetMode === "collapsed" && "hidden", sheetMode === "peek" && "pointer-events-none select-none")}>
        {searching ? <li className="px-5 py-3 text-[14px] text-neutral-500">Searching…</li>
        : !hasQuery ? null
        : results.length === 0 ? <li className="px-5 py-3 text-[14px] text-neutral-500">No places found inside Marikina Heights (or its edge buffer)</li>
        : results.map((item) => (
            <li key={`${item.lat}-${item.lng}-${item.label}`} className="border-b border-neutral-100 last:border-b-0">
              <button type="button" className="flex w-full flex-col px-5 py-3.5 text-left transition-colors hover:bg-neutral-50 active:bg-neutral-100"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onFlyTo(item.lat, item.lng)}>
                <span className="text-[15px] font-semibold text-neutral-900">{item.primary || item.label}</span>
                {item.secondary ? <span className="mt-0.5 text-[13px] text-neutral-500">{item.secondary}</span> : null}
              </button>
            </li>
          ))}
      </ul>
    </div>
  )
}
