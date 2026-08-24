import type { LocationResolution, RoutePreview } from "./api"

export function routePreviewState(location: LocationResolution, route: RoutePreview) {
  return {
    showBoundary: Boolean(location.boundary),
    showIncident: location.has_destination && location.latitude != null && location.longitude != null,
    showResponder: location.has_destination,
    showRoute: location.has_destination && Boolean(route.geometry),
    noDestination: !location.has_destination,
  }
}
