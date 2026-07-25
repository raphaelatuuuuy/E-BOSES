export const unitLabel: Record<string, string> = {
  tanod: "Barangay Tanod",
  bhw: "BHW",
  bdrrmo: "BDRRMO",
  other: "Responder",
  "": "Responder",
}

export const statusLabel: Record<string, string> = {
  submitted: "Submitted",
  routed: "Routed",
  acknowledged: "Responder routed",
  en_route: "En route",
  nearby: "Nearby",
  arrived: "Arrived",
  resolved: "Resolved",
  cancelled: "Cancelled",
}

const emergencyTimeFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

export function formatTime(value: string) {
  return emergencyTimeFormatter.format(new Date(value))
}
