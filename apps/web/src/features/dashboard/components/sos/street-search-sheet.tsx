"use client"

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { toast } from "sonner"
import {
  CircleCheck,
  HomeIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import { searchRegistrationStreets } from "@/features/auth/api"
import { apiRequest } from "@/lib/api"

export type SosStreetOption = {
  name: string
  lat: number
  lng: number
}

function haversineMeters(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const earth = 6371000
  const dLat = toRad(latB - latA)
  const dLng = toRad(lngB - lngA)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(latA)) *
      Math.cos(toRad(latB)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  return 2 * earth * Math.asin(Math.sqrt(a))
}

const MIN_H_DVH = 38
const START_H_DVH = 62
const MAX_H_DVH = 90
const CLOSE_THRESHOLD_DVH = 30

/**
 * Draggable street directory sheet shared by the online + offline SOS maps.
 * Alert-maps search row format (filter button then search input), no X icon.
 */
export function SosStreetSearchSheet({
  streets,
  pinLat,
  pinLng,
  onSelect,
  onGoHome,
  onClose,
}: {
  streets: SosStreetOption[]
  pinLat?: number | null
  pinLng?: number | null
  onSelect: (street: SosStreetOption) => void
  onGoHome: (lat: number, lng: number) => void
  onClose: () => void
}) {
  const { user } = useAuthSession()
  const homeLat = (() => {
    const raw = user?.home_latitude
    const num = typeof raw === "string" ? Number(raw) : raw
    return typeof num === "number" && Number.isFinite(num) ? num : null
  })()
  const homeLng = (() => {
    const raw = user?.home_longitude
    const num = typeof raw === "string" ? Number(raw) : raw
    return typeof num === "number" && Number.isFinite(num) ? num : null
  })()
  const hasHome = homeLat != null && homeLng != null
  const homeAddressText = user?.address?.trim() || ""
  // Older accounts predate saved home coordinates — their address text can
  // still be resolved through search, so the row works for every user.
  const canGoHome = hasHome || homeAddressText.length > 0
  const [resolvingHome, setResolvingHome] = useState(false)

  async function goHome() {
    if (homeLat != null && homeLng != null) {
      setFilterOpen(false)
      onGoHome(homeLat, homeLng)
      return
    }
    if (!homeAddressText || resolvingHome) return
    setResolvingHome(true)
    try {
      const registered = await searchRegistrationStreets(
        homeAddressText,
        1
      ).catch(() => null)
      const firstRegistered = registered?.results?.[0]
      if (
        firstRegistered &&
        Number.isFinite(firstRegistered.latitude) &&
        Number.isFinite(firstRegistered.longitude)
      ) {
        setFilterOpen(false)
        onGoHome(firstRegistered.latitude, firstRegistered.longitude)
        return
      }
      const searched = await apiRequest<{
        results: { lat: number; lng: number }[]
      }>(`/locations/search/?q=${encodeURIComponent(homeAddressText)}`).catch(
        () => null
      )
      const first = searched?.results?.[0]
      if (
        first &&
        Number.isFinite(first.lat) &&
        Number.isFinite(first.lng)
      ) {
        setFilterOpen(false)
        onGoHome(first.lat, first.lng)
        return
      }
      toast.error("Couldn't find your home address on the map.")
    } finally {
      setResolvingHome(false)
    }
  }
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortMode, setSortMode] = useState<"alpha" | "nearest">("alpha")
  const [heightDvh, setHeightDvh] = useState(START_H_DVH)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const hasPin = pinLat != null && pinLng != null

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q
      ? streets.filter((street) => street.name.toLowerCase().includes(q))
      : [...streets]
    if (sortMode === "nearest" && hasPin && pinLat != null && pinLng != null) {
      return matched.sort(
        (a, b) =>
          haversineMeters(pinLat, pinLng, a.lat, a.lng) -
          haversineMeters(pinLat, pinLng, b.lat, b.lng)
      )
    }
    return matched.sort((a, b) => a.name.localeCompare(b.name))
  }, [streets, query, sortMode, hasPin, pinLat, pinLng])

  function beginDrag(clientY: number) {
    dragRef.current = { startY: clientY, startH: heightDvh }
    setDragging(true)
  }

  function onHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button,input")) return
    beginDrag(e.clientY)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onHandlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || !dragging) return
    const vh = window.innerHeight || 800
    const deltaDvh = ((drag.startY - e.clientY) / vh) * 100
    setHeightDvh(
      Math.min(MAX_H_DVH, Math.max(MIN_H_DVH - 12, drag.startH + deltaDvh))
    )
  }

  function onHandlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return
    setDragging(false)
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    setHeightDvh((current) => {
      if (current < CLOSE_THRESHOLD_DVH) {
        window.requestAnimationFrame(onClose)
        return START_H_DVH
      }
      return Math.min(MAX_H_DVH, Math.max(MIN_H_DVH, current))
    })
  }

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-[28px] border-t border-neutral-200 bg-white shadow-[0_-8px_28px_rgba(0,0,0,0.18)]"
      style={{ height: `${heightDvh}dvh` }}
    >
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        className="shrink-0 cursor-grab touch-none px-5 pt-2.5 pb-1 active:cursor-grabbing"
      >
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-neutral-300" />
      </div>

      <div className="relative shrink-0 px-4 pt-1 pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterOpen((open) => !open)}
            aria-label={filterOpen ? "Hide filters" : "Show filters"}
            aria-expanded={filterOpen}
            aria-pressed={filterOpen}
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-full transition-colors",
              filterOpen
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
            )}
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search streets in Marikina Heights"
              aria-label="Search streets in Marikina Heights"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400"
            />
          </label>
        </div>
        {filterOpen ? (
          <>
            <button
              type="button"
              aria-label="Close filters"
              onClick={() => setFilterOpen(false)}
              className="fixed inset-0 z-40 cursor-default bg-transparent"
            />
            <div
              role="listbox"
              aria-label="Street options"
              className="absolute top-full right-4 left-4 z-50 mt-2 overflow-hidden rounded-[20px] bg-white p-1.5 shadow-lg ring-1 ring-neutral-200"
            >
              <button
                type="button"
                role="option"
                aria-selected={sortMode === "alpha"}
                onClick={() => {
                  setSortMode("alpha")
                  setFilterOpen(false)
                }}
                className="flex w-full items-center gap-3 rounded-[12px] px-4 py-2.5 text-left transition hover:bg-neutral-50"
              >
                <span className="min-w-0 flex-1 text-[15px] font-medium text-neutral-900">
                  Name (A–Z)
                </span>
                {sortMode === "alpha" ? (
                  <CircleCheck
                    className="size-4 shrink-0 text-green-600"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
              <button
                type="button"
                role="option"
                aria-selected={sortMode === "nearest"}
                onClick={() => {
                  setSortMode("nearest")
                  setFilterOpen(false)
                }}
                className="flex w-full items-center gap-3 rounded-[12px] px-4 py-2.5 text-left transition hover:bg-neutral-50"
              >
                <span className="min-w-0 flex-1 text-[15px] font-medium text-neutral-900">
                  {hasPin ? "Nearest first" : "Nearest first (move the map)"}
                </span>
                {sortMode === "nearest" ? (
                  <CircleCheck
                    className="size-4 shrink-0 text-green-600"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
              <button
                type="button"
                role="option"
                aria-selected={false}
                disabled={!canGoHome || resolvingHome}
                onClick={() => void goHome()}
                className="flex w-full items-center gap-3 rounded-[12px] px-4 py-2.5 text-left transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1 text-[15px] font-medium text-neutral-900">
                  {resolvingHome
                    ? "Finding your home…"
                    : canGoHome
                      ? "Home address"
                      : "Home address (not saved)"}
                </span>
                <HomeIcon
                  className="size-4 shrink-0 text-neutral-400"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </button>
            </div>
          </>
        ) : null}
      </div>

      <ul className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {visible.length === 0 ? (
          <li className="px-5 py-4 text-center text-[14px] text-neutral-500">
            No streets found
          </li>
        ) : (
          visible.map((street) => (
            <li
              key={street.name.toLowerCase()}
              className="border-b border-neutral-100 last:border-b-0"
            >
              <button
                type="button"
                onClick={() => onSelect(street)}
                className="flex w-full flex-col px-3 py-3 text-left transition-colors hover:bg-neutral-50 active:bg-neutral-100"
              >
                <span className="text-[15px] font-semibold text-neutral-900">
                  {street.name}
                </span>
                <span className="mt-0.5 text-[13px] text-neutral-500">
                  Marikina Heights
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
