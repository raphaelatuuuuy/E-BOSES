import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const cliDist = process.argv[2]
const dist = path.resolve(here, "..", "apps", "web", cliDist ?? "dist")
const swPath = path.join(dist, "eboses-sw.js")
const token = "self.__EBOSES_PRECACHE = []"

/**
 * What a completely offline launch needs baked into the service-worker cache.
 *
 * The whole built bundle goes in, not just the Leaflet chunk: a cold start with
 * no network cannot fetch a chunk that was never cached, and the SOS screen sits
 * behind several of them. Marketing imagery under `/contents` and the
 * decorative font families are deliberately left out — megabytes no offline
 * flow reads. They are still cached on demand the first time they are used.
 */
const targets = [
  {
    folder: "assets",
    route: "/assets",
    accept: () => true,
    required: true,
  },
  {
    folder: "tiles",
    route: "/tiles",
    accept: (name) => name.endsWith(".png"),
    required: true,
  },
  {
    folder: "icons",
    route: "/icons",
    accept: () => true,
    required: false,
  },
  {
    folder: "fonts",
    route: "/fonts",
    accept: (name) => name.endsWith(".woff2"),
    required: false,
  },
]

const hits = []
let bytes = 0

async function collect(dir, route, accept) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collect(full, `${route}/${entry.name}`, accept)
      continue
    }
    if (!accept(entry.name)) continue
    hits.push(`${route}/${entry.name}`)
    bytes += (await fs.stat(full)).size
  }
}

for (const target of targets) {
  const before = hits.length
  try {
    await collect(path.join(dist, target.folder), target.route, target.accept)
  } catch {
    // Missing optional folders simply contribute nothing.
  }
  if (target.required && hits.length === before) {
    throw new Error(
      `nothing to precache from ${target.folder}/ — build the web app first`
    )
  }
}

hits.sort()
if (!hits.length) throw new Error("nothing to precache")
const sw = await fs.readFile(swPath, "utf8")
if (!sw.includes(token)) throw new Error("precache placeholder missing in eboses-sw.js")
await fs.writeFile(swPath, sw.replace(token, `self.__EBOSES_PRECACHE = ${JSON.stringify(hits)}`))
console.log(
  `precached ${hits.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB)`
)
