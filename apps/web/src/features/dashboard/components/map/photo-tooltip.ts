import type leaflet from "leaflet"

import { concernSummaryText } from "@/features/dashboard/components/feed-post-text"

/** What every map hover card shows: a photo when there is one, always words. */
export type MapTip = {
  image?: string | null
  resolutionImage?: string | null
  resolved?: boolean
  resolutionCount?: number
  resolvedAt?: string | null
  title?: string | null
  reporterName?: string | null
  meta?: string | null
  eyebrow?: string | null
  eyebrowColor?: string | null
  badgeSvg?: string | null
  description?: string | null
  summary?: string | null
  severity?: string | null
  excerpt?: string | null
  excerptLabel?: string | null
  date?: string | null
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const INFO_ICON = `<span class="eboses-sv-pop__boxicon" style="color:#14455f"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span>`

const TRIANGLE_ICON = `<span class="eboses-sv-pop__boxicon" style="color:#9a3412"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>`

const CRITICAL_TRIANGLE_ICON = TRIANGLE_ICON.replace(
  "#9a3412",
  "var(--color-severity-critical-map-ink)"
)

const CHECK_ICON = `<span class="eboses-sv-pop__boxicon" style="color:#17513d"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></span>`

/** Empty when the tip carries nothing, so callers can skip binding entirely. */
export function mapTipKey(tip: MapTip | null | undefined) {
  if (!tip) return ""
  const parts = [
    tip.image,
    tip.resolutionImage,
    tip.resolved ? "resolved" : "",
    tip.resolvedAt,
    tip.reporterName,
    tip.eyebrow,
    tip.eyebrowColor,
    tip.badgeSvg,
    tip.title,
    tip.meta,
    tip.description,
    tip.summary,
    tip.severity,
    tip.excerpt,
    tip.excerptLabel,
    tip.date,
  ].map((part) => part?.trim() ?? "")
  return parts.some(Boolean) ? parts.join("|") : ""
}

function formatTipDate(value: string) {
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

function normaliseCopy(value: string) {
  return value
    .replace(/[“”‘’"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** Keeps street and barangay text consistent without repeating the area name. */
export function mapLocationMeta(
  address?: string | null,
  communityName?: string | null
) {
  const a = (address || "").trim()
  const c = (communityName || "").trim()
  if (!a) return c
  if (!c) return a
  if (a.toLowerCase() === c.toLowerCase()) return a
  const aLower = a.toLowerCase()
  const cLower = c.toLowerCase()
  if (aLower.endsWith(", " + cLower) || aLower.endsWith(" " + cLower)) return a
  if (aLower.includes(cLower)) return a
  return `${a}, ${c}`
}

/** The one card markup — Street View's mini map and every hover map share it. */
export function mapCardHtml(tip: MapTip) {
  const isAdvisory = Boolean(tip.eyebrow?.trim())
  const resolved = Boolean(tip.resolved)
  const critical = (tip.severity ?? "").toLowerCase() === "critical"
  const resolutionImage = tip.resolutionImage?.trim() || ""
  const primaryImage = resolved
    ? resolutionImage || tip.image?.trim() || ""
    : tip.image?.trim() || resolutionImage
  const media = primaryImage
    ? `<div class="eboses-sv-pop__media"><img class="eboses-sv-pop__img" src="${escapeHtml(primaryImage)}" alt="${resolved ? "Resolved condition" : ""}" /></div>`
    : ""
  const dateText = tip.date?.trim() ? formatTipDate(tip.date.trim()) : ""
  const date = dateText
    ? `<p class="eboses-sv-pop__date">Posted on ${escapeHtml(dateText)}</p>`
    : ""
  const badgeIcon = tip.badgeSvg?.trim() || ""
  const eyebrowColor = tip.eyebrowColor?.trim() || "#1f6c98"
  const eyebrow = tip.eyebrow?.trim()
    ? `<p class="eboses-sv-pop__label" style="color:${escapeHtml(eyebrowColor)}">${escapeHtml(tip.eyebrow.trim())}</p>`
    : ""
  const title = tip.title?.trim()
    ? `<p class="eboses-sv-pop__title">${escapeHtml(tip.title.trim())}</p>`
    : ""
  const meta = tip.meta?.trim()
    ? `<p class="eboses-sv-pop__meta">${escapeHtml(tip.meta.trim())}</p>`
    : ""
  const reporter = tip.reporterName?.trim() || ""
  const concernHeader = reporter
    ? `<div style="display:flex;align-items:center;gap:8px"><span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:none;border-radius:9999px;background:#c5d0e6;color:#43507f;font-size:13px;font-weight:700">${escapeHtml(reporter.charAt(0).toUpperCase())}</span><span style="min-width:0"><span style="display:block;font-size:14px;font-weight:700;color:#171717;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(reporter)}</span>${meta}</span></div>`
    : ""
  const advisoryHeader =
    isAdvisory && badgeIcon
      ? `<div style="display:flex;align-items:flex-start;gap:8px"><span style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;flex:none;border-radius:9999px;background:#eaf2f8;color:#1f6c98">${badgeIcon}</span><span style="min-width:0;flex:1">${title}</span></div>`
      : isAdvisory
        ? `${title}`
        : ""
  const submittedDescription = tip.description?.trim() || ""
  const generatedSummary = resolved
    ? ""
    : isAdvisory
      ? tip.summary?.trim() || ""
      : concernSummaryText({
          title: tip.title,
          description: tip.description,
          summary: tip.summary,
        })
  const legacyExcerpt =
    !submittedDescription && !generatedSummary ? tip.excerpt?.trim() || "" : ""
  const displayedSummary = generatedSummary || legacyExcerpt
  const summaryMatchesDescription =
    Boolean(submittedDescription && displayedSummary) &&
    normaliseCopy(submittedDescription) === normaliseCopy(displayedSummary)
  const sameAsTitle =
    !submittedDescription &&
    Boolean(tip.title?.trim() && displayedSummary) &&
    normaliseCopy(tip.title!.trim()) === normaliseCopy(displayedSummary)
  const excerptLabel =
    !submittedDescription &&
    !generatedSummary &&
    !sameAsTitle &&
    tip.excerptLabel?.trim()
      ? `<p class="eboses-sv-pop__label">${escapeHtml(tip.excerptLabel.trim())}</p>`
      : ""
  const description = submittedDescription
    ? `<p class="eboses-sv-pop__desc">${escapeHtml(submittedDescription)}</p>`
    : !generatedSummary && !sameAsTitle && legacyExcerpt
      ? `<p class="eboses-sv-pop__desc">${escapeHtml(legacyExcerpt)}</p>`
      : ""
  const resolvedDate = tip.resolvedAt?.trim()
    ? formatTipDate(tip.resolvedAt.trim())
    : tip.date?.trim()
      ? formatTipDate(tip.date.trim())
      : ""
  const resolvedLine = resolvedDate
    ? `<p class="eboses-sv-pop__resolved-copy">This issue was resolved on ${escapeHtml(resolvedDate)}</p>`
    : ""
  const showGenerated =
    Boolean(generatedSummary) &&
    (!submittedDescription || !summaryMatchesDescription) &&
    !sameAsTitle
  const summary = resolved
    ? resolvedLine
      ? `<div class="eboses-sv-pop__resolved-status">${CHECK_ICON}${resolvedLine}</div>`
      : ""
    : showGenerated
      ? `<div class="eboses-sv-pop__summary" style="background:${critical ? "var(--color-severity-critical-map-surface)" : "#fff4ed"}">${critical ? CRITICAL_TRIANGLE_ICON : TRIANGLE_ICON}<p class="eboses-sv-pop__desc" style="color:${critical ? "var(--color-severity-critical-map-ink)" : "#9a3412"}">${escapeHtml(generatedSummary)}</p></div>`
      : ""
  const advisoryExcerpt = tip.excerpt?.trim() || ""
  const advisoryExcerptSameAsTitle =
    Boolean(tip.title?.trim() && advisoryExcerpt) &&
    normaliseCopy(tip.title!.trim()) === normaliseCopy(advisoryExcerpt)
  const advisoryBodyText =
    submittedDescription || (!advisoryExcerptSameAsTitle ? advisoryExcerpt : "")
  const advisoryBody = advisoryBodyText
    ? `<p class="eboses-sv-pop__desc">${escapeHtml(advisoryBodyText)}</p>`
    : ""
  const advisorySummaryText =
    generatedSummary &&
    normaliseCopy(generatedSummary) !== normaliseCopy(advisoryBodyText) &&
    (!tip.title?.trim() ||
      normaliseCopy(generatedSummary) !== normaliseCopy(tip.title.trim()))
      ? generatedSummary
      : ""
  const advisorySummary = advisorySummaryText
    ? `<div class="eboses-sv-pop__summary" style="background:#eaf2f8">${INFO_ICON}<p class="eboses-sv-pop__desc" style="color:#14455f">${escapeHtml(advisorySummaryText)}</p></div>`
    : ""
  if (isAdvisory) {
    return `<div class="eboses-sv-pop__body" style="text-align:left">${advisoryHeader}${media}${date}${meta}${excerptLabel}${advisoryBody}${advisorySummary}</div>`
  }
  const metaStandalone = reporter ? "" : meta
  const concernTitle = reporter ? "" : title
  return `<div class="eboses-sv-pop__body" style="text-align:left">${concernHeader}${date}${eyebrow}${concernTitle}${metaStandalone}${excerptLabel}${description}${summary}${media}</div>`
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
  pinSize: number
) {
  if (!tip || !mapTipKey(tip)) return null
  return hoverCard(L, pinSize).setContent(mapCardHtml(tip))
}

export function openHoverCard(
  map: leaflet.Map,
  card: leaflet.Popup,
  marker: leaflet.Marker
) {
  ensureDragGuard(map)
  if (draggingMaps.has(map)) return
  const at = marker.getLatLng()
  card.setLatLng(at)
  map.openPopup(card)
  const el = card.getElement()
  if (el && !el.dataset.clickGuard) {
    el.dataset.clickGuard = "1"
    el.addEventListener("click", (event) => event.stopPropagation())
    el.addEventListener("wheel", (event) => event.stopPropagation(), {
      passive: true,
    })
  }
}

const dragGuards = new WeakSet<leaflet.Map>()
const draggingMaps = new WeakSet<leaflet.Map>()

function ensureDragGuard(map: leaflet.Map) {
  if (dragGuards.has(map)) return
  dragGuards.add(map)
  map.on("movestart", () => {
    draggingMaps.add(map)
    map.closePopup()
  })
  map.on("moveend", () => {
    draggingMaps.delete(map)
  })
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
  pinSize: number
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
