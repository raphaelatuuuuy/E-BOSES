import * as React from "react"
import { ChevronDownIcon, InfoIcon, MessageSquareIcon, XIcon, type LucideIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { CollapsedStrip } from "@/features/dashboard/components/responder/dispatch-surface"
import { useBottomSheetSnap } from "@/features/dashboard/lib/use-bottom-sheet-snap"

export type OpsPaneRole = "list" | "detail" | "aside"

export interface OpsPaneSpec {
  id: string
  role: OpsPaneRole
  node: React.ReactNode

  initial?: number

  min?: number
  max?: number

  label?: string
  icon?: LucideIcon

  collapsible?: boolean
  collapsed?: boolean
  onCollapsedChange?: (next: boolean) => void
  className?: string
}

export interface OpsWorkspaceProps {

  id: string
  bar?: React.ReactNode
  panes: OpsPaneSpec[]

  mobileView?: "list" | "detail"

  asideOpen?: boolean
  onAsideOpenChange?: (open: boolean) => void
  /** Mobile only: dismiss the detail sheet (X button). */
  onMobileDetailClose?: () => void
  /** Reports the live list-pane width so a page can align bar content to it. */
  onListResize?: (width: number) => void
  /** Lets an inline aside span above the workspace bar while list/detail remain inset below it. */
  fullHeightAside?: boolean
  /** Lets the detail pane span above the workspace bar so it sits beside the search input. */
  fullHeightDetail?: boolean
  className?: string
}

const DIVIDER_PX = 9
const KEYBOARD_STEP_PX = 16

const COLLAPSED_PANE_WIDTH = 68

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
    void 0
  }
}

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
      className={cn("relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden", className)}
      style={style}
    >
      {children}
    </section>
  )
}

function CollapsedPane({
  label,
  onExpand,
}: {
  label: string
  onExpand: () => void
}) {
  return (
    <div className="flex h-full shrink-0 items-stretch" style={{ width: COLLAPSED_PANE_WIDTH }}>
      <CollapsedStrip label={label} onExpand={onExpand} className="h-full w-full" />
    </div>
  )
}

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

  direction: 1 | -1
  onResize: (nextWidth: number) => void
  onReset: () => void
}) {
  const [dragging, setDragging] = React.useState(false)

  const latest = React.useRef({ value, direction, onResize })

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

    <div className="absolute inset-0 z-[1100] flex justify-end">
      <button
        type="button"
        aria-label={`Close ${label}`}
        onClick={onClose}

        className="absolute inset-0 bg-black/65"
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
        <div className="ops-pane flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          {children}
        </div>
      </aside>
    </div>
  )
}

function MobileSheetLayout({
  list,
  detail,
  aside,
  asideOpen,
  detailOpen,
  onCloseDetail,
}: {
  list: OpsPaneSpec | null
  detail: OpsPaneSpec | null
  aside: OpsPaneSpec | null
  asideOpen: boolean
  detailOpen: boolean
  onCloseDetail: () => void
}) {
  const {
    snaps,
    height,
    dragging,
    snapTo,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
  } = useBottomSheetSnap({ initialMode: "hidden" })
  const [sheetTab, setSheetTab] = React.useState<"detail" | "aside">("detail")

  React.useEffect(() => {
    snapTo(detailOpen ? "expanded" : "hidden")
  }, [detailOpen, snapTo])

  const visibleSheetTab = asideOpen ? "aside" : sheetTab

  const sheetShown = Boolean(detail) && detailOpen
  React.useEffect(() => {
    if (!sheetShown) return
    document.body.dataset.opsSheet = "open"
    return () => {
      delete document.body.dataset.opsSheet
    }
  }, [sheetShown])

  const contentVisible = height > snaps().hidden + 14

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* The queue pane owns scrolling on mobile. Keeping an overflow-y-auto
          host here creates a nested scroll container and traps touch/wheel
          gestures before the queue can reach its bottom. */}
      <div className="min-h-0 flex-1 overflow-hidden">{list?.node}</div>

      {detail && detailOpen ? (
        <div
          className={cn(
            "absolute bottom-[calc(-1*env(safe-area-inset-bottom))] left-0 right-0 z-20 flex flex-col overflow-hidden rounded-t-3xl border border-b-0 border-neutral-200 bg-white shadow-[0_-10px_36px_rgba(15,23,42,.18)]",
            !dragging && "transition-[height] duration-200 ease-out",
          )}
          style={{
            height: `calc(${Math.min(height, snaps().max)}px + env(safe-area-inset-bottom))`,
            maxHeight: "calc(88dvh + env(safe-area-inset-bottom))",
          }}
          role="dialog"
          aria-label={detail.label ?? "Details"}
        >
          <div
            className="flex shrink-0 touch-none cursor-grab justify-center pt-2 active:cursor-grabbing"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            aria-label="Drag sheet"
          >
            <span className="h-1.5 w-11 rounded-full bg-neutral-300" />
          </div>

           {contentVisible ? (
             <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-2">
               <h2 className="min-w-0 flex-1 truncate text-[22px] font-bold leading-[1.2] tracking-tight text-neutral-900">
                 {detail.label ?? "Report detail"}
              </h2>
              {aside ? (
                <div className="flex shrink-0 items-center gap-1 rounded-full bg-neutral-100 p-1">
                  <button
                    type="button"
                    aria-label={detail.label ?? "Conversation"}
                    aria-pressed={visibleSheetTab === "detail"}
                    onClick={() => setSheetTab("detail")}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full transition-colors",
                      visibleSheetTab === "detail"
                        ? "bg-white text-neutral-900 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-800",
                    )}
                  >
                    <MessageSquareIcon className="size-5" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    aria-label={aside.label ?? "Info"}
                    aria-pressed={visibleSheetTab === "aside"}
                    onClick={() => setSheetTab("aside")}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full transition-colors",
                      visibleSheetTab === "aside"
                        ? "bg-white text-neutral-900 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-800",
                    )}
                  >
                    <InfoIcon className="size-5" strokeWidth={2} />
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={onCloseDetail}
                aria-label="Close"
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
              >
                <XIcon className="size-5" strokeWidth={2} />
              </button>
            </div>
          ) : null}

          <div
            className={cn(
              "ops-sheet-flat flex min-h-0 flex-1 flex-col px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
              contentVisible ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            {contentVisible ? (visibleSheetTab === "aside" && aside ? aside.node : detail.node) : null}
          </div>
        </div>
      ) : null}
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
  onMobileDetailClose,
  onListResize,
  fullHeightAside = false,
  fullHeightDetail = false,
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

  const asideInline = tier !== "mobile" && aside != null

  const listCollapsed = Boolean(list?.collapsible && list.collapsed)
  const detailCollapsed = Boolean(detail?.collapsible && detail.collapsed)
  const asideCollapsed = Boolean(aside?.collapsible && aside.collapsed)
  const listShown = list != null && !listCollapsed
  const detailShown = detail != null && !detailCollapsed
  const asideShown = aside != null && asideInline && !asideCollapsed

  const dividersListDetail = listShown && detailShown ? 1 : 0
  const dividersDetailAside = detailShown && asideShown ? 1 : 0
  const totalDividers = dividersListDetail + dividersDetailAside

  function clampPane(
    pane: OpsPaneSpec | null,
    next: number,
    otherPaneWidth: number,
    dividers: number,
  ) {
    if (!pane) return next
    const lower = pane.min ?? 200
    const upper = pane.max ?? 640
    const available = rowWidth - otherPaneWidth - dividers * DIVIDER_PX - (detailShown ? detailMin : 0)
    const ceiling = rowWidth > 0 ? Math.min(upper, Math.max(lower, available)) : upper
    return Math.round(Math.min(ceiling, Math.max(lower, next)))
  }

  const effectiveAsideWidth = asideShown
    ? clampPane(
        aside,
        asideWidth,
        list ? (listShown ? listWidth : COLLAPSED_PANE_WIDTH) : 0,
        totalDividers,
      )
    : 0

  const effectiveListWidth = listShown
    ? clampPane(
        list,
        listWidth,
        aside ? (asideShown ? effectiveAsideWidth : COLLAPSED_PANE_WIDTH) : 0,
        totalDividers,
      )
    : 0

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

  React.useEffect(() => {
    if (listShown && effectiveListWidth > 0) onListResize?.(effectiveListWidth)
  }, [listShown, effectiveListWidth, onListResize])

  const closeAside = React.useCallback(() => onAsideOpenChange?.(false), [onAsideOpenChange])

  if (tier === "mobile") {
    return (
      <div className={cn("flex min-h-[calc(100dvh-4.5rem)] w-full flex-1 flex-col bg-white", className)}>
        {bar}
        <MobileSheetLayout
          list={list}
          detail={detail}
          aside={aside}
          asideOpen={asideOpen}
          detailOpen={mobileView === "detail"}
          onCloseDetail={onMobileDetailClose ?? closeAside}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "relative grid h-full min-h-0 overflow-hidden bg-canvas",
        (fullHeightAside && asideInline) || (fullHeightDetail && detailShown)
          ? "grid-rows-[minmax(0,1fr)]"
          : "grid-rows-[auto_minmax(0,1fr)]",
        className,
      )}
    >
      {fullHeightDetail && detailShown ? (
        <div
          className="absolute left-0 top-0 z-20"
          style={{
            width: effectiveListWidth + dividersListDetail * DIVIDER_PX,
          }}
        >
          {bar}
        </div>
      ) : fullHeightAside && asideInline ? (
        <div
          className="absolute left-0 top-0 z-20"
          style={{
            right: asideShown
              ? effectiveAsideWidth + dividersDetailAside * DIVIDER_PX
              : aside
                ? COLLAPSED_PANE_WIDTH
                : 0,
          }}
        >
          {bar}
        </div>
      ) : (
        bar
      )}

      <div ref={rowRef} className="relative flex h-full min-h-0 flex-1 overflow-hidden">
        {list ? (
          listShown ? (

            <PaneShell
              className={cn(((fullHeightAside && asideInline) || (fullHeightDetail && detailShown)) && "pt-16", list.className)}
              style={
                detailShown
                  ? { flex: "none", width: effectiveListWidth }
                  : { flex: "1 1 0%", minWidth: 0 }
              }
            >
              {list.node}
            </PaneShell>
          ) : (
            <CollapsedPane
              label={list.label ?? "List"}
              onExpand={() => list.onCollapsedChange?.(false)}
            />
          )
        ) : null}

        {dividersListDetail ? (
          <Divider
            label={`Resize ${list?.label ?? "queue"}`}
            value={effectiveListWidth}
            min={list?.min ?? 200}
            max={list?.max ?? 640}
            direction={1}
            onResize={commitList}
            onReset={() => commitList(listInitial)}
          />
        ) : null}

        {detail ? (
          detailShown ? (
            <PaneShell
              className={cn((fullHeightAside && asideInline) && !(fullHeightDetail && detailShown) && "pt-16", detail.className)}
              style={{ flex: "1 1 0%", minWidth: 0 }}
            >
              {detail.node}
            </PaneShell>
          ) : (
            <CollapsedPane
              label={detail.label ?? "Details"}
              onExpand={() => detail.onCollapsedChange?.(false)}
            />
          )
        ) : null}

        {dividersDetailAside ? (
          <Divider
            label={`Resize ${aside?.label ?? "actions"}`}
            value={effectiveAsideWidth}
            min={aside?.min ?? 260}
            max={aside?.max ?? 520}
            direction={-1}
            onResize={commitAside}
            onReset={() => commitAside(asideInitial)}
          />
        ) : null}

        {aside && asideInline ? (
          asideShown ? (
            <PaneShell className={aside.className} style={{ flex: "none", width: effectiveAsideWidth }}>
              {aside.node}
            </PaneShell>
          ) : (
            <CollapsedPane
              label={aside.label ?? "Actions"}
              onExpand={() => aside.onCollapsedChange?.(false)}
            />
          )
        ) : null}

        {aside && !asideInline ? (
          <AsideOverlay open={asideOpen} onClose={closeAside} label={aside.label ?? "Actions"}>
            {aside.node}
          </AsideOverlay>
        ) : null}
      </div>
    </div>
  )
}

export function OpsPaneHeader({
  title,
  meta,
  action,
  className,
  collapsed,
  onToggleCollapse,
}: {
  title: string
  meta?: React.ReactNode
  action?: React.ReactNode
  className?: string
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-card-line bg-canvas/85 px-4 py-2.5 backdrop-blur-md",
        className,
      )}
    >
      {}
      {onToggleCollapse ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Minimize ${title}`}
          title={collapsed ? "Expand" : "Minimize"}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200",
              collapsed && "-rotate-90",
            )}
          />
          <h2 className="truncate text-micro text-subtle-foreground">{title}</h2>
          {meta ? <span className="truncate text-micro text-faint-foreground">{meta}</span> : null}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="truncate text-micro text-subtle-foreground">{title}</h2>
          {meta ? <span className="truncate text-micro text-faint-foreground">{meta}</span> : null}
        </div>
      )}
      {action}
    </header>
  )
}
