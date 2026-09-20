import { promises as fs, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { zxyToTileId } from "../node_modules/pmtiles/dist/esm/index.js"
import { PMTiles } from "../node_modules/pmtiles/dist/esm/index.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const outPath = path.resolve(
  root,
  "apps/web/offline-source/marikina-heights.pmtiles"
)

const BOUNDS = {
  minLat: 14.6441 - 0.012,
  maxLat: 14.6599 + 0.012,
  minLng: 121.1104 - 0.012,
  maxLng: 121.1305 + 0.012,
}
const MIN_ZOOM = 10
const MAX_ZOOM = 16
const TILE_SIZE_LIMIT = 400
const CONCURRENCY = 4
const TILE_TYPE_PNG = 2
const COMPRESSION_NONE = 1

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

function readEnvKey(name) {
  try {
    const text = readFileSync(path.resolve(root, ".env"), "utf8")
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const index = trimmed.indexOf("=")
      if (index < 0) continue
      if (trimmed.slice(0, index).trim() !== name) continue
      return trimmed
        .slice(index + 1)
        .trim()
        .replace(/^["']|["']$/g, "")
    }
  } catch {
    return ""
  }
  return ""
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
        tiles.push({ zoom, x, y, id: zxyToTileId(zoom, x, y) })
      }
    }
  }
  tiles.sort((a, b) => a.id - b.id)
  return tiles
}

async function downloadTile(tile, key, subdomain) {
  const base = `https://${subdomain}.basemaps.cartocdn.com/light_all/${tile.zoom}/${tile.x}/${tile.y}.png`
  const url = key ? `${base}?key=${encodeURIComponent(key)}` : base
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "E-Boses offline map builder" },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const type = response.headers.get("content-type") || ""
      if (!type.includes("png")) throw new Error(`unexpected ${type}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length) throw new Error("empty tile")
      return buffer
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw lastError
}

async function downloadAll(tiles, key) {
  const subdomains = ["a", "b", "c", "d"]
  const results = new Array(tiles.length)
  let next = 0
  let done = 0
  const run = async () => {
    while (next < tiles.length) {
      const index = next++
      const tile = tiles[index]
      results[index] = await downloadTile(
        tile,
        key,
        subdomains[index % subdomains.length]
      )
      done++
      if (done % 20 === 0 || done === tiles.length) {
        console.log(`downloaded ${done}/${tiles.length}`)
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, tiles.length) }, run)
  )
  return results
}

function writeVarint(value, out) {
  let rest = BigInt(value)
  while (rest >= 0x80n) {
    out.push(Number(rest & 0x7fn) | 0x80)
    rest >>= 7n
  }
  out.push(Number(rest))
}

function serializeDirectory(entries) {
  const out = []
  writeVarint(entries.length, out)
  let previous = 0n
  for (const entry of entries) {
    const id = BigInt(entry.tileId)
    writeVarint(id - previous, out)
    previous = id
  }
  for (const entry of entries) writeVarint(entry.runLength, out)
  for (const entry of entries) writeVarint(entry.length, out)
  entries.forEach((entry, index) => {
    if (index > 0) {
      const previousEntry = entries[index - 1]
      if (
        BigInt(entry.offset) ===
        BigInt(previousEntry.offset) + BigInt(previousEntry.length)
      ) {
        writeVarint(0, out)
        return
      }
    }
    writeVarint(BigInt(entry.offset) + 1n, out)
  })
  return Buffer.from(out)
}

function buildArchive(tiles, buffers) {
  const entries = tiles.map((tile, index) => ({
    tileId: tile.id,
    runLength: 1,
    length: buffers[index].length,
    offset: 0,
  }))
  let cursor = 0
  for (const entry of entries) {
    entry.offset = cursor
    cursor += entry.length
  }
  const directory = serializeDirectory(entries)
  const metadata = Buffer.from(
    JSON.stringify({
      name: "Marikina Heights offline",
      format: "png",
      minzoom: MIN_ZOOM,
      maxzoom: MAX_ZOOM,
      bounds: [BOUNDS.minLng, BOUNDS.minLat, BOUNDS.maxLng, BOUNDS.maxLat],
      center: [121.1133, 14.6507, 15],
    }),
    "utf8"
  )
  const header = Buffer.alloc(127)
  header.write("PMTiles", 0, "ascii")
  header.writeUInt8(3, 7)
  const view = new DataView(header.buffer, header.byteOffset, header.length)
  const rootOffset = 127
  const metadataOffset = rootOffset + directory.length
  const tileOffset = metadataOffset + metadata.length
  view.setBigUint64(8, BigInt(rootOffset), true)
  view.setBigUint64(16, BigInt(directory.length), true)
  view.setBigUint64(24, BigInt(metadataOffset), true)
  view.setBigUint64(32, BigInt(metadata.length), true)
  view.setBigUint64(40, 0n, true)
  view.setBigUint64(48, 0n, true)
  view.setBigUint64(56, BigInt(tileOffset), true)
  view.setBigUint64(64, BigInt(cursor), true)
  view.setBigUint64(72, BigInt(entries.length), true)
  view.setBigUint64(80, BigInt(entries.length), true)
  view.setBigUint64(88, BigInt(entries.length), true)
  view.setUint8(96, 1)
  view.setUint8(97, COMPRESSION_NONE)
  view.setUint8(98, COMPRESSION_NONE)
  view.setUint8(99, TILE_TYPE_PNG)
  view.setUint8(100, MIN_ZOOM)
  view.setUint8(101, MAX_ZOOM)
  view.setInt32(102, Math.round(BOUNDS.minLng * 1e7), true)
  view.setInt32(106, Math.round(BOUNDS.minLat * 1e7), true)
  view.setInt32(110, Math.round(BOUNDS.maxLng * 1e7), true)
  view.setInt32(114, Math.round(BOUNDS.maxLat * 1e7), true)
  view.setUint8(118, 15)
  view.setInt32(119, Math.round(121.1133 * 1e7), true)
  view.setInt32(123, Math.round(14.6507 * 1e7), true)
  return { header, directory, metadata, entries, blob: Buffer.concat(buffers) }
}

function exactBytes(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length)
}

async function verify(outFile, tiles, buffers) {
  const file = await fs.readFile(outFile)
  const source = {
    getKey: () => "verify",
    getBytes: async (offset, length) => ({
      data: exactBytes(Buffer.from(file.subarray(offset, offset + length))),
    }),
  }
  const archive = new PMTiles(source)
  const header = await archive.getHeader()
  if (header.specVersion !== 3) throw new Error("bad spec version")
  if (header.tileType !== TILE_TYPE_PNG) throw new Error("bad tile type")
  if (header.tileCompression !== COMPRESSION_NONE)
    throw new Error("bad compression")
  if (header.minZoom !== MIN_ZOOM || header.maxZoom !== MAX_ZOOM)
    throw new Error("bad zoom range")
  if (header.numTileEntries !== tiles.length) throw new Error("bad entry count")
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index]
    const result = await archive.getZxy(tile.zoom, tile.x, tile.y)
    if (!result) throw new Error(`missing ${tile.zoom}/${tile.x}/${tile.y}`)
    if (!Buffer.from(result.data).equals(buffers[index])) {
      throw new Error(`corrupt ${tile.zoom}/${tile.x}/${tile.y}`)
    }
  }
  const outside = await archive.getZxy(
    MAX_ZOOM,
    2 ** MAX_ZOOM - 1,
    2 ** MAX_ZOOM - 1
  )
  if (outside) throw new Error("unexpected tile outside coverage")
  const metadata = await archive.getMetadata()
  if (metadata.format !== "png") throw new Error("bad metadata")
  console.log(
    `verified ${tiles.length} tiles through the official reader, ${(await fs.stat(outFile)).size} bytes`
  )
}

const tiles = tileList()
if (tiles.length > TILE_SIZE_LIMIT) {
  throw new Error(`tile count ${tiles.length} exceeds limit`)
}
console.log(`tiles to fetch: ${tiles.length}, zooms ${MIN_ZOOM}-${MAX_ZOOM}`)
const key = process.env.VITE_CARTO_BASEMAP_KEY || readEnvKey("VITE_CARTO_BASEMAP_KEY")
const buffers = await downloadAll(tiles, key)
const { header, directory, metadata, blob } = buildArchive(tiles, buffers)
await fs.mkdir(path.dirname(outPath), { recursive: true })
await fs.writeFile(outPath, Buffer.concat([header, directory, metadata, blob]))
await verify(outPath, tiles, buffers)
console.log(`wrote ${outPath}`)
