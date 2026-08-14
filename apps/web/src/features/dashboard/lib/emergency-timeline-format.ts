export function dayKey(value: string) {
  const moment = new Date(value)
  return Number.isFinite(moment.getTime()) ? moment.toDateString() : ""
}

export function formatEventDay(value: string) {
  return new Date(value).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export function formatEventMoment(value: string) {
  const moment = new Date(value)
  if (!Number.isFinite(moment.getTime())) return "Time not recorded"
  return `${moment.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: "numeric",
  })} at ${moment.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
}
