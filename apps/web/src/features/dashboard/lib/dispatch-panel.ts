/**
 * Opening the responder dispatch panel from anywhere.
 *
 * The Dispatch control lives in the mobile nav, which the shell mounts, while
 * the panel belongs to the map screen. Two cases, two mechanisms:
 *
 * - Pressed on Shift or Profile: the button navigates to the map with
 *   `?panel=1`. The map reads that as its initial state, so there is no race
 *   with mounting and a refresh keeps the panel open.
 * - Pressed while already on the map: an event, since the map is listening.
 */

export const DISPATCH_PANEL_EVENT = "eboses:open-dispatch-panel"

/** Search param that opens the panel on arrival. */
export const DISPATCH_PANEL_PARAM = "panel"

/** Tell a mounted map to open its panel. */
export function announceDispatchPanel() {
  window.dispatchEvent(new CustomEvent(DISPATCH_PANEL_EVENT))
}

/** Whether a location's search string is asking for the panel. */
export function wantsDispatchPanel(search: string) {
  return new URLSearchParams(search).get(DISPATCH_PANEL_PARAM) === "1"
}
