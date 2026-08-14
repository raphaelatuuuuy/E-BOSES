// apps/web/src/features/dashboard/components/feed-post-text.ts

/**
 * Shared pure helpers for feed/report text. Kept in their own module so the
 * feed card component file stays fast-refresh-friendly (components only).
 */

/**
 * Create-report stores `title` as the first ~80 chars of `description`.
 * Prefer a single body so the feed never shows the text twice.
 */
export function concernBodyText(post: {
  title?: string | null
  description?: string | null
}): string {
  const title = (post.title || "").trim()
  const description = (post.description || "").trim()
  if (!description) return title
  if (!title) return description
  // Auto-title is a prefix (often mid-word) of the full description
  if (description.startsWith(title) || title.startsWith(description)) {
    return description.length >= title.length ? description : title
  }
  return description
}

/** Short label for lists when title is only a hard-sliced description. */
export function concernTitleText(post: {
  title?: string | null
  description?: string | null
}): string {
  const body = concernBodyText(post)
  const title = (post.title || "").trim()
  if (!title) return body.slice(0, 80) || "Report"
  // Mid-word slice looks broken in list headers — clean at word boundary
  if (body.startsWith(title) && title.length < body.length) {
    const cut = title.replace(/\s+\S*$/, "").trim()
    return cut.length >= 24 ? cut : title
  }
  return title
}

export function categoryLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export function streetLabelFromAddress(address?: string | null) {
  if (!address?.trim()) return null
  const first = address.split(",")[0]?.trim()
  if (!first || first.toLowerCase() === "pending") return null
  return first
}