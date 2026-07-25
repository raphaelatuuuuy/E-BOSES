const alertMapTimeFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

export function formatTime(value?: string | null) {
  if (!value) return "No update"
  return alertMapTimeFormatter.format(new Date(value))
}
