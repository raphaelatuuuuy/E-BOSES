import { useId, useMemo, useState } from "react"

import type { CommunityBoundary } from "./api"

const VIEW = 320
const PAD = 26
const GLOW = "#ff6a1a"
const IDLE_FILL = "#ff6a1a"
const IDLE_STROKE = "#ff8f4d"
const PEAK_FILL = "#ffd9b3"
const PEAK_STROKE = "#fff3e6"
const REPORT_COLOR = "#f2a03d"
const EMERGENCY_COLOR = "#f23b35"
const MAX_DOTS = 6

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

function pointInRing(point: Point, ring: Point[]) {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function mulberry32(seed: number) {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return hash
}

function scatterDots(ring: Point[], count: number, seed: number): Point[] {
  if (count <= 0) return []
  const rand = mulberry32(seed)
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const dots: Point[] = []
  let attempts = 0
  while (dots.length < count && attempts < count * 60) {
    attempts++
    const candidate: Point = [minX + rand() * (maxX - minX), minY + rand() * (maxY - minY)]
    if (pointInRing(candidate, ring)) dots.push(candidate)
  }
  return dots
}

interface Props {
  name: string
  geometry: CommunityBoundary["geometry"] | null
  reports: number
  emergencies: number
  loading?: boolean
}

export function BarangayBoundary({ name, geometry, reports, emergencies, loading = false }: Props) {
  const rawGlowId = useId().replace(/:/g, "")
  const glowId = `bb-glow-${rawGlowId}`
  const dotGlowId = `bb-dot-${rawGlowId}`
  const [hovered, setHovered] = useState(false)

  const shape = useMemo(() => (geometry ? project(geometry) : null), [geometry])

  const reportDots = useMemo(
    () => (shape ? scatterDots(shape.ring, Math.min(reports, MAX_DOTS), hashString(`${name}-reports`)) : []),
    [shape, reports, name],
  )
  const emergencyDots = useMemo(
    () => (shape ? scatterDots(shape.ring, Math.min(emergencies, MAX_DOTS), hashString(`${name}-emergencies`)) : []),
    [shape, emergencies, name],
  )

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
          <filter id={dotGlowId} filterUnits="userSpaceOnUse" x="-16" y="-16" width="32" height="32">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d={shape.d}
          fill={hovered ? PEAK_FILL : GLOW}
          filter={`url(#${glowId})`}
          pointerEvents="none"
          style={{ opacity: hovered ? 1 : 0.6, transition: "opacity 320ms ease, fill 320ms ease" }}
        />
        <path
          d={shape.d}
          tabIndex={0}
          role="button"
          aria-label={`${name} boundary`}
          className="cursor-pointer outline-none"
          vectorEffect="non-scaling-stroke"
          style={{
            fill: hovered ? PEAK_FILL : IDLE_FILL,
            stroke: hovered ? PEAK_STROKE : IDLE_STROKE,
            strokeWidth: 0.6,
            strokeLinejoin: "round",
            transition: "fill 260ms ease, stroke 260ms ease",
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
        />

        <g style={{ opacity: hovered ? 1 : 0, transition: "opacity 320ms ease" }} pointerEvents="none">
          {reportDots.map(([x, y], i) => (
            <circle key={`report-${i}`} cx={x} cy={y} r={3.2} fill={REPORT_COLOR} filter={`url(#${dotGlowId})`} />
          ))}
          {emergencyDots.map(([x, y], i) => (
            <circle key={`emergency-${i}`} cx={x} cy={y} r={3.2} fill={EMERGENCY_COLOR} filter={`url(#${dotGlowId})`} />
          ))}
        </g>
      </svg>

      <div className="mt-4 flex items-center justify-center gap-5 text-xs text-landing-cream/60">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: REPORT_COLOR, boxShadow: `0 0 6px ${REPORT_COLOR}` }}
          />
          {numberLabel(reports, "report")}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: EMERGENCY_COLOR, boxShadow: `0 0 6px ${EMERGENCY_COLOR}` }}
          />
          {numberLabel(emergencies, "emergency", "emergencies")}
        </span>
      </div>
    </div>
  )
}

function numberLabel(value: number, singular: string, plural?: string) {
  const word = value === 1 ? singular : (plural ?? `${singular}s`)
  return `${value} ${word}`
}
