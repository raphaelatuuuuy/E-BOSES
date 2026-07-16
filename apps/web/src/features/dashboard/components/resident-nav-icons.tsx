import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

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
        "inline-flex size-7 shrink-0 items-center justify-center text-current",
        className,
      )}
      aria-hidden="true"
    >
      {solid ? (
        solidEl
      ) : (
        <>
          <span className="inline-flex group-hover:hidden group-focus-visible:hidden group-active:hidden">
            {regular}
          </span>
          <span className="hidden group-hover:inline-flex group-focus-visible:inline-flex group-active:inline-flex">
            {solidEl}
          </span>
        </>
      )}
    </span>
  )
}

const svgProps = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "currentColor",
  className: "size-7",
  "aria-hidden": true as const,
}

/** Boxicons regular `home-alt-2` */
function HomeAlt2Regular() {
  return (
    <svg {...svgProps}>
      <path d="M12.71 2.29a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42A1 1 0 0 0 3 13h1v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7h1a1 1 0 0 0 1-1 1 1 0 0 0-.29-.71zM6 20v-9.59l6-6 6 6V20z" />
    </svg>
  )
}

/** Boxicons solid `home-alt-2` */
function HomeAlt2Solid() {
  return (
    <svg {...svgProps}>
      <path d="M12.74 2.32a1 1 0 0 0-1.48 0l-9 10A1 1 0 0 0 3 14h2v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7h2a1 1 0 0 0 1-1 1 1 0 0 0-.26-.68z" />
    </svg>
  )
}

/**
 * Home — boxicons `home-alt-2`
 * regular → solid on hover / focus / active / selected
 */
export function BoxHomeAlt2Icon({ solid = false, className }: IconProps) {
  return (
    <IconShell
      solid={solid}
      className={className}
      regular={<HomeAlt2Regular />}
      solidEl={<HomeAlt2Solid />}
    />
  )
}

/**
 * Report — boxicons solid `report` + outline counterpart for regular
 * (boxicons only ships solid `report`)
 */
function ReportRegular() {
  return (
    <svg {...svgProps}>
      <path d="M19.903 8.586a.997.997 0 0 0-.196-.293l-6-6a.997.997 0 0 0-.293-.196c-.03-.014-.062-.022-.094-.033a.991.991 0 0 0-.259-.051C13.04 2.011 13.021 2 13 2H6c-1.103 0-2 .897-2 2v16c0 1.103.897 2 2 2h12c1.103 0 2-.897 2-2V9c0-.021-.011-.04-.013-.062a.952.952 0 0 0-.051-.259c-.01-.032-.019-.063-.033-.093zM16.586 8H14V5.414L16.586 8zM6 20V4h6v5a1 1 0 0 0 1 1h5l.002 10H6z" />
      <path d="M8 12h2v7H8zm4-3h2v10h-2zm4 3h2v7h-2z" />
    </svg>
  )
}

function ReportSolid() {
  return (
    <svg {...svgProps}>
      <path d="m20 8-6-6H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM9 19H7v-9h2v9zm4 0h-2v-6h2v6zm4 0h-2v-3h2v3zM14 9h-1V4l5 5h-4z" />
    </svg>
  )
}

export function BoxReportIcon({ solid = false, className }: IconProps) {
  return (
    <IconShell
      solid={solid}
      className={className}
      regular={<ReportRegular />}
      solidEl={<ReportSolid />}
    />
  )
}

/** Boxicons regular `error` — triangle with ! (alerts) */
function ErrorRegular() {
  return (
    <svg {...svgProps}>
      <path d="M11.001 10h2v5h-2zM11 16h2v2h-2z" />
      <path d="M13.768 4.2C13.42 3.545 12.742 3.138 12 3.138s-1.42.407-1.768 1.063L2.894 18.064a1.986 1.986 0 0 0 .054 1.968A1.984 1.984 0 0 0 4.661 21h14.678c.708 0 1.349-.362 1.714-.968a1.989 1.989 0 0 0 .054-1.968L13.768 4.2zM4.661 19 12 5.137 19.344 19H4.661z" />
    </svg>
  )
}

/** Boxicons solid `error` */
function ErrorSolid() {
  return (
    <svg {...svgProps}>
      <path d="M12.884 2.532c-.346-.654-1.422-.654-1.768 0l-9 17A.999.999 0 0 0 3 21h18a.998.998 0 0 0 .883-1.467L12.884 2.532zM13 18h-2v-2h2v2zm-2-4V9h2l.001 5H11z" />
    </svg>
  )
}

/**
 * Alerts — boxicons `error` (warning triangle)
 * regular → solid on hover / focus / active / selected
 */
export function BoxAlertsIcon({ solid = false, className }: IconProps) {
  return (
    <IconShell
      solid={solid}
      className={className}
      regular={<ErrorRegular />}
      solidEl={<ErrorSolid />}
    />
  )
}
