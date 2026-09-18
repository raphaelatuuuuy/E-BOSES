export function resolveMediaUrl(src: string, origin: string) {
  if (!src.startsWith("/") || src.startsWith("//")) return src
  return `${origin.replace(/\/$/, "")}${src}`
}
