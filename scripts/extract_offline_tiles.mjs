import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PMTiles } from "../node_modules/pmtiles/dist/esm/index.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const archivePath = path.resolve(
  root,
  "apps/web/offline-source/marikina-heights.pmtiles"
)
const outDir = path.resolve(root, "apps/web/public/tiles")

const BOUNDS = {
  minLat: 14.6441 - 0.012,
  maxLat: 14.6599 + 0.012,
  minLng: 121.1104 - 0.012,
  maxLng: 121.1305 + 0.012,
}
const MIN_ZOOM = 10
const MAX_ZOOM = 16

function lonToX(lng, zoom) {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom)
}

function latToY(lat, zoom) {
  const radians = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) *
      2 ** zoom
  )
}

function tileList() {
  const tiles = []
  for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom++) {
    const max = 2 ** zoom - 1
    const minX = Math.max(0, lonToX(BOUNDS.minLng, zoom))
    const maxX = Math.min(max, lonToX(BOUNDS.maxLng, zoom))
    const minY = Math.max(0, latToY(BOUNDS.maxLat, zoom))
    const maxY = Math.min(max, latToY(BOUNDS.minLat, zoom))
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        tiles.push({ zoom, x, y })
      }
    }
  }
  return tiles
}

const raw = await fs.readFile(archivePath)
const source = {
  getKey: () => "extract",
  getBytes: async (offset, length) => ({
    data: raw.buffer.slice(
      raw.byteOffset + offset,
      raw.byteOffset + offset + length
    ),
  }),
}
const archive = new PMTiles(source)
const header = await archive.getHeader()
if (header.tileType !== 2) throw new Error("archive is not PNG tiles")

const tiles = tileList()
let written = 0
for (const tile of tiles) {
  const result = await archive.getZxy(tile.zoom, tile.x, tile.y)
  if (!result?.data) throw new Error(`missing ${tile.zoom}/${tile.x}/${tile.y}`)
  const dir = path.join(outDir, String(tile.zoom), String(tile.x))
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, `${tile.y}.png`),
    Buffer.from(result.data)
  )
  written++
}
console.log(`extracted ${written} tiles to ${outDir}`)
