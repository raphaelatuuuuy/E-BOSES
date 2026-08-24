import type leaflet from "leaflet"

/** What every map hover card shows: a photo when there is one, always words. */
export type MapTip = {
  image?: string | null
  title?: string | null
  excerpt?: string | null
  centered?: boolean
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Empty when the tip carries nothing, so callers can skip binding entirely. */
export function mapTipKey(tip: MapTip | null | undefined) {
  if (!tip) return ""
  const parts = [tip.image, tip.title, tip.excerpt].map((part) => part?.trim() ?? "")
  return parts.some(Boolean) ? parts.join("|") : ""
}

/** The one card markup — Street View's mini map and every hover map share it. */
export function mapCardHtml(tip: MapTip) {
  const image = tip.image
    ? `<img class="eboses-sv-pop__img" src="${escapeHtml(tip.image)}" alt="" />`
    : ""
  const title = tip.title?.trim()
    ? `<p class="eboses-sv-pop__title">${escapeHtml(tip.title.trim())}</p>`
    : ""
  const excerpt = tip.excerpt?.trim()
    ? `<p class="eboses-sv-pop__desc">${escapeHtml(tip.excerpt.trim())}</p>`
    : ""
  const bodyClass = tip.centered
    ? "eboses-sv-pop__body eboses-sv-pop__body--centered"
    : "eboses-sv-pop__body"
  return `<div class="${bodyClass}">${image}${title}${excerpt}</div>`
}

function hoverCard(L: typeof leaflet, pinSize: number) {
  return L.popup({
    className: "eboses-sv-pop",
    closeButton: false,
    // Slides the map so a card opened near an edge is never cut off.
    autoPan: true,
    autoPanPadding: L.point(12, 12),
    maxWidth: 240,
    offset: L.point(0, -pinSize / 2 + 6),
  })
}

/** Null when there is nothing worth showing, so callers can skip the hover. */
export function makeHoverCard(
  L: typeof leaflet,
  tip: MapTip | null | undefined,
  pinSize: number,
) {
  if (!tip || !mapTipKey(tip)) return null
  return hoverCard(L, pinSize).setContent(mapCardHtml(tip))
}

/** Brings the hovered pin to the middle of the view, then opens its card. */
export function openHoverCard(map: leaflet.Map, card: leaflet.Popup, marker: leaflet.Marker) {
  const at = marker.getLatLng()
  card.setLatLng(at)
  map.panTo(at, { animate: true, duration: 0.25 })
  map.openPopup(card)
}

/**
 * Hover card on a marker. A popup rather than a tooltip: only popups auto-pan
 * the map to stay whole. It is never bound to the marker, so a click still
 * belongs to whatever selection the map does.
 */
export function bindHoverCard(
  L: typeof leaflet,
  map: leaflet.Map,
  marker: leaflet.Marker,
  tip: MapTip | null | undefined,
  pinSize: number,
) {
  marker.off("mouseover")
  const card = makeHoverCard(L, tip, pinSize)
  if (!card) return
  marker.on("mouseover", () => openHoverCard(map, card, marker))
}

/**
 * Closing on the marker's own mouseout would fight the auto-pan: the pan
 * slides the pin out from under the cursor and the card would flicker shut
 * the moment it opened. Leaving the map closes it instead.
 */
export function closeHoverCardsOnLeave(map: leaflet.Map) {
  const host = map.getContainer()
  const close = () => map.closePopup()
  host.addEventListener("mouseleave", close)
  return () => host.removeEventListener("mouseleave", close)
}
