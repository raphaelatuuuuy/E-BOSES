import * as React from "react"
import { XIcon, type LucideIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * OpsWorkspace — the container both triage screens are built on.
 *
 * ## Why this exists
 *
 * Emergencies and Concerns are the same shape: a queue you triage from, the
 * record you selected, and the actions you take on it. They were built twice,
 * by hand, as fixed-width columns on a scrolling document — and they drifted.
 * The concern view ended up at `xl:grid-cols-[420px_minmax(0,1fr)_420px]`,
 * which at a 1280px viewport leaves the *primary* column 128px after the two
 * rails and the page padding take their cut.
 *
 * Two structural fixes, both of which this component owns so neither screen
 * can regress:
 *
 * 1. **Fill the viewport, don't scroll the document.** Three columns sharing
 *    one scrollbar means the tallest one pushes the page down and the shortest
 *    one wastes the fold. Here the workspace is exactly viewport-height and
 *    each pane scrolls independently.
 *
 * 2. **Widths are the official's, not ours.** Any fixed number we pick is
 *    wrong on somebody's monitor. Panes are drag-resizable and persist per
 *    user, and the clamp guarantees the detail pane never drops below its
 *    declared minimum no matter where the handles are dragged.
 *
 * ## Responsive ladder
 *
 * | Width      | Layout                                    | Detail pane |
 * |------------|-------------------------------------------|-------------|
 * | >= 1440    | list + detail + aside inline              | ~506px      |
 * | 1024-1439  | list + detail, aside in a slide-over      | ~707-866px  |
 * | < 1024     | one pane (list or detail), aside in sheet | full width  |
 *
 * The 1440 threshold is derived, not chosen: below it, three inline panes
 * would push the detail pane under its 420px minimum.
 */

export type OpsPaneRole = "list" | "detail" | "aside"

export interface OpsPaneSpec {
  id: string
  role: OpsPaneRole
  node: React.ReactNode
  /** Starting width in px. Ignored for the `detail` pane, which grows. */
  initial?: number
  /** Floor. For `detail` this is enforced against every drag on every pane. */
  min?: number
  max?: number
  /** Shown on the slide-over header and its trigger button. */
  label?: string
  icon?: LucideIcon
}

export interface OpsWorkspaceProps {
  /** Namespaces persisted pane widths. Use the page name. */
  id: string
  bar?: React.ReactNode
  panes: OpsPaneSpec[]
  /** Below 1024px, which single pane is showing. */
  mobileView?: "list" | "detail"
  /** Below 1440px, whether the aside slide-over is open. */
  asideOpen?: boolean
  onAsideOpenChange?: (open: boolean) => void
  className?: string
}

const DIVIDER_PX = 9
const KEYBOARD_STEP_PX = 16

function storageKey(workspaceId: string, paneId: string) {
  return `eboses:ws:${workspaceId}:${paneId}`
}

function readStoredWidth(workspaceId: string, paneId: string) {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(storageKey(workspaceId, paneId))
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function writeStoredWidth(workspaceId: string, paneId: string, width: number) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey(workspaceId, paneId), String(width))
  } catch {
    // Private mode / quota. Widths are a convenience, never load-bearing.
  }
}

/**
 * Layout tier. Deliberately three, not four: an intermediate tier collapsing
 * the aside to a ~48px icon strip was considered and dropped — measured out,
 * a 48px strip at 1280px leaves the detail pane 656px, while simply moving the
 * aside into the slide-over leaves it 707px. The simpler ladder is also the
 * roomier one.
 */
function useWorkspaceTier(): "wide" | "mid" | "mobile" {
  const [tier, setTier] = React.useState<"wide" | "mid" | "mobile">(() => {
    if (typeof window === "undefined") return "wide"
    if (window.innerWidth >= 1440) return "wide"
    return window.innerWidth >= 1024 ? "mid" : "mobile"
  })

  React.useEffect(() => {
    const wide = window.matchMedia("(min-width: 1440px)")
    const desktop = window.matchMedia("(min-width: 1024px)")
    const apply = () => setTier(wide.matches ? "wide" : desktop.matches ? "mid" : "mobile")
    apply()
    wide.addEventListener("change", apply)
    desktop.addEventListener("change", apply)
    return () => {
      wide.removeEventListener("change", apply)
      desktop.removeEventListener("change", apply)
    }
  }, [])

  return tier
}

/** Measures the pane row so drag clamps can be computed against real space. */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null)
  const [width, setWidth] = React.useState(0)

  React.useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    setWidth(node.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

function PaneShell({
  children,
  style,
  className,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <section
      className={cn("ops-pane relative flex min-w-0 flex-col", className)}
      style={style}
    >
      {children}
    </section>
  )
}

/**
 * The resize handle. The visible 1px line is decoration; the control is the
 * 9px hit area around it (see `.ops-divider` in globals.css).
 *
 * It is a real ARIA separator, not a decorative div with a mousedown handler:
 * focusable, arrow-key operable, and double-click resets to the default. A
 * dispatcher on a trackpad should not be the only person who can lay out
 * their own console.
 */
function Divider({
  label,
  value,
  min,
  max,
  direction,
  onResize,
  onReset,
}: {
  label: string
  value: number
  min: number
  max: number
  /** +1 when the resized pane is left of the handle, -1 when it is right. */
  direction: 1 | -1
  onResize: (nextWidth: number) => void
  onReset: () => void
}) {
  const [dragging, setDragging] = React.useState(false)

  /**
   * The pointermove listener is registered once per gesture, so it closes over
   * the render that started the drag. Reading props through a ref keeps it on
   * the current ones.
   *
   * This is the bug that made the handle feel broken: the previous version
   * emitted a *delta* into a callback that closed over the pane width at
   * pointerdown, so every move recomputed `staleWidth + oneFrameDelta`. The
   * pane jumped once on the first move and then sat still for the rest of the
   * drag. Widths are now absolute — measured from the gesture origin, which
   * also means no accumulated rounding drift over a long drag.
   */
  const latest = React.useRef({ value, direction, onResize })
  // Written after commit rather than during render: a ref mutated in the render
  // body is unsafe under concurrent rendering. Nothing reads this during
  // render — only the pointer and keyboard handlers, which run post-commit.
  React.useEffect(() => {
    latest.current = { value, direction, onResize }
  })

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = latest.current.value
    setDragging(true)
    document.body.dataset.opsResizing = "true"

    function handleMove(moveEvent: PointerEvent) {
      const travel = (moveEvent.clientX - startX) * latest.current.direction
      latest.current.onResize(startWidth + travel)
    }

    function handleUp() {
      setDragging(false)
      delete document.body.dataset.opsResizing
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      window.removeEventListener("pointercancel", handleUp)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleUp)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Arrow keys move the separator, so the pane grows or shrinks depending on
    // which side of the handle it sits.
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      onResize(value - KEYBOARD_STEP_PX * direction)
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      onResize(value + KEYBOARD_STEP_PX * direction)
    } else if (event.key === "Home") {
      event.preventDefault()
      onResize(min)
    } else if (event.key === "End") {
      event.preventDefault()
      onResize(max)
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onReset()
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-dragging={dragging || undefined}
      className="ops-divider"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={onReset}
    />
  )
}

/** In-tree slide-over. Deliberately not the shared `Sheet`: that portals to
 *  `document.body`, which escapes the `.staff-dark` token scope and would also
 *  overlay the nav rail. Anchored inside the workspace, it covers only the
 *  work area, which is what an official expects when opening dispatch. */
function AsideOverlay({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  label: string
  children: React.ReactNode
}) {
  React.useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="absolute inset-0 z-30 flex justify-end">
      <button
        type="button"
        aria-label={`Close ${label}`}
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      />
      <aside
        role="dialog"
        aria-label={label}
        className="relative flex h-full w-full max-w-[min(420px,90vw)] flex-col border-l border-card-line-strong bg-card shadow-[var(--shadow-overlay)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-card-line px-4 py-3">
          <h2 className="text-heading text-foreground">{label}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${label}`}
            className="flex size-7 items-center justify-center rounded-control text-muted-foreground transition-colors duration-[--duration-micro] hover:bg-card-raised hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </header>
        <div className="ops-pane flex-1 p-4">{children}</div>
      </aside>
    </div>
  )
}

export function OpsWorkspace({
  id,
  bar,
  panes,
  mobileView = "list",
  asideOpen = false,
  onAsideOpenChange,
  className,
}: OpsWorkspaceProps) {
  const tier = useWorkspaceTier()
  const [rowRef, rowWidth] = useMeasuredWidth<HTMLDivElement>()

  const list = panes.find((pane) => pane.role === "list") ?? null
  const detail = panes.find((pane) => pane.role === "detail") ?? null
  const aside = panes.find((pane) => pane.role === "aside") ?? null

  const listInitial = list?.initial ?? 340
  const asideInitial = aside?.initial ?? 360
  const detailMin = detail?.min ?? 420

  const [listWidth, setListWidth] = React.useState(
    () => (list ? readStoredWidth(id, list.id) : null) ?? listInitial,
  )
  const [asideWidth, setAsideWidth] = React.useState(
    () => (aside ? readStoredWidth(id, aside.id) : null) ?? asideInitial,
  )

  const asideInline = tier === "wide" && aside != null

  /**
   * Clamp a pane against its own bounds AND against the space the detail pane
   * is owed. Without the second half, dragging the queue rail right on a
   * narrow monitor would recreate the exact 128px column this component was
   * built to eliminate.
   */
  const clampPane = React.useCallback(
    (pane: OpsPaneSpec | null, next: number, otherPaneWidth: number, dividers: number) => {
      if (!pane) return next
      const lower = pane.min ?? 200
      const upper = pane.max ?? 640
      const available = rowWidth - otherPaneWidth - dividers * DIVIDER_PX - detailMin
      const ceiling = rowWidth > 0 ? Math.min(upper, Math.max(lower, available)) : upper
      return Math.round(Math.min(ceiling, Math.max(lower, next)))
    },
    [rowWidth, detailMin],
  )

  /**
   * State holds the width the official *asked for*; these hold the width that
   * actually fits right now. Deriving rather than clamping the stored value has
   * a real behavioural payoff: shrinking the window squeezes the queue rail,
   * and widening it again restores the width they chose instead of leaving them
   * stuck at whatever the narrow viewport allowed.
   */
  const effectiveAsideWidth = React.useMemo(
    () => (aside ? clampPane(aside, asideWidth, listWidth, 2) : 0),
    [aside, asideWidth, clampPane, listWidth],
  )

  const effectiveListWidth = React.useMemo(
    () =>
      clampPane(
        list,
        listWidth,
        asideInline ? effectiveAsideWidth : 0,
        asideInline ? 2 : 1,
      ),
    [asideInline, clampPane, effectiveAsideWidth, list, listWidth],
  )

  /**
   * Stored widths are clamped to the pane's own bounds but NOT to the space
   * currently available — that second clamp lives in the derived values above.
   * Persisting the preference rather than the fitted result is what lets a
   * narrow window squeeze the rail and a wide one give it back.
   */
  const commitList = React.useCallback(
    (next: number) => {
      if (!list) return
      const bounded = Math.round(Math.min(list.max ?? 640, Math.max(list.min ?? 200, next)))
      setListWidth(bounded)
      writeStoredWidth(id, list.id, bounded)
    },
    [id, list],
  )

  const commitAside = React.useCallback(
    (next: number) => {
      if (!aside) return
      const bounded = Math.round(Math.min(aside.max ?? 520, Math.max(aside.min ?? 260, next)))
      setAsideWidth(bounded)
      writeStoredWidth(id, aside.id, bounded)
    },
    [aside, id],
  )

  const closeAside = React.useCallback(() => onAsideOpenChange?.(false), [onAsideOpenChange])

  if (tier === "mobile") {
    const active = mobileView === "detail" ? detail : list
    return (
      <div className={cn("flex min-h-0 w-full flex-col bg-canvas", className)}>
        {bar}
        <div className="ops-pane flex-1">{active?.node}</div>
        {aside ? (
          <AsideOverlay open={asideOpen} onClose={closeAside} label={aside.label ?? "Actions"}>
            {aside.node}
          </AsideOverlay>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-canvas",
        className,
      )}
    >
      {bar}

      <div ref={rowRef} className="relative flex min-h-0 overflow-hidden">
        {list ? (
          <PaneShell style={{ flex: "none", width: effectiveListWidth }}>{list.node}</PaneShell>
        ) : null}

        {list && detail ? (
          <Divider
            label="Resize queue"
            value={effectiveListWidth}
            min={list.min ?? 200}
            max={list.max ?? 640}
            direction={1}
            onResize={commitList}
            onReset={() => commitList(listInitial)}
          />
        ) : null}

        {detail ? (
          <PaneShell style={{ flex: "1 1 0%", minWidth: 0 }}>{detail.node}</PaneShell>
        ) : null}

        {asideInline && aside ? (
          <>
            <Divider
              label={`Resize ${aside.label ?? "actions"}`}
              value={effectiveAsideWidth}
              min={aside.min ?? 260}
              max={aside.max ?? 520}
              direction={-1}
              onResize={commitAside}
              onReset={() => commitAside(asideInitial)}
            />
            <PaneShell style={{ flex: "none", width: effectiveAsideWidth }}>{aside.node}</PaneShell>
          </>
        ) : null}

        {!asideInline && aside ? (
          <AsideOverlay open={asideOpen} onClose={closeAside} label={aside.label ?? "Actions"}>
            {aside.node}
          </AsideOverlay>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Sticky pane header. Scrolled content passes *under* it rather than being
 * clipped by it, which is what makes a pane read as a surface with depth
 * instead of a cropped box.
 */
export function OpsPaneHeader({
  title,
  meta,
  action,
  className,
}: {
  title: string
  meta?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-card-line bg-canvas/85 px-4 py-2.5 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h2 className="text-micro uppercase text-subtle-foreground">{title}</h2>
        {meta ? <span className="truncate text-micro text-faint-foreground">{meta}</span> : null}
      </div>
      {action}
    </header>
  )
}
