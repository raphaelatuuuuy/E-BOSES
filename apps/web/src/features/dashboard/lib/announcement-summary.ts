export type AnnouncementSummaryInput = {
  title: string
  body: string
  llm_summary?: string | null
}

function clean(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim()
}

/** Uses the system-generated value, with a safe display fallback for old API data. */
export function announcementSummary(announcement: AnnouncementSummaryInput) {
  const generated = clean(announcement.llm_summary)
  if (generated) return generated

  const title = clean(announcement.title)
  return `This announcement is about ${title || "a barangay update"}.`
}

/** Short English subject derived from the stored LLM sentence. */
export function announcementTitle(announcement: AnnouncementSummaryInput) {
  const generated = clean(announcement.llm_summary)
  const subject = generated
    .replace(/^this announcement is about\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim()
  if (subject) return subject.charAt(0).toUpperCase() + subject.slice(1)

  return clean(announcement.title) || "Barangay announcement"
}

export type AnnouncementDateInput = {
  starts_at?: string | null
  published_at?: string | null
  created_at?: string | null
}

/** Same source the API date label uses, rendered with time in the viewer's locale. */
export function formatAnnouncementDateTime(
  announcement: AnnouncementDateInput
) {
  const value =
    announcement.starts_at ??
    announcement.published_at ??
    announcement.created_at ??
    null
  if (!value) return ""
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  const date = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed)
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)
  return `${date} at ${time}`
}
