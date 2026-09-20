const API_MEDIA_PATHS = [
  /^\/api\/.+\/(preview|raw)\/?$/,
  /^\/api\/.+\/resolution-evidence\/.+/,
  /^\/media\//,
]

function rebaseApiMediaUrl(src: string, origin: string) {
  if (!origin) return src
  let parsed: URL
  try {
    parsed = new URL(src)
  } catch {
    return src
  }
  if (!API_MEDIA_PATHS.some((pattern) => pattern.test(parsed.pathname)))
    return src
  let base: URL
  try {
    base = new URL(origin)
  } catch {
    return src
  }
  if (parsed.host === base.host && parsed.protocol === base.protocol)
    return src
  return `${base.origin}${parsed.pathname}${parsed.search}`
}

export function resolveMediaUrl(src: string, origin: string) {
  if (!src.startsWith("/") || src.startsWith("//"))
    return rebaseApiMediaUrl(src, origin)
  return `${origin.replace(/\/$/, "")}${src}`
}
