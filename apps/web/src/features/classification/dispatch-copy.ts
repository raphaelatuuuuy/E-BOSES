import type { LocationResolution, RoutePreview, SimulationCommunity } from "./api"

function words(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function emergencyTitle(type: string) {
  return `${words(type || "Possible")} emergency`
}

export function locationSourceLabel(source: LocationResolution["source"]) {
  const labels: Record<LocationResolution["source"], string> = {
    web_gps: "Location from pinned map",
    sms_gps: "Location sent by SMS",
    message_area: "Area named in the message",
    recent_account_location: "Recent shared location",
    profile_community: "Registered community only",
    home_context: "Home community reference only",
    none: "Location not confirmed",
  }
  return labels[source]
}

export function routeScopeLabel(scope: "local" | "cross_community" | "manual_dispatch", community?: SimulationCommunity | null) {
  if (scope === "local") return "Local responder"
  if (scope === "cross_community") return community ? `Responder from ${community.name}` : "Responder from another community"
  return "Manual dispatch"
}

export function routeStateLabel(route: RoutePreview) {
  if (route.status === "ok") return route.profile === "car" ? "Driving route ready" : "Route ready"
  if (route.status === "stale") return "Showing the last saved route"
  if (route.status === "no_destination") return "Exact incident location needed"
  return "Live route unavailable"
}

export function responderMessage(type: string, route: RoutePreview, found: boolean) {
  if (!found) return "No responder is ready. The emergency stays active and goes to manual dispatch."
  const name = words(type || "Emergency").toLowerCase()
  if (route.status === "ok") return `A ${name} responder is ready. The driving route is shown below.`
  return `A ${name} responder is ready. Live route data is not available yet.`
}
