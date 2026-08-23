import type { MarkerTone } from "@/features/dashboard/components/map/markers"

const SURFACE: Record<MarkerTone, string> = {
  light: "#ffffff",
  dark: "#0b1020",
}

const SHELL: Record<MarkerTone, string> = {
  light: "box-shadow:0 2px 10px rgba(0,0,0,.15);",
  dark: "border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 26px rgba(0,0,0,.5);",
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function photoTooltipHtml(photoUrl: string, tone: MarkerTone = "light", caption?: string | null) {
  const surface = SURFACE[tone]
  const label = caption
    ? `<div style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 2px 1px;font-size:11.5px;font-weight:600;line-height:1.25;color:${tone === "dark" ? "#f2f5fa" : "#0f172a"};">${escapeHtml(caption)}</div>`
    : ""
  return `
    <div style="position:relative;background:${surface};border-radius:10px;${SHELL[tone]}padding:5px;pointer-events:none;opacity:0;transition:opacity 150ms ease;">
      <img src="${photoUrl}" alt="" style="display:block;width:160px;height:108px;object-fit:cover;border-radius:6px;" onload="this.parentElement.style.opacity='1'" onerror="this.style.display='none'" />
      ${label}
      <div style="position:absolute;bottom:0;left:50%;transform:translate(-50%,100%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:6px solid ${surface};"></div>
    </div>`
}

export function photoTooltipOptions(pinSize: number) {
  return {
    direction: "top" as const,
    offset: [0, -pinSize / 2 - 4] as [number, number],
    opacity: 1,
    className: "eboses-photo-tooltip",
    permanent: false,
  }
}
