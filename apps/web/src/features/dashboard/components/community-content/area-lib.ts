import type { GeoJsonPolygon, LiveMapGeometry, LiveMapStreet } from "@/features/dashboard/api"
import { geoJsonToLines } from "@/features/dashboard/components/alerts-map/lib"

/** Minimal GeoJSON geometry shape used for turf's untyped outputs. */
interface GeoJsonGeometry {
  type: string
  coordinates: unknown
}

/** Buffer radius around street lines, in kilometers (~30 m). */
const CORRIDOR_RADIUS_KM = 0.03
/** Douglas-Peucker tolerance in degrees (~5 m) to keep polygons light. */
const CORRIDOR_SIMPLIFY_TOLERANCE = 0.00005

export interface AreaPickerValue {
  /** Street names the announcement affects. */
  streets: string[]
  /** GeoJSON Polygon (street corridor), or null when no area applies. */
  geometry: GeoJsonPolygon | null
  mode: "auto" | "manual"
}

export const emptyArea: AreaPickerValue = { streets: [], geometry: null, mode: "auto" }

export interface DrawnShape {
  id: string
  kind: "polygon" | "line"
  points: [number, number][]
}

export function shapeIsUsable(shape: DrawnShape): boolean {
  return shape.kind === "polygon" ? shape.points.length >= 3 : shape.points.length >= 2
}

/**
 * One GeoJSON Polygon for everything the user drew. Lines become ~30 m
 * corridors so a stroke still stores as an area, and overlapping shapes are
 * unioned. A MultiPolygon collapses to its largest member because the backend
 * and the previews expect a single ring.
 */
export async function shapesToPolygon(shapes: DrawnShape[]): Promise<GeoJsonPolygon | null> {
  const usable = shapes.filter(shapeIsUsable)
  if (usable.length === 0) return null

  try {
    const [bufferModule, unionModule, helpers] = await Promise.all([
      import("@turf/buffer"),
      import("@turf/union"),
      import("@turf/helpers"),
    ])
    const buffer = bufferModule.default ?? bufferModule.buffer
    const union = unionModule.default ?? unionModule.union
    const { lineString, polygon, featureCollection } = helpers

    const features: Array<{ geometry: GeoJsonGeometry }> = []
    for (const shape of usable) {
      if (shape.kind === "line") {
        const line = lineString(shape.points.map(([lat, lng]) => [lng, lat] as [number, number]))
        const buffered = buffer(line as never, CORRIDOR_RADIUS_KM, {
          units: "kilometers",
        }) as unknown as { geometry?: GeoJsonGeometry } | null
        if (buffered?.geometry) features.push({ geometry: buffered.geometry })
        continue
      }
      const ring = shape.points.map(([lat, lng]) => [lng, lat] as [number, number])
      const first = ring[0]
      if (!first) continue
      ring.push(first)
      const shaped = polygon([ring]) as unknown as { geometry?: GeoJsonGeometry }
      if (shaped.geometry) features.push({ geometry: shaped.geometry })
    }
    if (features.length === 0) return null

    let merged: GeoJsonGeometry | null = features[0]?.geometry ?? null
    for (let i = 1; i < features.length; i++) {
      if (!merged) break
      const result = union(
        featureCollection([
          { type: "Feature", properties: {}, geometry: merged },
          { type: "Feature", properties: {}, geometry: features[i]!.geometry },
        ] as never) as never,
      ) as unknown as { geometry?: GeoJsonGeometry } | null
      if (result?.geometry) merged = result.geometry
    }

    return largestRing(merged)
  } catch {
    return null
  }
}

/** Largest outer ring of a Polygon/MultiPolygon, as a plain GeoJSON Polygon. */
function largestRing(geometry: GeoJsonGeometry | null): GeoJsonPolygon | null {
  if (!geometry) return null
  let coordinates: number[][][] | null = null
  if (geometry.type === "Polygon") {
    coordinates = geometry.coordinates as number[][][]
  } else if (geometry.type === "MultiPolygon") {
    const parts = (geometry.coordinates as number[][][][]) ?? []
    let largest = parts[0] ?? null
    let largestArea = -1
    for (const part of parts) {
      const area = polygonRingArea(part[0] ?? [])
      if (area > largestArea) {
        largestArea = area
        largest = part
      }
    }
    coordinates = largest
  }
  const ring = coordinates?.[0]
  if (!ring || ring.length < 4) return null
  return {
    type: "Polygon",
    coordinates: [ring.map(([lng, lat]) => [lng, lat] as [number, number])],
  }
}

export function areaFromAnnouncement(
  affectedStreets: string[] | undefined,
  areaGeometry: GeoJsonPolygon | null | undefined,
): AreaPickerValue {
  return {
    streets: affectedStreets ?? [],
    geometry: areaGeometry ?? null,
    mode: areaGeometry ? "manual" : "auto",
  }
}

export function geoJsonToRing(geometry: GeoJsonPolygon | null): [number, number][] {
  if (!geometry?.coordinates?.length) return []
  const ring = geometry.coordinates[0] ?? []
  // Drop the closing point; Leaflet closes rings itself.
  const points = ring.map(([lng, lat]) => [lat, lng] as [number, number])
  if (
    points.length > 1 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1]
  ) {
    points.pop()
  }
  return points
}

/** All [lat, lng] vertices of one street's OSM geometries. */
export function streetPoints(street: LiveMapStreet): [number, number][] {
  return (street.geometries ?? []).flatMap((geometry) =>
    geoJsonToLines(geometry).flatMap((line) =>
      line.map((point) => [point[0], point[1]] as [number, number]),
    ),
  )
}

function allStreetLines(streets: LiveMapStreet[]): [number, number][][] {
  return (streets ?? []).flatMap((street) =>
    (street.geometries ?? []).flatMap((geometry: LiveMapGeometry) =>
      geoJsonToLines(geometry).map((line) =>
        line.map((point) => [point[0], point[1]] as [number, number]),
      ),
    ),
  )
}

/**
 * The affected-area polygon for the selected streets, computed as a narrow
 * corridor hugging the street lines instead of a convex blob that fills the
 * space between unrelated streets.
 *
 * Implementation: buffer every street LineString by ~30 m, union the buffers
 * into one shape, then Douglas-Peucker the outline so the geometry stays
 * light. Turf v7's `union` takes a FeatureCollection, so buffers are merged
 * pairwise. Returns null (streets stay highlighted, no invented shape) when
 * a single street is selected or the corridor cannot be computed.
 */
export async function streetCorridor(streets: LiveMapStreet[]): Promise<GeoJsonPolygon | null> {
  const lines = allStreetLines(streets)
  // A single street cannot form a polygon — the picker highlights the line
  // itself instead of wrapping it in a blob. Only two or more distinct
  // streets create a real area.
  if (streets.length < 2 || lines.length === 0) return null

  try {
    const [bufferModule, unionModule, simplifyModule, helpers] = await Promise.all([
      import("@turf/buffer"),
      import("@turf/union"),
      import("@turf/simplify"),
      import("@turf/helpers"),
    ])
    const buffer = bufferModule.default ?? bufferModule.buffer
    const union = unionModule.default ?? unionModule.union
    const simplify = simplifyModule.default ?? simplifyModule.simplify
    const { lineString, featureCollection } = helpers

    // Turf works in [lng, lat]; our lines are [lat, lng].
    const features = lines.map((line) =>
      lineString(line.map(([lat, lng]) => [lng, lat] as [number, number])),
    )
    // The turf v7 typings are strict (FeatureCollection vs Feature unions);
    // runtime behavior is what matters here, so treat the geometry as plain
    // GeoJSON and validate shapes manually below.
    const buffered = buffer(
      featureCollection(features) as never,
      CORRIDOR_RADIUS_KM,
      { units: "kilometers" },
    ) as unknown as { features?: Array<{ geometry: GeoJsonGeometry }> }
    if (!buffered?.features?.length) return null

    // Union all buffered features pairwise into one shape. Turf v7's union
    // takes a FeatureCollection, not two separate geometries.
    let merged = buffered.features[0]?.geometry ?? null
    for (let i = 1; i < buffered.features.length; i++) {
      if (!merged) break
      const result = union(
        featureCollection([
          { type: "Feature", properties: {}, geometry: merged },
          buffered.features[i]!,
        ] as never) as never,
      )
      if (result) merged = result.geometry ?? (result as unknown as GeoJsonGeometry)
    }

    // Normalize a MultiPolygon to its largest member — a single Polygon is
    // what the rest of the app (backend validator, previews) expects.
    // No convex-hull fallback: the user rejected invented blobs, so if the
    // corridor cannot be computed the streets simply stay highlighted.
    let polygon: { coordinates: number[][][] } | null = null
    if (merged?.type === "Polygon") {
      polygon = merged as { coordinates: number[][][] }
    } else if (merged?.type === "MultiPolygon") {
      const parts = (merged.coordinates as number[][][][]) ?? []
      let largest = parts[0] ?? null
      let largestArea = -1
      for (const part of parts) {
        const area = polygonRingArea(part[0] ?? [])
        if (area > largestArea) {
          largestArea = area
          largest = part
        }
      }
      if (largest) polygon = { coordinates: largest }
    }
    if (!polygon) return null

    const simplified = simplify(
      { type: "Feature", properties: {}, geometry: polygon } as never,
      { tolerance: CORRIDOR_SIMPLIFY_TOLERANCE, highQuality: true },
    ) as unknown as { geometry?: GeoJsonGeometry } | null
    const coords = ((simplified?.geometry?.coordinates ?? polygon.coordinates) as number[][][])
    if (!coords || coords.length === 0 || (coords[0] ?? []).length < 4) return null

    return {
      type: "Polygon",
      coordinates: [
        coords[0]!.map(([lng, lat]) => [lng, lat] as [number, number]),
      ],
    }
  } catch {
    return null
  }
}

/** Shoelace area in square degrees — only used to pick the largest hull part. */
function polygonRingArea(ring: number[][]): number {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i] ?? [0, 0]
    const [x2, y2] = ring[(i + 1) % ring.length] ?? [0, 0]
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area / 2)
}

/** Polygon centroid [lat, lng] via ring averaging — good enough for a marker. */
export function polygonCentroid(geometry: GeoJsonPolygon | null): [number, number] | null {
  const ring = geoJsonToRing(geometry)
  if (ring.length === 0) return null
  let lat = 0
  let lng = 0
  for (const [latPt, lngPt] of ring) {
    lat += latPt
    lng += lngPt
  }
  return [lat / ring.length, lng / ring.length]
}
