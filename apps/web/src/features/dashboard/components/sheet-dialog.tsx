import { useEffect, type ReactNode } from "react"
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

export function SheetDialog({
  open,
  onClose,
  onBack,
  title,
  description,
  titleId = "sheet-dialog-title",
  size = "compact",
  actions,
  children,
  footer,
  className,
}: {
  open: boolean
  onClose: () => void
  /** Shows the back arrow. Omit on a first-step / single-step dialog. */
  onBack?: () => void
  title: string
  description?: ReactNode
  titleId?: string
  /** `wide` is for dialogs holding a workspace rather than a short list. */
  size?: "compact" | "wide"
  /** Icon buttons seated beside the X. Use `SheetIconButton` so they match. */
  actions?: ReactNode
  children?: ReactNode
  /** Pinned under the scroll area — use for the primary action. */
  footer?: ReactNode
  className?: string
}) {
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

  if (typeof document === "undefined" || !open) return null

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative z-10 flex w-full flex-col overflow-hidden bg-white shadow-2xl",
          "max-h-[min(720px,92vh)] rounded-t-[28px] sm:rounded-[28px]",
          size === "wide" ? "max-w-2xl" : "max-w-[440px]",
          className,
        )}
      >
        {/* Back arrow, title, then every icon action seated together on the
            right. The title's left edge lines up with the body when there is
            no back arrow, and with the arrow's label position when there is. */}
        <div className="flex shrink-0 items-start gap-2 px-5 pb-3 pt-5">
          {onBack ? (
            <SheetIconButton label="Back" onClick={onBack} className="-ml-2">
              <ArrowLeftIcon className="size-6" strokeWidth={2} />
            </SheetIconButton>
          ) : null}

          <div className="min-w-0 flex-1 pt-1.5">
            <h2
              id={titleId}
              className="text-[22px] font-bold leading-[1.2] tracking-tight text-neutral-900"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-1.5 text-[15px] leading-snug text-neutral-500">{description}</p>
            ) : null}
          </div>

          <div className="-mr-2 flex shrink-0 items-center gap-0.5">
            {actions}
            <SheetIconButton label="Close" onClick={onClose}>
              <XIcon className="size-6" strokeWidth={2} />
            </SheetIconButton>
          </div>
        </div>

        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
          {children}
        </div>

        {footer ? <div className="shrink-0 px-5 pb-6 pt-2">{footer}</div> : null}
      </div>
    </div>,
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

/**
 * One bordered container, rows divided by hairlines — never a stack of
 * separate pills with gaps between them. This is the design system's hairline
 * list, scoped to dialog padding.
 */
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
  checked,
  disabled = false,
  busy = false,
  onChange,
}: {
  id: string
  label: string
  description?: string
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
            "block text-[16px] font-medium leading-snug",
            disabled ? "text-neutral-400" : "text-neutral-900",
          )}
        >
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
}: {
  onClick?: () => void
  disabled?: boolean
  /** `danger` is for destructive confirmations only. */
  tone?: "neutral" | "danger" | "accent"
  children: ReactNode
  type?: "button" | "submit"
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
      )}
    >
      {children}
    </button>
  )
}

/** Secondary, quieter action stacked under the primary one. */
export function SheetSecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 flex h-[52px] w-full items-center justify-center rounded-full text-[17px] font-semibold text-neutral-600 transition-colors hover:bg-neutral-100"
    >
      {children}
    </button>
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
