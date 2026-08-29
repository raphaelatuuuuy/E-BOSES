import { useState } from "react"
import { CheckIcon, SearchIcon, Share2Icon } from "lucide-react"
import { toast } from "sonner"

import type { Concern } from "@/features/dashboard/api"
import { SheetDialog, SheetPrimaryButton, SheetSecondaryButton } from "@/features/dashboard/components/sheet-dialog"

function unitInitials(name: string, shortName?: string | null) {
  const compact = (shortName || "").trim()
  if (compact) return compact.slice(0, 4).toUpperCase()
  const words = name.split(/\s+/).filter(Boolean)
  if (!words.length) return "—"
  return words.length === 1
    ? words[0].slice(0, 2).toUpperCase()
    : words.map((word) => word[0]).join("").slice(0, 4).toUpperCase()
}

function reportUrl(publicId: string) {
  if (typeof window === "undefined") return `/dashboard/reports/${publicId}`
  return `${window.location.origin}/dashboard/reports/${publicId}`
}

export function ReportDetailsDialog({
  open,
  report,
  onClose,
  onTrack,
  onOpenEmergency,
  canShare = false,
}: {
  open: boolean
  report: Concern
  onClose: () => void
  onTrack: () => void
  onOpenEmergency?: () => void
  canShare?: boolean
}) {
  const [shared, setShared] = useState(false)
  const emergency = report.escalated_alert ?? null
  const unit = emergency?.responding_unit
    ? {
        name: emergency.responding_unit.name,
        shortName: emergency.responding_unit.short_name,
      }
    : report.assigned_department
      ? {
          name: report.assigned_department.name,
          shortName: report.assigned_department.short_name,
        }
      : { name: emergency ? "Emergency Response" : "Barangay Response Team", shortName: emergency ? "ER" : "BRT" }

  async function handleShare() {
    const url = reportUrl(report.public_id)
    const canUseNativeShare = typeof navigator !== "undefined" && "share" in navigator
    try {
      if (canUseNativeShare) {
        await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share({
          title: report.title || "Community report",
          text: report.summary || report.description || "Community report",
          url,
        })
      } else {
        await navigator.clipboard.writeText(url)
      }
      setShared(true)
      toast.success(canUseNativeShare ? "Share sheet opened." : "Report link copied.")
      window.setTimeout(() => setShared(false), 1800)
    } catch (error) {
      // Closing the native share sheet is a user cancellation, not an error.
      if (error instanceof DOMException && error.name === "AbortError") return
      toast.error("Could not share this report.")
    }
  }

  return (
    <SheetDialog open={open} onClose={onClose} title="Report details" size="compact">
      <div className="flex flex-col items-center px-1 pb-1 pt-3 text-center">
        <p className="max-w-[18rem] text-[18px] font-semibold leading-snug text-neutral-900">
          {emergency ? "Your report was escalated to" : "Your report was assigned to"}
        </p>

        <>
          <span className="mt-6 flex size-16 items-center justify-center rounded-full bg-slate-soft text-[17px] font-bold tracking-tight text-navy-muted">
            {unitInitials(unit.name, unit.shortName)}
          </span>
          <p className="mt-3 max-w-[19rem] text-[16px] font-semibold leading-snug text-neutral-900">
            {unit.name}
          </p>
        </>

        {emergency ? (
          <div className="mt-4 rounded-[14px] border border-sos/25 bg-sos/10 px-3.5 py-2.5 text-[13px] font-medium leading-5 text-sos">
            Emergency response has been notified.
          </div>
        ) : null}

        <div className="mt-7 w-full space-y-2">
          {emergency ? (
            <SheetPrimaryButton
              tone="danger"
              onClick={() => {
                onClose()
                onOpenEmergency?.()
              }}
            >
              Open emergency
            </SheetPrimaryButton>
          ) : null}
          {!emergency && canShare ? (
            <SheetSecondaryButton className="mt-0" onClick={() => void handleShare()}>
              {shared ? <CheckIcon className="mr-2 size-5" strokeWidth={2.5} /> : <Share2Icon className="mr-2 size-5" strokeWidth={2} />}
              {shared ? "Link ready" : "Share report"}
            </SheetSecondaryButton>
          ) : null}
          <SheetPrimaryButton
            tone="accent"
            onClick={() => {
              onClose()
              onTrack()
            }}
          >
            <SearchIcon className="mr-2 size-5" strokeWidth={2.25} />
            Track report
          </SheetPrimaryButton>
        </div>
      </div>
    </SheetDialog>
  )
}
