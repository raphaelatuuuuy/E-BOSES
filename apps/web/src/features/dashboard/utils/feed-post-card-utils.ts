export function concernBodyText(post: {
  title?: string | null
  description?: string | null
}): string {
  const title = (post.title || "").trim()
  const description = (post.description || "").trim()
  if (!description) return title
  if (!title) return description
  if (description.startsWith(title) || title.startsWith(description)) {
    return description.length >= title.length ? description : title
  }
  return description
}

export function feedTimeAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

export function feedCategoryLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export function streetLabelFromAddress(address?: string | null) {
  if (!address?.trim()) return null
  const first = address.split(",")[0]?.trim()
  if (!first || first.toLowerCase() === "pending") return null
  return first
}
