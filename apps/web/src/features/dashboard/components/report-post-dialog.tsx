"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MoreHorizontal, Flag } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"

import { flagAnnouncementComment, flagConcern, flagEmergencyComment } from "@/features/dashboard/api"
import {
  SheetDialog,
  SheetList,
  SheetOptionRow,
  SheetPrimaryButton,
  SheetTextarea,
} from "@/features/dashboard/components/sheet-dialog"

/** Matches backend ContentFlag.Reason */
export type FlagReasonCode =
  | "irrelevant"
  | "false_info"
  | "sensitive"
  | "abusive"
  | "other"

type ReportSubReason = {
  id: string
  title: string
  description?: string
}

type ReportCategory = {
  id: string
  title: string
  description: string
  apiReason: FlagReasonCode
  children: ReportSubReason[]
}

/** E-Boses / barangay taxonomy — same multi-step shape as Nextdoor samples */
const REPORT_CATEGORIES: ReportCategory[] = [
  {
    id: "spam",
    title: "Spam or commercial content",
    description: "Ads, selling, scams, or repetitive posts",
    apiReason: "irrelevant",
    children: [
      {
        id: "ads",
        title: "Advertising or selling",
        description: "Promoting a product, service, or business",
      },
      {
        id: "spam",
        title: "Spam or repetitive content",
        description: "Same message posted repeatedly",
      },
      {
        id: "scam",
        title: "Scam or phishing",
        description: "Suspicious links, money requests, or fraud",
      },
    ],
  },
  {
    id: "false",
    title: "False or misleading information",
    description: "Untrue claims, wrong location, or deceptive media",
    apiReason: "false_info",
    children: [
      {
        id: "false_incident",
        title: "False information about an incident",
        description: "Claims that misrepresent what happened",
      },
      {
        id: "misleading_media",
        title: "Misleading photo or video",
        description: "Media that doesn’t match the report",
      },
      {
        id: "wrong_location",
        title: "Wrong or fake location",
        description: "Pin or address that doesn’t match the issue",
      },
    ],
  },
  {
    id: "offensive",
    title: "Offensive or abusive content",
    description: "Harassment, hate, threats, or personal attacks",
    apiReason: "abusive",
    children: [
      {
        id: "harassment",
        title: "Harassment or bullying",
        description: "Targeting a person with insults or intimidation",
      },
      {
        id: "hate",
        title: "Hate speech or discrimination",
        description: "Content attacking people based on identity",
      },
      {
        id: "threats",
        title: "Threats or violent language",
        description: "Threats of harm or calls to violence",
      },
      {
        id: "name_calling",
        title: "Name-calling or personal attacks",
        description: "Insults directed at a neighbor or official",
      },
    ],
  },
  {
    id: "sensitive",
    title: "Sensitive or unsafe content",
    description: "Graphic media, private data, or dangerous activity",
    apiReason: "sensitive",
    children: [
      {
        id: "graphic",
        title: "Graphic or disturbing content",
        description: "Images or descriptions that are too graphic",
      },
      {
        id: "privacy",
        title: "Personal information exposed",
        description: "Phone, address, ID, or private details shared",
      },
      {
        id: "danger",
        title: "Dangerous or illegal activity",
        description: "Content that could put people at risk",
      },
    ],
  },
  {
    id: "not_concern",
    title: "Not a community concern",
    description: "Outside the barangay, off-topic, or private dispute",
    apiReason: "irrelevant",
    children: [
      {
        id: "outside_area",
        title: "Outside the supported community area",
        description: "Issue is not in our barangay service area",
      },
      {
        id: "private_dispute",
        title: "Personal or private dispute",
        description: "Not a public community or barangay issue",
      },
      {
        id: "off_topic",
        title: "Off-topic for the community feed",
        description: "Doesn’t relate to neighborhood concerns",
      },
    ],
  },
  {
    id: "other",
    title: "Something else",
    description: "Another reason not listed above",
    apiReason: "other",
    children: [],
  },
]

const NOTE_MAX = 255

type Step = "category" | "subreason" | "details"

export type ReportTarget =
  | { kind: "concern"; concernId: number }
  | { kind: "concern_comment"; concernId: number; commentId: number }
  | { kind: "announcement_comment"; commentId: number }
  | { kind: "emergency_comment"; alertId: number; commentId: number }

type ReportPostDialogProps = {
  open: boolean
  target: ReportTarget | null
  onClose: () => void
  onSubmitted?: () => void
}

export function ReportPostDialog({
  open,
  target,
  onClose,
  onSubmitted,
}: ReportPostDialogProps) {
  const [step, setStep] = useState<Step>("category")
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [subReasonId, setSubReasonId] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [mounted] = useState(true)

  const category = REPORT_CATEGORIES.find((c) => c.id === categoryId) ?? null
  const subReason = category?.children.find((c) => c.id === subReasonId) ?? null

  // Reset the form whenever the dialog (re)opens or targets something new —
  // render-adjust instead of a sync setState effect.
  const dialogKey = open ? JSON.stringify(target) : "closed"
  const [prevDialogKey, setPrevDialogKey] = useState(dialogKey)
  if (prevDialogKey !== dialogKey) {
    setPrevDialogKey(dialogKey)
    if (open) {
      setStep("category")
      setCategoryId(null)
      setSubReasonId(null)
      setNote("")
      setSubmitting(false)
    }
  }

  function selectCategory(cat: ReportCategory) {
    setCategoryId(cat.id)
    setSubReasonId(null)
    setNote("")
    if (cat.children.length === 0) setStep("details")
    else setStep("subreason")
  }

  function selectSubReason(sub: ReportSubReason) {
    setSubReasonId(sub.id)
    setStep("details")
  }

  function goBack() {
    if (step === "details") {
      if (category && category.children.length > 0) {
        setStep("subreason")
        setSubReasonId(null)
        setNote("")
      } else {
        setStep("category")
        setCategoryId(null)
        setNote("")
      }
      return
    }
    if (step === "subreason") {
      setStep("category")
      setCategoryId(null)
      setSubReasonId(null)
      return
    }
    onClose()
  }

  async function handleSubmit() {
    if (!target || !category) return
    const detailTitle = subReason?.title || category.title
    if (category.apiReason === "other" && !note.trim()) {
      toast.error("Please add a short note about why you’re reporting.")
      return
    }
    setSubmitting(true)
    try {
      const noteParts = [detailTitle]
      if (note.trim()) noteParts.push(note.trim())
      const payload = {
        reason: category.apiReason,
        note: noteParts.join(" — ").slice(0, NOTE_MAX),
      }
      if (target.kind === "concern") {
        await flagConcern(target.concernId, payload)
      } else if (target.kind === "concern_comment") {
        await flagConcern(target.concernId, { ...payload, comment: target.commentId })
      } else if (target.kind === "announcement_comment") {
        await flagAnnouncementComment(target.commentId, payload)
      } else {
        await flagEmergencyComment(target.alertId, target.commentId, payload)
      }
      toast.success("Report submitted for review")
      onSubmitted?.()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit report.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!open || !mounted) return null

  const headerTitle =
    step === "category"
      ? "Why are you reporting this?"
      : step === "subreason"
        ? (category?.title ?? "Report")
        : subReason?.title || category?.title || "Report"

  const headerDescription =
    step === "subreason"
      ? "Help us understand what’s happening"
      : step === "details"
        ? "Additional information can help determine if this content violates the community guidelines."
        : undefined

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      onBack={step !== "category" ? goBack : undefined}
      title={headerTitle}
      description={headerDescription}
      titleId="report-post-title"
    >
      {step === "category" ? (
        <SheetList>
          {REPORT_CATEGORIES.map((cat) => (
            <SheetOptionRow
              key={cat.id}
              title={cat.title}
              description={cat.description}
              onClick={() => selectCategory(cat)}
              showChevron={cat.children.length > 0}
            />
          ))}
        </SheetList>
      ) : null}

      {step === "subreason" && category ? (
        <SheetList>
          {category.children.map((sub) => (
            <SheetOptionRow
              key={sub.id}
              title={sub.title}
              description={sub.description}
              onClick={() => selectSubReason(sub)}
              showChevron
            />
          ))}
        </SheetList>
      ) : null}

      {step === "details" ? (
        <div className="flex flex-col gap-4 pt-1">
          <SheetTextarea value={note} onChange={setNote} max={NOTE_MAX} />
          <SheetPrimaryButton disabled={submitting} onClick={() => void handleSubmit()}>
            {submitting ? "Submitting…" : "Submit report"}
          </SheetPrimaryButton>
        </div>
      ) : null}
    </SheetDialog>
  )
}

/**
 * ⋯ menu row — Report + “Flag for review”.
 * Flaticon flag_8655852 → /contents/flag-report.png
 */
export function ReportMenuItem({ onReport }: { onReport: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onReport()
      }}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-neutral-100"
    >
      <Flag className="size-[22px] shrink-0 text-neutral-700" />
      <span className="min-w-0 flex flex-col">
        <span className="text-[14px] font-semibold leading-tight text-neutral-900">
          Report
        </span>
        <span className="mt-0.5 text-[12px] font-normal leading-tight text-neutral-500">
          Flag for review
        </span>
      </span>
    </button>
  )
}

/**
 * Comment ⋯ menu (Edit / Delete). Portaled so the sticky comment send control
 * cannot cover it (home feed + alerts map).
 */
export function CommentMoreMenu({
  open,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)

  // Clear the measured position the moment the menu closes — render-adjust
  // instead of a sync setState at the top of the positioning effect below.
  const [prevMenuOpen, setPrevMenuOpen] = useState(open)
  if (prevMenuOpen !== open) {
    setPrevMenuOpen(open)
    if (!open) setMenuPos(null)
  }

  useEffect(() => {
    if (!open) return
    function place() {
      const btn = rootRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const width = 144
      const left = Math.min(
        Math.max(8, r.right - width),
        window.innerWidth - width - 8,
      )
      // Prefer below; flip above if near bottom so send FAB can't cover Delete
      const below = r.bottom + 4
      const menuH = 88
      const top =
        below + menuH > window.innerHeight - 12
          ? Math.max(8, r.top - menuH - 4)
          : below
      setMenuPos({ top, left })
    }
    const raf = window.requestAnimationFrame(place)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      onOpenChange(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false)
    }
    const t = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc)
      document.addEventListener("keydown", onKey)
    }, 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, onOpenChange])

  const menu =
    open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[320] w-36 rounded-xl bg-white p-1 shadow-[0_8px_28px_rgba(0,0,0,0.12)]"
            style={{ top: menuPos.top, left: menuPos.left }}
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-neutral-800 hover:bg-neutral-100"
              onClick={() => {
                onOpenChange(false)
                window.setTimeout(() => onEdit(), 0)
              }}
            >
              Edit
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-sos hover:bg-sos/10"
              onClick={() => {
                onOpenChange(false)
                window.setTimeout(() => onDelete(), 0)
              }}
            >
              Delete
            </button>
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={rootRef} className="relative z-40 shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex size-6 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        aria-label="Comment options"
        aria-expanded={open}
      >
        <MoreHorizontal className="size-3.5 opacity-70" />
      </button>
      {menu}
    </div>
  )
}

/**
 * In-post ⋯ menu. Menu is portaled to document.body so it is not clipped by
 * post overflow / comment inputs (home feed + alerts map).
 */
export function PostMoreMenu({
  open,
  onOpenChange,
  onReport,
  triggerClassName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReport: () => void
  triggerClassName?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)

  // Clear the measured position the moment the menu closes — render-adjust
  // instead of a sync setState at the top of the positioning effect below.
  const [prevMenuOpen, setPrevMenuOpen] = useState(open)
  if (prevMenuOpen !== open) {
    setPrevMenuOpen(open)
    if (!open) setMenuPos(null)
  }

  useEffect(() => {
    if (!open) return
    function place() {
      const btn = rootRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const width = 220
      const left = Math.min(
        Math.max(8, r.right - width),
        window.innerWidth - width - 8,
      )
      setMenuPos({ top: r.bottom + 4, left })
    }
    const raf = window.requestAnimationFrame(place)
    window.addEventListener("resize", place)
    // Capture scroll on any ancestor so menu tracks / closes cleanly
    window.addEventListener("scroll", place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      onOpenChange(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false)
    }
    // Defer so the opening click doesn’t immediately close
    const t = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc)
      document.addEventListener("keydown", onKey)
    }, 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, onOpenChange])

  const menu =
    open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className={cn(
              "fixed z-[300] w-[220px]",
              "rounded-xl bg-white p-1 shadow-[0_8px_28px_rgba(0,0,0,0.12)]",
            )}
            style={{ top: menuPos.top, left: menuPos.left }}
            role="menu"
          >
            <ReportMenuItem
              onReport={() => {
                onOpenChange(false)
                window.setTimeout(() => onReport(), 0)
              }}
            />
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={rootRef} className="relative z-30 shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "group flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700",
          triggerClassName,
        )}
        aria-label="More"
        aria-expanded={open}
      >
        <MoreHorizontal className="size-7 opacity-55 transition-opacity group-hover:opacity-100" />
      </button>
      {menu}
    </div>
  )
}
