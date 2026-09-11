import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDownIcon } from "lucide-react"
import { toast } from "sonner"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"

import {
  createAccountRequest,
  deactivateAccount,
} from "@/features/auth/api"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  SheetDialog,
  SheetPrimaryButton,
  SheetSecondaryButton,
} from "@/features/dashboard/components/sheet-dialog"

const DEACTIVATE_REASONS = [
  "Too many emails or notifications",
  "Too many negative conversations",
  "Content not relevant to me",
  "Moved or moving",
  "Privacy concerns",
  "Duplicate or accidental account",
  "Too many ads",
  "Posts from too far away",
  "Other",
] as const

type FlowStep =
  | "reason"
  | "means"
  | "feedback"
  | "deleteConfirm"
  | "deleteSuccess"

interface AccountLifecycleFlowProps {
  open: boolean
  onClose: () => void
  onDeactivated: () => void
}

export function AccountLifecycleFlow({
  open,
  onClose,
  onDeactivated,
}: AccountLifecycleFlowProps) {
  const { user } = useAuthSession()
  const communityName = user?.barangay || "your community"
  const [step, setStep] = useState<FlowStep>("reason")
  const [reason, setReason] = useState("")
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reasonPos, setReasonPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const reasonTriggerRef = useRef<HTMLButtonElement>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!reasonOpen) return
    const update = () => {
      const rect = reasonTriggerRef.current?.getBoundingClientRect()
      if (!rect) return
      setReasonPos({ top: rect.bottom + 6, left: rect.left, width: rect.width })
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    function onPointerDown(event: PointerEvent) {
      if (!reasonTriggerRef.current?.contains(event.target as Node)) setReasonOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setReasonOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [reasonOpen])

  function handleBack() {
    if (step === "reason") {
      onClose()
      return
    }
    if (step === "means") {
      setStep("reason")
      return
    }
    if (step === "feedback") {
      setStep("means")
      return
    }
    if (step === "deleteConfirm") {
      setStep("means")
      return
    }
    if (step === "deleteSuccess") {
      onClose()
    }
  }

  async function handleDeactivate() {
    if (!reason.trim()) {
      toast.error("Please select a reason for leaving.")
      setStep("reason")
      return
    }
    setBusy(true)
    try {
      await deactivateAccount({ reason, feedback })
      toast.success("Account deactivated")
      onDeactivated()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not deactivate account.",
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteRequest() {
    setBusy(true)
    try {
      await createAccountRequest({
        type: "deletion",
        note: reason
          ? `Permanent deletion requested. Prior reason: ${reason}. ${feedback ? `Feedback: ${feedback}` : ""}`.trim()
          : "Resident requested permanent account deletion from Settings.",
      })
      setStep("deleteSuccess")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not submit deletion request.",
      )
    } finally {
      setBusy(false)
    }
  }

  const headerTitle =
    step === "deleteSuccess"
      ? ""
      : step === "deleteConfirm"
        ? "Delete account"
        : "Deactivate account"

  if (!open) return null

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      onBack={step === "deleteSuccess" ? undefined : handleBack}
      title={headerTitle}
      size="compact"
      footer={
        step === "reason" ? (
          <div className="flex gap-2">
            <SheetSecondaryButton onClick={onClose} className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]">
              Cancel
            </SheetSecondaryButton>
            <SheetPrimaryButton
              tone="accent"
              type="button"
              disabled={!reason}
              onClick={() => setStep("means")}
              className="flex-1 text-[15px]"
            >
              Continue
            </SheetPrimaryButton>
          </div>
        ) : step === "means" ? (
          <div className="flex gap-2">
            <SheetSecondaryButton onClick={onClose} className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]">
              Cancel
            </SheetSecondaryButton>
            <SheetPrimaryButton
              tone="accent"
              type="button"
              disabled={!confirmed}
              onClick={() => setStep("feedback")}
              className="flex-1 text-[15px]"
            >
              Continue with deactivation
            </SheetPrimaryButton>
          </div>
        ) : step === "feedback" ? (
          <div className="flex gap-2">
            <SheetSecondaryButton onClick={onClose} className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]">
              Cancel
            </SheetSecondaryButton>
            <SheetPrimaryButton
              tone="accent"
              type="button"
              disabled={busy}
              onClick={() => void handleDeactivate()}
              className="flex-1 bg-sos text-[15px] text-white hover:bg-sos/85"
            >
              {busy ? "Deactivating\u2026" : "Deactivate my account"}
            </SheetPrimaryButton>
          </div>
        ) : step === "deleteConfirm" ? (
          <div className="flex gap-2">
            <SheetSecondaryButton
              onClick={() => setStep("means")}
              className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]"
            >
              Cancel
            </SheetSecondaryButton>
            <SheetPrimaryButton
              tone="accent"
              type="button"
              disabled={busy}
              onClick={() => void handleDeleteRequest()}
              className="flex-1 bg-sos text-[15px] text-white hover:bg-sos/85"
            >
              {busy ? "Deleting\u2026" : "Delete"}
            </SheetPrimaryButton>
          </div>
        ) : step === "deleteSuccess" ? (
          <SheetPrimaryButton
            tone="accent"
            type="button"
            onClick={onClose}
            className="flex-1 text-[15px]"
          >
            Done
          </SheetPrimaryButton>
        ) : null
      }
    >
      {step === "reason" ? (
        <div className="space-y-4">
          <div className="text-center">
            <h2 className="text-[1.35rem] font-bold leading-tight tracking-tight text-neutral-900">
              We&apos;re sorry to see you go!
            </h2>
            <p className="mt-2 text-[14px] text-neutral-500">
              Please tell us why you&apos;re leaving
            </p>
          </div>

          <div>
            <button
              ref={reasonTriggerRef}
              type="button"
              onClick={() => setReasonOpen((v) => !v)}
              className={cn(
                "flex h-12 w-full items-center justify-between rounded-[14px] border-[1.5px] bg-white px-4 text-left text-[15px] transition-colors",
                reasonOpen
                  ? "border-neutral-400"
                  : "border-neutral-300 hover:border-neutral-400",
                reason ? "text-neutral-900" : "text-neutral-400",
              )}
            >
              <span className="truncate">
                {reason || "Reason for leaving"}
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-5 shrink-0 text-neutral-500 transition-transform",
                  reasonOpen && "rotate-180",
                )}
              />
            </button>

            {reasonOpen && reasonPos && typeof document !== "undefined"
              ? createPortal(
                  <div
                    className="scrollbar-hide overflow-y-auto rounded-[14px] border-[1.5px] border-neutral-200 bg-white py-1 shadow-lg"
                    style={{
                      position: "fixed",
                      top: Math.min(reasonPos.top, window.innerHeight - 420),
                      left: reasonPos.left,
                      width: reasonPos.width,
                      maxHeight: 400,
                      zIndex: 500,
                    }}
                  >
                    <p className="px-4 pb-1 pt-3 text-[13px] font-medium text-neutral-400">
                      Reasons for deactivating
                    </p>
                    {DEACTIVATE_REASONS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          setReason(item)
                          setReasonOpen(false)
                          setStep("means")
                        }}
                        className={cn(
                          "flex w-full px-4 py-3 text-left text-[15px] font-medium text-neutral-900 transition-colors hover:bg-neutral-50",
                          reason === item && "bg-neutral-50",
                        )}
                      >
                        {item}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )
              : null}
          </div>
        </div>
      ) : null}

      {step === "means" ? (
        <div className="space-y-4">
          <h2 className="text-[1.2rem] font-bold leading-tight tracking-tight text-neutral-900">
            Deactivating your account means…
          </h2>
          <ul className="list-disc space-y-3 pl-5 text-[14px] leading-relaxed text-neutral-700">
            <li>
              You&apos;ll lose access to reports, SOS alerts, messages, and
              community feed activity.
            </li>
            <li>
              Your profile becomes unsearchable and you&apos;ll be
              unsubscribed from notifications. Previous community posts may
              still appear in the feed.
            </li>
            <li>
              You will no longer access barangay events, the alerts map, or
              other E-Boses services for {communityName}.
            </li>
          </ul>

          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              checked={confirmed}
              onChange={(e) => setConfirmed(e.currentTarget.checked)}
              className="mt-0.5"
              aria-label="Yes, I want to deactivate my account"
            />
            <span className="text-[14px] font-medium text-neutral-900">
              Yes, I want to deactivate my account
            </span>
          </label>

          <p className="text-[13px] leading-snug text-neutral-500">
            <span className="font-medium text-neutral-700">Note:</span> You
            can restore your account by logging in again.
          </p>

          <div className="border-t border-neutral-100 pt-4">
            <p className="text-[13px] leading-relaxed text-neutral-500">
              To delete your account,{" "}
              <button
                type="button"
                onClick={() => setStep("deleteConfirm")}
                className="font-medium text-neutral-800 underline underline-offset-2 hover:text-sos"
              >
                click here
              </button>
              . Deleting your account cannot be undone; deleted accounts cannot
              be restored.
            </p>
          </div>
        </div>
      ) : null}

      {step === "feedback" ? (
        <div className="space-y-4">
          <h2 className="text-[1.2rem] font-bold leading-tight tracking-tight text-neutral-900">
            One last thing
          </h2>
          <p className="text-[14px] leading-relaxed text-neutral-600">
            Your feedback is incredibly valuable to make E-Boses better for
            everyone. We&apos;d love to hear any other suggestions you have
            for improving our platform.
          </p>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={200}
            rows={4}
            placeholder="Optional feedback"
            className="w-full resize-none rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[15px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-500 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          />
        </div>
      ) : null}

      {step === "deleteConfirm" ? (
        <div className="space-y-4">
          <h2 className="text-[1.2rem] font-bold leading-tight tracking-tight text-neutral-900">
            Delete account?
          </h2>
          <p className="text-[14px] leading-relaxed text-neutral-600">
            This will permanently delete your account and associated data.
            This cannot be undone. Our team will process your request within
            once any reports you have open are closed.
          </p>
        </div>
      ) : null}

      {step === "deleteSuccess" ? (
        <div className="space-y-4 text-center">
          <h2 className="text-[1.35rem] font-bold leading-tight tracking-tight text-neutral-900">
            Account deletion request successful
          </h2>
          <p className="text-[14px] leading-relaxed text-neutral-600">
            We&apos;ve received your request to delete your account and will
            process your request within once any reports you have open are closed.
          </p>
        </div>
      ) : null}
    </SheetDialog>
  )
}
