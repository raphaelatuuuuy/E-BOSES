import type { LocationResolution, RoutePreview } from "./api"

export function routePreviewState(location: LocationResolution, route: RoutePreview) {
  return {
    // The barangay boundary outline is never drawn on this preview — the pin
    // and the route are the only things worth showing an official here.
    showBoundary: false,
    showIncident: location.has_destination && location.latitude != null && location.longitude != null,
    showResponder: location.has_destination,
    showRoute: location.has_destination && Boolean(route.geometry),
    noDestination: !location.has_destination,
  }
}
