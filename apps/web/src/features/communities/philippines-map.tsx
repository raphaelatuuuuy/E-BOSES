import { useId, useMemo, useRef, useState, type MouseEvent } from "react"

import { PH_REGIONS, PH_VIEWBOX } from "./ph-regions"

export interface RegionFigures {
  communities: number
  residents: number
  reports: number
  emergencies: number
}

const EMPTY_FILL = "rgba(255,255,255,0.05)"
const EMPTY_STROKE = "rgba(255,255,255,0.14)"
const GLOW = "#ff6a1a"

const ORANGE_SCALE = [
  "#5c2a12",
  "#7a3714",
  "#9c4718",
  "#c2591c",
  "#ff6a1a",
  "#ff8f4d",
  "#ffb47f",
  "#ffd9b3",
]

const PEAK_FILL = ORANGE_SCALE[ORANGE_SCALE.length - 1]

interface Props {
  figures: Record<string, RegionFigures>
  loading?: boolean
}

export function PhilippinesMap({ figures, loading = false }: Props) {
  const [active, setActive] = useState<string | null>(null)
  const [glowPath, setGlowPath] = useState("")
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const frame = useRef<HTMLDivElement | null>(null)
  const glowId = `ph-glow-${useId().replace(/:/g, "")}`

  const peak = Math.max(1, ...Object.values(figures).map((item) => item.residents + item.reports))

  const rows = useMemo(() => {
    return PH_REGIONS.map((region) => {
      const key = [region.name, ...region.aliases, region.code].find((name) => figures[name])
      const data = key ? figures[key] : undefined
      const value = data ? data.residents + data.reports : 0
      const step = data
        ? Math.max(1, Math.round((value / peak) * (ORANGE_SCALE.length - 1)))
        : -1
      return { region, data, step }
    })
  }, [figures, peak])

  const activeRow = rows.find((row) => row.region.name === active)
  const activeFigures = activeRow?.data

  const coveredGlowPath = useMemo(
    () => rows.filter((row) => row.step >= 0).map((row) => row.region.d).join(" "),
    [rows],
  )

  function enter(name: string, d: string) {
    setActive(name)
    setGlowPath(d)
  }

  function leave(name: string) {
    setActive((current) => (current === name ? null : current))
  }

  function track(event: MouseEvent<HTMLDivElement>) {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    setPointer({ x: event.clientX - box.left, y: event.clientY - box.top })
  }

  return (
    <div className="relative">
      <div
        ref={frame}
        className="relative"
        onMouseMove={track}
        onMouseLeave={() => setPointer(null)}
      >
        <svg
          viewBox={PH_VIEWBOX}
          role="group"
          aria-label="Philippine regions covered by E-Boses"
          className="mx-auto block h-auto w-full max-w-[20rem]"
          style={{ opacity: loading ? 0.5 : 1, transition: "opacity 300ms ease" }}
        >
          <defs>
            <filter
              id={glowId}
              filterUnits="userSpaceOnUse"
              x="-80"
              y="-80"
              width="920"
              height="1424"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="halo" />
              <feFlood floodColor={GLOW} floodOpacity="0.85" result="tint" />
              <feComposite in="tint" in2="halo" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="glow" />
              </feMerge>
            </filter>
          </defs>

          <path
            d={coveredGlowPath}
            fill={PEAK_FILL}
            filter={`url(#${glowId})`}
            pointerEvents="none"
            aria-hidden
            style={{ opacity: 0.4 }}
          />

          <path
            d={glowPath}
            fill={PEAK_FILL}
            filter={`url(#${glowId})`}
            pointerEvents="none"
            style={{ opacity: active ? 1 : 0, transition: "opacity 320ms ease" }}
          />

          {rows.map(({ region, data, step }) => {
            const on = active === region.name
            const fill = on ? PEAK_FILL : step < 0 ? EMPTY_FILL : ORANGE_SCALE[step]
            const stroke = on
              ? "#fff3e6"
              : step < 0
                ? EMPTY_STROKE
                : (ORANGE_SCALE[step + 1] ?? PEAK_FILL)
            return (
              <path
                key={region.code}
                d={region.d}
                tabIndex={0}
                role="button"
                aria-label={
                  data
                    ? `${region.name}: ${data.communities} communities, ${data.residents} residents`
                    : `${region.name}: no data available`
                }
                className="cursor-pointer outline-none"
                vectorEffect="non-scaling-stroke"
                style={{
                  fill,
                  stroke,
                  strokeWidth: 0.6,
                  strokeLinejoin: "round",
                  transition: "fill 260ms ease, stroke 260ms ease",
                }}
                onMouseEnter={() => enter(region.name, region.d)}
                onMouseLeave={() => leave(region.name)}
                onFocus={() => enter(region.name, region.d)}
                onBlur={() => leave(region.name)}
              />
            )
          })}
        </svg>

        {active && pointer ? (
          <div
            aria-hidden
            className="pointer-events-none absolute z-10 w-max max-w-[15rem] rounded-xl border border-white/12 bg-black/85 px-3 py-2 shadow-xl backdrop-blur-sm"
            style={{
              left: Math.max(pointer.x + 14, 8),
              top: Math.max(pointer.y - 12, 8),
            }}
          >
            <p className="text-xs font-semibold text-white">{active}</p>
            {activeFigures ? (
              <ul className="mt-1 space-y-0.5 text-[11px] text-white/65">
                <li>{activeFigures.communities} communities</li>
                <li>{activeFigures.residents} residents</li>
                <li>{activeFigures.reports} reports</li>
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-white/45">No data available</p>
            )}
          </div>
        ) : null}
      </div>

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none mt-4 min-h-[104px] px-1 py-3"
      >
        <p className="truncate text-sm font-medium text-landing-cream">
          {active ?? "Hover a region"}
        </p>
        {active && !activeFigures ? (
          <p className="mt-1 text-xs text-landing-cream/50">No data available</p>
        ) : null}
        {activeFigures ? (
          <dl className="mt-2 grid grid-cols-3 gap-3 text-xs">
            <div>
              <dt className="text-landing-cream/50">Communities</dt>
              <dd className="mt-0.5 text-base font-semibold text-landing-cream">{activeFigures.communities}</dd>
            </div>
            <div>
              <dt className="text-landing-cream/50">Residents</dt>
              <dd className="mt-0.5 text-base font-semibold text-landing-cream">{activeFigures.residents}</dd>
            </div>
            <div>
              <dt className="text-landing-cream/50">Reports</dt>
              <dd className="mt-0.5 text-base font-semibold text-landing-cream">{activeFigures.reports}</dd>
            </div>
          </dl>
        ) : null}
        {!active ? (
          <p className="mt-1 text-xs text-landing-cream/50">
            Filled regions are covered by E-Boses today.
          </p>
        ) : null}
      </div>
    </div>
  )
}
