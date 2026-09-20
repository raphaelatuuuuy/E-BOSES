import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const outPath = path.resolve(
  root,
  "apps/web/src/features/dashboard/components/sos/offline-streets.generated.ts"
)

const SOUTH = 14.635
const NORTH = 14.666
const WEST = 121.097
const EAST = 121.129
const MIN_SPACING_METERS = 8
const MAX_WAYS = 2000
const MAX_POINTS_PER_WAY = 40
const SKIP_HIGHWAY = new Set(["proposed", "construction"])

const QUERY = `[out:json][timeout:60];way["highway"]["name"](${SOUTH},${WEST},${NORTH},${EAST});out geom;`

function metersBetween(latA, lngA, latB, lngB) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const earth = 6371000
  const dLat = toRad(latB - latA)
  const dLng = toRad(lngB - lngA)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) *
      Math.cos(toRad(latB)) *
      Math.sin(dLng / 2) ** 2
  return 2 * earth * Math.asin(Math.sqrt(a))
}

function decimate(points) {
  if (points.length <= 2) return points
  const kept = [points[0]]
  for (let index = 1; index < points.length - 1; index += 1) {
    const last = kept[kept.length - 1]
    const next = points[index]
    if (metersBetween(last[0], last[1], next[0], next[1]) >= MIN_SPACING_METERS)
      kept.push(next)
  }
  kept.push(points[points.length - 1])
  return kept
}

const round5 = (value) => Math.round(value * 100000) / 100000

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
]

async function fetchWays() {
  let lastError = new Error("no Overpass mirror reachable")
  for (const endpoint of MIRRORS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "E-Boses offline street builder",
        },
        body: `data=${encodeURIComponent(QUERY)}`,
      })
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`)
      const payload = await response.json()
      const elements = Array.isArray(payload?.elements) ? payload.elements : []
      if (elements.length) return elements
      lastError = new Error("Overpass returned no ways")
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

const elements = await fetchWays()
const streets = []
for (const element of elements) {
  if (element?.type !== "way") continue
  const name = (element.tags?.name ?? "").trim()
  const highway = (element.tags?.highway ?? "").trim()
  if (!name || SKIP_HIGHWAY.has(highway)) continue
  const geometry = Array.isArray(element.geometry) ? element.geometry : []
  const points = geometry
    .filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon))
    .map((point) => [round5(point.lat), round5(point.lon)])
  if (points.length < 2) continue
  streets.push({ name, points: decimate(points).slice(0, MAX_POINTS_PER_WAY) })
  if (streets.length >= MAX_WAYS) break
}

const body =
  `export type GeneratedOfflineStreet = {\n` +
  `  name: string\n` +
  `  points: Array<[number, number]>\n` +
  `}\n\n` +
  `export const GENERATED_OFFLINE_STREETS: GeneratedOfflineStreet[] = ${JSON.stringify(streets)}\n`

await fs.writeFile(outPath, body)
const pointCount = streets.reduce((total, street) => total + street.points.length, 0)
console.log(`wrote ${streets.length} streets, ${pointCount} points -> ${outPath}`)
