import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { ArrowLeftIcon, ChevronRightIcon, XIcon } from "lucide-react"

import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

/**
 * The report-a-post dialog's shape, extracted so every modal in the product
 * reads as the same object: neutral surfaces, one big centred-weight header,
 * soft option rows, and a single pill action.
 *
 * It is a bottom sheet under `sm` and a centred card above it — a phone modal
 * that rises from the thumb, a desktop modal that sits in the middle.
 */

/**
 * The dialog shell on its own — 28px radius, white surface, no chrome of its
 * own. Container pop-ups that bring their own header (the settings workspace,
 * the notifications panel) apply this to their `DialogContent` so they read as
 * the same object as the sheets below without giving up their layout.
 */
export const SHEET_SURFACE =
  "border-neutral-200 bg-white p-0 [border-radius:28px] overflow-hidden"

type SheetFooterRegistrar = (footer: ReactNode | null) => void

const SheetFooterContext = createContext<SheetFooterRegistrar | null>(null)

/**
 * Lets an embedded workspace pin a footer into its owning SheetDialog rather
 * than placing controls inside the scrollable body.
 */
export function useSheetDialogFooter(
  footer: ReactNode | null,
  active = true,
) {
  const registerFooter = useContext(SheetFooterContext)

  useEffect(() => {
    if (!registerFooter || !active) return
    registerFooter(footer)
    return () => registerFooter(null)
  }, [active, footer, registerFooter])

  return Boolean(registerFooter && active)
}

export function SheetDialog({
  open,
  onClose,
  onBack,
  title,
  titleClassName,
  description,
  headerTop,
  backdrop,
  backdropScrim = true,
  backdropInteractive = false,
  titleId = "sheet-dialog-title",
  size = "compact",
  actions,
  children,
  footer,
  className,
  bodyClassName,
  draggable = false,
  showClose = true,
  bodyScrollable = true,
}: {
  open: boolean
  onClose: () => void
  /** Shows the back arrow. Omit on a first-step / single-step dialog. */
  onBack?: () => void
  title: ReactNode
  titleClassName?: string
  description?: ReactNode
  /** Optional centered line shown above the sheet title. */
  headerTop?: ReactNode
  /** Optional visual context rendered behind the sheet (for example a map). */
  backdrop?: ReactNode
  /** Keep the visual context at full brightness when false. */
  backdropScrim?: boolean
  /** Allow the visual context to receive pointer input behind the sheet. */
  backdropInteractive?: boolean
  titleId?: string
  /** `wide` is for dialogs holding a workspace rather than a short list. */
  size?: "compact" | "wide"
  /** Icon buttons seated beside the X. Use `SheetIconButton` so they match. */
  actions?: ReactNode
  children?: ReactNode
  /** Pinned under the scroll area — use for the primary action. */
  footer?: ReactNode
  className?: string
  bodyClassName?: string
  draggable?: boolean
  showClose?: boolean
  bodyScrollable?: boolean
}) {
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [registeredFooter, setRegisteredFooter] = useState<ReactNode>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const startY = useRef(0)
  const lastY = useRef(0)
  const lastT = useRef(0)
  const flickV = useRef(0)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!dragging) return
    function move(e: PointerEvent) {
      onHandlePointerMove(e as unknown as ReactPointerEvent<HTMLDivElement>)
    }
    function up(e: PointerEvent) {
      onHandlePointerUp(e as unknown as ReactPointerEvent<HTMLDivElement>)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
  })

  function beginDrag(clientY: number) {
    startY.current = clientY
    lastY.current = clientY
    lastT.current = performance.now()
    flickV.current = 0
    setDragging(true)
  }

  function onHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggable) return
    beginDrag(e.clientY)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onHeaderPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggable) return
    if ((e.target as HTMLElement).closest("button,input,textarea,a")) return
    beginDrag(e.clientY)
  }

  const registerFooter = useCallback<SheetFooterRegistrar>((next) => {
    setRegisteredFooter(() => next)
  }, [])

  function onHandlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const now = performance.now()
    const dt = Math.max(now - lastT.current, 1)
    flickV.current = (e.clientY - lastY.current) / dt
    lastY.current = e.clientY
    lastT.current = now
    const dy = e.clientY - startY.current
    setDragY(Math.max(dy, 0))
  }

  function onHandlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return
    setDragging(false)
    const dy = e.clientY - startY.current
    const fresh = performance.now() - lastT.current < 120
    const velocity = fresh ? flickV.current : 0
    const height = sheetRef.current?.offsetHeight ?? 600
    if (dy > Math.min(140, height * 0.25) || (velocity > 0.6 && dy > 40)) {
      setDragY(0)
      onClose()
    } else {
      setDragY(0)
    }
  }

  if (typeof document === "undefined" || !open) return null

  const activeFooter = footer ?? registeredFooter

  return createPortal(
    <SheetFooterContext.Provider value={registerFooter}>
      <div className="fixed inset-0 z-[400] flex items-end justify-center sm:items-center sm:p-4">
      {backdrop ? (
        <div
          className={cn(
            "absolute inset-0 z-0 isolate overflow-hidden",
            backdropInteractive ? "pointer-events-auto" : "pointer-events-none"
          )}
          aria-hidden={!backdropInteractive}
        >
          {backdrop}
        </div>
      ) : null}
      {backdropScrim ? (
        <div
          className={cn("absolute inset-0", backdrop ? "bg-black/20" : "bg-black/50")}
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      <div
        ref={sheetRef}
        data-sheet-dialog="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={
          draggable && dragY !== 0
            ? { transform: `translateY(${dragY}px)` }
            : undefined
        }
        className={cn(
          "relative z-10 flex w-full flex-col overflow-hidden bg-white shadow-2xl",
          "max-h-[min(720px,92dvh)] rounded-t-[28px] sm:rounded-[28px]",
          size === "wide" ? "sm:max-w-2xl" : "sm:max-w-[440px]",
          draggable && !dragging && "transition-transform duration-200 ease-out",
          className,
        )}
      >
        {draggable ? (
          <div
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            className="shrink-0 cursor-grab touch-none px-5 pt-2.5 pb-1 active:cursor-grabbing"
          >
            <div
              aria-hidden
              className="mx-auto h-1 w-10 rounded-full bg-neutral-300"
            />
          </div>
        ) : null}
        {/* Back arrow, title, then every icon action seated together on the
            right. The title's left edge lines up with the body when there is
            no back arrow, and with the arrow's label position when there is. */}
        <div
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          className={cn(
            "shrink-0 px-5 pb-3",
            headerTop ? "pt-3" : "pt-5",
            draggable && "touch-none select-none"
          )}
        >
          {headerTop ? (
            <p className="mb-1 truncate text-center text-[12px] leading-4 font-normal text-neutral-500">
              {headerTop}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            {onBack ? (
              <SheetIconButton label="Back" onClick={onBack} className="-ml-2">
                <ArrowLeftIcon className="size-6" strokeWidth={2} />
              </SheetIconButton>
            ) : null}

            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className={cn(
                  "text-[22px] font-bold leading-[1.2] tracking-tight text-neutral-900",
                  titleClassName
                )}
              >
                {title}
              </h2>
              {description ? (
                <p className="mt-1.5 text-[15px] leading-snug text-neutral-500">{description}</p>
              ) : null}
            </div>

            <div className="-mr-2 flex shrink-0 items-center gap-0.5">
              {actions}
              {showClose ? (
                <SheetIconButton label="Close" onClick={onClose}>
                  <XIcon className="size-6" strokeWidth={2} />
                </SheetIconButton>
              ) : null}
              {!actions && !showClose && onBack ? (
                <span className="size-10 shrink-0" aria-hidden />
              ) : null}
            </div>
          </div>
        </div>

        <div className={cn("scrollbar-hide min-h-0 flex-1 overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] [-webkit-overflow-scrolling:touch]", bodyScrollable ? "overflow-y-auto" : "overflow-visible", bodyClassName)}>
          {children}
        </div>

        {activeFooter ? <div className="shrink-0 px-5 pb-6 pt-2">{activeFooter}</div> : null}
      </div>
      </div>
    </SheetFooterContext.Provider>,
    document.body,
  )
}

/** Header icon button. Every icon seated by the X is one of these. */
export function SheetIconButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      data-slot="sheet-icon-button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900",
        className,
      )}
    >
      {children}
    </button>
  )
}

export function SheetList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-[18px] border border-neutral-200", className)}>
      {children}
    </div>
  )
}

/** A row inside `SheetList`. Divider and hover live here, not on the parent. */
export function SheetOptionRow({
  title,
  description,
  onClick,
  showChevron = false,
  selected = false,
  leading,
  trailing,
  tone = "default",
}: {
  title: ReactNode
  description?: ReactNode
  onClick?: () => void
  showChevron?: boolean
  selected?: boolean
  leading?: ReactNode
  /** Right-hand value or control, in place of the chevron. */
  trailing?: ReactNode
  tone?: "default" | "danger"
}) {
  const Tag = onClick ? "button" : "div"
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      aria-pressed={selected || undefined}
      className={cn(
        "flex w-full items-center gap-3.5 border-b border-neutral-200 px-5 py-4 text-left last:border-b-0",
        onClick && "transition-colors hover:bg-neutral-50 active:bg-neutral-100",
        selected && "bg-neutral-50",
      )}
    >
      {leading ? <span className="shrink-0 text-neutral-500">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "text-[16px] font-medium leading-snug",
            tone === "danger" ? "text-sos" : "text-neutral-900",
          )}
        >
          {title}
        </span>
        {description ? (
          <span className="mt-0.5 text-[14px] font-normal leading-snug text-neutral-500">
            {description}
          </span>
        ) : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
      {showChevron ? (
        <ChevronRightIcon
          className="size-5 shrink-0 text-neutral-300"
          strokeWidth={1.75}
          aria-hidden
        />
      ) : null}
    </Tag>
  )
}

/** A setting you can switch, as a row inside a `SheetList`. */
export function SheetToggleRow({
  id,
  label,
  description,
  icon: Icon,
  checked,
  disabled = false,
  busy = false,
  onChange,
}: {
  id: string
  label: string
  description?: string
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>
  checked: boolean
  disabled?: boolean
  busy?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center gap-4 border-b border-neutral-200 px-5 py-4 last:border-b-0">
      <label
        htmlFor={id}
        className={cn("min-w-0 flex-1", disabled ? "cursor-default" : "cursor-pointer")}
      >
        <span
          className={cn(
            "flex items-center gap-1.5 text-[16px] font-medium leading-snug",
            disabled ? "text-neutral-400" : "text-neutral-900",
          )}
        >
          {Icon ? <Icon className="size-4" strokeWidth={2} aria-hidden /> : null}
          {label}
        </span>
        {description ? (
          <span
            className={cn(
              "mt-0.5 block text-[14px] leading-snug",
              disabled ? "text-neutral-400" : "text-neutral-500",
            )}
          >
            {description}
          </span>
        ) : null}
      </label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled || busy}
        aria-busy={busy}
        aria-label={label}
        onCheckedChange={onChange}
        className={cn(
          "shrink-0",
          checked ? "bg-brand-orange" : "bg-neutral-200"
        )}
      />
    </div>
  )
}

/** Label / value fact row — read-only detail inside a `SheetList`. */
export function SheetFactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-neutral-200 px-5 py-4 last:border-b-0">
      <span className="shrink-0 text-[15px] text-neutral-500">{label}</span>
      <span className="min-w-0 truncate text-right text-[15px] font-medium text-neutral-900">
        {value}
      </span>
    </div>
  )
}

/** Quiet section label above a `SheetList`. */
export function SheetSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 mt-6 px-1 text-[13px] font-semibold text-neutral-500 first:mt-0">
      {children}
    </p>
  )
}

/** The one full-width pill action. */
export function SheetPrimaryButton({
  onClick,
  disabled = false,
  tone = "neutral",
  children,
  type = "button",
  className,
}: {
  onClick?: () => void
  disabled?: boolean
  /** `danger` is for destructive confirmations only. */
  tone?: "neutral" | "danger" | "accent"
  children: ReactNode
  type?: "button" | "submit"
  className?: string
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-[52px] w-full items-center justify-center rounded-full text-[17px] font-semibold transition-colors",
        disabled
          ? "cursor-not-allowed bg-neutral-200 text-neutral-400"
            : tone === "danger"
              ? "bg-sos text-white hover:opacity-90 active:scale-[0.99]"
              : tone === "accent"
                ? "bg-brand-orange text-white hover:bg-brand-orange-strong active:scale-[0.99]"
                : "bg-neutral-200 text-neutral-900 hover:bg-neutral-300 active:scale-[0.99]",
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Secondary, quieter action used beside the primary one. */
export function SheetSecondaryButton({
  onClick,
  disabled = false,
  children,
  className,
}: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-[52px] w-full items-center justify-center rounded-full bg-neutral-100 text-[17px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400",
        className,
      )}
    >
      {children}
    </button>
  )
}

/** One-row action hierarchy: secondary first, primary second. */
export function SheetActionRow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex gap-2 [&>*]:min-w-0 [&>*]:flex-1", className)}>
      {children}
    </div>
  )
}

/** Counted textarea, as used by the report flow's details step. */
export function SheetTextarea({
  value,
  onChange,
  max,
  rows = 6,
  placeholder = "",
  autoFocus = false,
}: {
  value: string
  onChange: (next: string) => void
  max: number
  rows?: number
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div className="relative">
      <textarea
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-none rounded-[18px] border-[1.5px] border-neutral-300 bg-white px-4 py-3.5 pb-9 text-[16px] text-neutral-900 outline-none focus:border-neutral-400"
      />
      <span className="pointer-events-none absolute bottom-3 right-4 text-[13px] tabular-nums text-neutral-400">
        {value.length}/{max}
      </span>
    </div>
  )
}
