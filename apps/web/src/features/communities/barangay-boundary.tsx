import { useId, useMemo } from "react"

import type { CommunityBoundary } from "./api"

const VIEW = 320
const PAD = 26
const GLOW = "#ff6a1a"
const PEAK_FILL = "#ffd9b3"
const PEAK_STROKE = "#fff3e6"


type Point = [number, number]

interface Shape {
  d: string
  ring: Point[]
}

function project(geometry: CommunityBoundary["geometry"]): Shape | null {
  const outer = geometry?.coordinates?.[0]
  if (!outer || outer.length < 3) return null

  const raw = outer[0][0] === outer[outer.length - 1][0] && outer[0][1] === outer[outer.length - 1][1]
    ? outer.slice(0, -1)
    : outer

  const lats = raw.map((p) => p[1])
  const lngs = raw.map((p) => p[0])
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const cos = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180)) || 1

  const spanLat = maxLat - minLat || 1
  const spanLng = (maxLng - minLng) * cos || 1
  const available = VIEW - PAD * 2
  const scale = available / Math.max(spanLat, spanLng)
  const width = spanLng * scale
  const height = spanLat * scale
  const offsetX = (VIEW - width) / 2
  const offsetY = (VIEW - height) / 2

  const ring: Point[] = raw.map(([lng, lat]) => [
    (lng - minLng) * cos * scale + offsetX,
    VIEW - ((lat - minLat) * scale + offsetY),
  ])

  const d = ring.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") + " Z"
  return { d, ring }
}

interface Props {
  name: string
  geometry: CommunityBoundary["geometry"] | null
  loading?: boolean
}

export function BarangayBoundary({ name, geometry, loading = false }: Props) {
  const rawGlowId = useId().replace(/:/g, "")
  const glowId = `bb-glow-${rawGlowId}`

  const shape = useMemo(() => (geometry ? project(geometry) : null), [geometry])

  if (loading || !shape) {
    return (
      <div className="mx-auto flex h-64 w-64 max-w-full items-center justify-center">
        <div className="size-48 animate-pulse rounded-full bg-white/5" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[18rem]">
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label={`${name} boundary`} className="mx-auto block h-auto w-full">
        <defs>
          <filter
            id={glowId}
            filterUnits="userSpaceOnUse"
            x={-80}
            y={-80}
            width={VIEW + 160}
            height={VIEW + 160}
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
          d={shape.d}
          fill={PEAK_FILL}
          filter={`url(#${glowId})`}
          pointerEvents="none"
          aria-hidden
        />
        <path
          d={shape.d}
          aria-label={`${name} boundary`}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
          style={{
            fill: PEAK_FILL,
            stroke: PEAK_STROKE,
            strokeWidth: 0.6,
            strokeLinejoin: "round",
          }}
        />


      </svg>


    </div>
  )
}


