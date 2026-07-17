import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Solar icon set (Iconify / 480 Design) — rounded minimal UI icons.
 * Linear (outline) when idle; Bold (solid) when active / hover / focus.
 * https://icon-sets.iconify.design/solar/
 */

type IconProps = {
  /** Force solid (active route). Hover / focus / active still work via parent `group`. */
  solid?: boolean
  className?: string
}

function IconShell({
  solid,
  className,
  regular,
  solidEl,
}: {
  solid?: boolean
  className?: string
  regular: ReactNode
  solidEl: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center text-current [&_svg]:size-full",
        className,
      )}
      aria-hidden="true"
    >
      {solid ? (
        solidEl
      ) : (
        <>
          <span className="inline-flex size-full group-hover:hidden group-focus-visible:hidden group-active:hidden">
            {regular}
          </span>
          <span className="hidden size-full group-hover:inline-flex group-focus-visible:inline-flex group-active:inline-flex">
            {solidEl}
          </span>
        </>
      )}
    </span>
  )
}

const vb = { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", "aria-hidden": true as const }

/* ── Anggara home (Flaticon) — solid glyph only ── */
/* https://www.flaticon.com/free-icon/home_10349274 (Anggara) */

function MaskedIcon({ src }: { src: string }) {
  return (
    <span
      className="block size-full bg-current"
      style={{
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  )
}

function HomeFill() {
  return <MaskedIcon src="/contents/home-anggara-fill.png" />
}

/** Home — Anggara solid glyph (always filled) */
export function SolarHomeIcon({ className }: IconProps) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center text-current",
        className,
      )}
      aria-hidden="true"
    >
      <HomeFill />
    </span>
  )
}

/* ── Solar document-text ── */

function DocumentLinear() {
  return (
    <svg {...vb} fill="none">
      <g stroke="currentColor" strokeWidth="1.5">
        <path d="M3 10c0-3.771 0-5.657 1.172-6.828S7.229 2 11 2h2c3.771 0 5.657 0 6.828 1.172S21 6.229 21 10v4c0 3.771 0 5.657-1.172 6.828S16.771 22 13 22h-2c-3.771 0-5.657 0-6.828-1.172S3 17.771 3 14z" />
        <path strokeLinecap="round" d="M8 12h8M8 8h8m-8 8h5" />
      </g>
    </svg>
  )
}

function DocumentBold() {
  return (
    <svg {...vb}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M4.172 3.172C3 4.343 3 6.229 3 10v4c0 3.771 0 5.657 1.172 6.828S7.229 22 11 22h2c3.771 0 5.657 0 6.828-1.172S21 17.771 21 14v-4c0-3.771 0-5.657-1.172-6.828S16.771 2 13 2h-2C7.229 2 5.343 2 4.172 3.172M7.25 8A.75.75 0 0 1 8 7.25h8a.75.75 0 0 1 0 1.5H8A.75.75 0 0 1 7.25 8m0 4a.75.75 0 0 1 .75-.75h8a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1-.75-.75M8 15.25a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** My Reports — solar:document-text */
export function SolarReportsIcon({ solid = false, className }: IconProps) {
  return (
    <IconShell
      solid={solid}
      className={className}
      regular={<DocumentLinear />}
      solidEl={<DocumentBold />}
    />
  )
}

/* ── Solar clipboard-list ── */

function ClipboardLinear() {
  return (
    <svg {...vb} fill="none">
      <g stroke="currentColor" strokeWidth="1.5">
        <path d="M16 4.002c2.175.012 3.353.109 4.121.877C21 5.758 21 7.172 21 10v6c0 2.829 0 4.243-.879 5.122C19.243 22 17.828 22 15 22H9c-2.828 0-4.243 0-5.121-.878C3 20.242 3 18.829 3 16v-6c0-2.828 0-4.242.879-5.121c.768-.768 1.946-.865 4.121-.877" />
        <path strokeLinecap="round" d="M10.5 14H17M7 14h.5M7 10.5h.5m-.5 7h.5m3-7H17m-6.5 7H17" />
        <path d="M8 3.5A1.5 1.5 0 0 1 9.5 2h5A1.5 1.5 0 0 1 16 3.5v1A1.5 1.5 0 0 1 14.5 6h-5A1.5 1.5 0 0 1 8 4.5z" />
      </g>
    </svg>
  )
}

function ClipboardBold() {
  return (
    <svg {...vb}>
      <path fill="currentColor" d="M9.5 2A1.5 1.5 0 0 0 8 3.5v1A1.5 1.5 0 0 0 9.5 6h5A1.5 1.5 0 0 0 16 4.5v-1A1.5 1.5 0 0 0 14.5 2z" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M6.5 4.037c-1.258.07-2.052.27-2.621.84C3 5.756 3 7.17 3 9.998v6c0 2.829 0 4.243.879 5.122c.878.878 2.293.878 5.121.878h6c2.828 0 4.243 0 5.121-.878c.879-.88.879-2.293.879-5.122v-6c0-2.828 0-4.242-.879-5.121c-.569-.57-1.363-.77-2.621-.84V4.5a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3zM7 9.75a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5zm3.5 0a.75.75 0 0 0 0 1.5H17a.75.75 0 0 0 0-1.5zM7 13.25a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5zm3.5 0a.75.75 0 0 0 0 1.5H17a.75.75 0 0 0 0-1.5zM7 16.75a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5zm3.5 0a.75.75 0 0 0 0 1.5H17a.75.75 0 0 0 0-1.5z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** Report list / create — solar:clipboard-list */
export function SolarClipboardIcon({ solid = false, className }: IconProps) {
  return (
    <IconShell
      solid={solid}
      className={className}
      regular={<ClipboardLinear />}
      solidEl={<ClipboardBold />}
    />
  )
}

/* ── Solar siren-rounded ── */

function SirenLinear() {
  return (
    <svg {...vb} fill="none">
      <g stroke="currentColor" strokeWidth="1.5">
        <path d="M20 22v-6a8 8 0 1 0-16 0v6" />
        <path strokeLinecap="round" d="M14.29 11.5a4 4 0 0 1 2.21 2.21M2 22h20M12 2v3m9 1l-1.5 1.5M3 6l1.5 1.5" />
        <path d="M13.5 17.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 0 1 3 0Z" />
        <path strokeLinecap="round" d="M12 19v3" />
      </g>
    </svg>
  )
}

function SirenBold() {
  return (
    <svg {...vb}>
      <path fill="currentColor" d="M12.75 2a.75.75 0 0 0-1.5 0v3a.75.75 0 0 0 1.5 0z" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M2 21.25h2V16a8 8 0 1 1 16 0v5.25h2a.75.75 0 0 1 0 1.5H2a.75.75 0 0 1 0-1.5m10.75-2.45a1.5 1.5 0 1 0-1.5 0v2.45h1.5zm.845-7.581a.75.75 0 0 1 .977-.414a4.76 4.76 0 0 1 2.623 2.623a.75.75 0 0 1-1.39.563a3.26 3.26 0 0 0-1.796-1.796a.75.75 0 0 1-.414-.976"
        clipRule="evenodd"
      />
      <path
        fill="currentColor"
        d="M21.53 5.47a.75.75 0 0 1 0 1.06l-1.5 1.5a.75.75 0 1 1-1.06-1.06l1.5-1.5a.75.75 0 0 1 1.06 0m-18 0a.75.75 0 0 0-1.06 1.06l1.5 1.5a.75.75 0 0 0 1.06-1.06z"
      />
    </svg>
  )
}

/** Emergency History — solar:siren-rounded */
export function SolarEmergencyIcon({ solid = false, className }: IconProps) {
  return (
    <IconShell solid={solid} className={className} regular={<SirenLinear />} solidEl={<SirenBold />} />
  )
}

/* ── Solar settings ── */

function SettingsLinear() {
  return (
    <svg {...vb} fill="none">
      <g stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="3" />
        <path d="M13.765 2.152C13.398 2 12.932 2 12 2s-1.398 0-1.765.152a2 2 0 0 0-1.083 1.083c-.092.223-.129.484-.143.863a1.62 1.62 0 0 1-.79 1.353a1.62 1.62 0 0 1-1.567.008c-.336-.178-.579-.276-.82-.308a2 2 0 0 0-1.478.396C4.04 5.79 3.806 6.193 3.34 7s-.7 1.21-.751 1.605a2 2 0 0 0 .396 1.479c.148.192.355.353.676.555c.473.297.777.803.777 1.361s-.304 1.064-.777 1.36c-.321.203-.529.364-.676.556a2 2 0 0 0-.396 1.479c.052.394.285.798.75 1.605c.467.807.7 1.21 1.015 1.453a2 2 0 0 0 1.479.396c.24-.032.483-.13.819-.308a1.62 1.62 0 0 1 1.567.008c.483.28.77.795.79 1.353c.014.38.05.64.143.863a2 2 0 0 0 1.083 1.083C10.602 22 11.068 22 12 22s1.398 0 1.765-.152a2 2 0 0 0 1.083-1.083c.092-.223.129-.483.143-.863c.02-.558.307-1.074.79-1.353a1.62 1.62 0 0 1 1.567-.008c.336.178.579.276.819.308a2 2 0 0 0 1.479-.396c.315-.242.548-.646 1.014-1.453s.7-1.21.751-1.605a2 2 0 0 0-.396-1.479c-.148-.192-.355-.353-.676-.555A1.62 1.62 0 0 1 19.562 12c0-.558.304-1.064.777-1.36c.321-.203.529-.364.676-.556a2 2 0 0 0 .396-1.479c-.052-.394-.285-.798-.75-1.605c-.467-.807-.7-1.21-1.015-1.453a2 2 0 0 0-1.479-.396c-.24.032-.483.13-.82.308a1.62 1.62 0 0 1-1.566-.008a1.62 1.62 0 0 1-.79-1.353c-.014-.38-.05-.64-.143-.863a2 2 0 0 0-1.083-1.083Z" />
      </g>
    </svg>
  )
}

function SettingsBold() {
  return (
    <svg {...vb}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M14.279 2.152C13.909 2 13.439 2 12.5 2s-1.408 0-1.779.152a2 2 0 0 0-1.09 1.083c-.094.223-.13.484-.145.863a1.62 1.62 0 0 1-.796 1.353a1.64 1.64 0 0 1-1.579.008c-.338-.178-.583-.276-.825-.308a2.03 2.03 0 0 0-1.49.396c-.318.242-.553.646-1.022 1.453c-.47.807-.704 1.21-.757 1.605c-.07.526.074 1.058.4 1.479c.148.192.357.353.68.555c.477.297.783.803.783 1.361s-.306 1.064-.782 1.36c-.324.203-.533.364-.682.556a2 2 0 0 0-.399 1.479c.053.394.287.798.757 1.605s.704 1.21 1.022 1.453c.424.323.96.465 1.49.396c.242-.032.487-.13.825-.308a1.64 1.64 0 0 1 1.58.008c.486.28.774.795.795 1.353c.015.38.051.64.145.863c.204.49.596.88 1.09 1.083c.37.152.84.152 1.779.152s1.409 0 1.779-.152a2 2 0 0 0 1.09-1.083c.094-.223.13-.483.145-.863c.02-.558.309-1.074.796-1.353a1.64 1.64 0 0 1 1.579-.008c.338.178.583.276.825.308c.53.07 1.066-.073 1.49-.396c.318-.242.553-.646 1.022-1.453c.47-.807.704-1.21.757-1.605a2 2 0 0 0-.4-1.479c-.148-.192-.357-.353-.68-.555c-.477-.297-.783-.803-.783-1.361s.306-1.064.782-1.36c.324-.203.533-.364.682-.556a2 2 0 0 0 .399-1.479c-.053-.394-.287-.798-.757-1.605s-.704-1.21-1.022-1.453a2.03 2.03 0 0 0-1.49-.396c-.242.032-.487.13-.825.308a1.64 1.64 0 0 1-1.58-.008a1.62 1.62 0 0 1-.795-1.353c-.015-.38-.051-.64-.145-.863a2 2 0 0 0-1.09-1.083M12.5 15c1.67 0 3.023-1.343 3.023-3S14.169 9 12.5 9s-3.023 1.343-3.023 3s1.354 3 3.023 3"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** Settings — solar:settings */
export function SolarSettingsIcon({ solid = false, className }: IconProps) {
  return (
    <IconShell
      solid={solid}
      className={className}
      regular={<SettingsLinear />}
      solidEl={<SettingsBold />}
    />
  )
}

/* ── Solar users-group-rounded ── */

function UsersLinear() {
  return (
    <svg {...vb} fill="none">
      <g stroke="currentColor" strokeWidth="1.5">
        <circle cx="9" cy="6" r="4" />
        <path strokeLinecap="round" d="M15 9a3 3 0 1 0 0-6" />
        <ellipse cx="9" cy="17" rx="7" ry="4" />
        <path
          strokeLinecap="round"
          d="M18 14c1.754.385 3 1.359 3 2.5c0 1.03-1.014 1.923-2.5 2.37"
        />
      </g>
    </svg>
  )
}

function UsersBold() {
  return (
    <svg {...vb}>
      <circle cx="9.001" cy="6" r="4" fill="currentColor" />
      <ellipse cx="9.001" cy="17.001" fill="currentColor" rx="7" ry="4" />
      <path
        fill="currentColor"
        d="M21 17c0 1.657-2.036 3-4.521 3c.732-.8 1.236-1.805 1.236-2.998c0-1.195-.505-2.2-1.239-3.001C18.962 14 21 15.344 21 17M18 6a3 3 0 0 1-4.029 2.82A5.7 5.7 0 0 0 14.714 6c0-1.025-.27-1.987-.742-2.819A3 3 0 0 1 18 6.001"
      />
    </svg>
  )
}

/** Community — solar:users-group-rounded */
export function SolarCommunityIcon({ solid = false, className }: IconProps) {
  return (
    <IconShell solid={solid} className={className} regular={<UsersLinear />} solidEl={<UsersBold />} />
  )
}

/* ── Solar chat-round-line ── */

function ChatLinear() {
  return (
    <svg {...vb} fill="none">
      <g stroke="currentColor" strokeWidth="1.5">
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12c0 1.6.376 3.112 1.043 4.453c.178.356.237.763.134 1.148l-.595 2.226a1.3 1.3 0 0 0 1.591 1.592l2.226-.596a1.63 1.63 0 0 1 1.149.133A9.96 9.96 0 0 0 12 22Z" />
        <path strokeLinecap="round" d="M8 10.5h8M8 14h5.5" />
      </g>
    </svg>
  )
}

function ChatBold() {
  return (
    <svg {...vb}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12c0 1.6.376 3.112 1.043 4.453c.178.356.237.763.134 1.148l-.595 2.226a1.3 1.3 0 0 0 1.591 1.592l2.226-.596a1.63 1.63 0 0 1 1.149.133A9.96 9.96 0 0 0 12 22m-4-8.75a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5zm-.75-2.75A.75.75 0 0 1 8 9.75h8a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1-.75-.75"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** Feed / chat — solar:chat-round-line */
export function SolarChatIcon({ solid = false, className }: IconProps) {
  return (
    <IconShell solid={solid} className={className} regular={<ChatLinear />} solidEl={<ChatBold />} />
  )
}

/* ── Solar user ── */

function UserLinear() {
  return (
    <svg {...vb} fill="none">
      <g stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="6" r="4" />
        <path d="M20 17.5c0 2.485 0 4.5-8 4.5s-8-2.015-8-4.5S7.582 13 12 13s8 2.015 8 4.5Z" />
      </g>
    </svg>
  )
}

function UserBold() {
  return (
    <svg {...vb}>
      <circle cx="12" cy="6" r="4" fill="currentColor" />
      <path
        fill="currentColor"
        d="M20 17.5c0 2.485 0 4.5-8 4.5s-8-2.015-8-4.5S7.582 13 12 13s8 2.015 8 4.5"
      />
    </svg>
  )
}

/** Profile — solar:user */
export function SolarUserIcon({ solid = false, className }: IconProps) {
  return (
    <IconShell solid={solid} className={className} regular={<UserLinear />} solidEl={<UserBold />} />
  )
}

/* ── Aliases (mobile-nav + older imports) ── */

export const BoxHomeAlt2Icon = SolarHomeIcon
export const BoxReportIcon = SolarReportsIcon
export const BoxAlertsIcon = SolarCommunityIcon
