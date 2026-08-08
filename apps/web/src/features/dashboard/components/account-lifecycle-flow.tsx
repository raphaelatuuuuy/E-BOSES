import { useState } from "react"
import {
  ChevronLeftIcon,
  ChevronDownIcon,
  Loader2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"

import {
  createAccountRequest,
  deactivateAccount,
} from "@/features/auth/api"

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
  onClose: () => void
  onDeactivated: () => void
}

export function AccountLifecycleFlow({
  onClose,
  onDeactivated,
}: AccountLifecycleFlowProps) {
  const [step, setStep] = useState<FlowStep>("reason")
  const [reason, setReason] = useState("")
  const [reasonOpen, setReasonOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [busy, setBusy] = useState(false)

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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="mx-auto flex h-full w-full max-w-lg flex-col px-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.5rem))] pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6">
        {step !== "deleteSuccess" ? (
          <header className="relative mb-1 flex h-12 shrink-0 items-center justify-center">
            <button
              type="button"
              onClick={handleBack}
              className="absolute left-0 flex size-10 items-center justify-center rounded-full text-neutral-800 hover:bg-neutral-100"
              aria-label="Back"
            >
              <ChevronLeftIcon className="size-6" strokeWidth={2.25} />
            </button>
            <h1 className="text-[17px] font-semibold tracking-tight text-neutral-900">
              {headerTitle}
            </h1>
          </header>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* ── Reason ── */}
          {step === "reason" ? (
            <div className="flex flex-col items-center pt-6">
              {/* Spacer keeps title in the same vertical band as when the illustration was present */}
              <div className="h-28 w-full max-w-[280px]" aria-hidden />
              <h2 className="mt-6 text-center text-[1.65rem] font-bold leading-tight tracking-tight text-neutral-900">
                We&apos;re sorry to see you go!
              </h2>
              <p className="mt-2 text-center text-[15px] text-neutral-500">
                Please tell us why you&apos;re leaving
              </p>

              <div className="relative mt-6 w-full">
                <button
                  type="button"
                  onClick={() => setReasonOpen((v) => !v)}
                  className={cn(
                    "flex h-12 w-full items-center justify-between rounded-xl border bg-white px-4 text-left text-[15px] transition-colors",
                    reasonOpen
                      ? "border-neutral-800"
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

                {reasonOpen ? (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-[min(50vh,360px)] overflow-y-auto rounded-2xl border border-neutral-200 bg-white py-1 shadow-[0_12px_40px_rgba(15,23,42,0.14)]">
                    <p className="px-4 pb-1 pt-3 text-[13px] font-semibold text-neutral-500">
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
                          "flex w-full px-4 py-3.5 text-left text-[15px] font-medium text-neutral-900 transition-colors hover:bg-neutral-50",
                          reason === item && "bg-neutral-50",
                        )}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {reason && !reasonOpen ? (
                <button
                  type="button"
                  onClick={() => setStep("means")}
                  className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white hover:bg-brand-orange-strong"
                >
                  Continue
                </button>
              ) : null}
            </div>
          ) : null}

          {/* ── Means ── */}
          {step === "means" ? (
            <div className="flex flex-col pt-4">
              <h2 className="text-[1.55rem] font-bold leading-tight tracking-tight text-neutral-900">
                Deactivating your account means…
              </h2>
              <ul className="mt-5 list-disc space-y-3.5 pl-5 text-[15px] leading-relaxed text-neutral-700">
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
                  other E-Boses services for Marikina Heights.
                </li>
              </ul>

              <label className="mt-6 flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.currentTarget.checked)}
                  className="mt-0.5"
                  aria-label="Yes, I want to deactivate my account"
                />
                <span className="text-[15px] font-medium text-neutral-900">
                  Yes, I want to deactivate my account
                </span>
              </label>

              <p className="mt-3 text-[13px] leading-snug text-neutral-500">
                <span className="font-semibold text-neutral-700">Note:</span> You
                can restore your account by logging in again.
              </p>

              <button
                type="button"
                disabled={!confirmed}
                onClick={() => setStep("feedback")}
                className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white transition-colors hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"
              >
                Continue with deactivation
              </button>

              <button
                type="button"
                onClick={onClose}
                className="mt-2 flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold text-neutral-700 hover:bg-neutral-100"
              >
                Cancel
              </button>

              <p className="mt-6 border-t border-neutral-200 pt-5 text-[13px] leading-relaxed text-neutral-500">
                To delete your account,{" "}
                <button
                  type="button"
                  onClick={() => setStep("deleteConfirm")}
                  className="font-semibold text-neutral-800 underline underline-offset-2 hover:text-red-700"
                >
                  click here
                </button>
                . Deleting your account cannot be undone; deleted accounts cannot
                be restored.
              </p>
            </div>
          ) : null}

          {/* ── Feedback + confirm deactivate ── */}
          {step === "feedback" ? (
            <div className="flex flex-col pt-4">
              <h2 className="text-[1.55rem] font-bold leading-tight tracking-tight text-neutral-900">
                One last thing
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">
                Your feedback is incredibly valuable to make E-Boses better for
                everyone. We&apos;d love to hear any other suggestions you have
                for improving our platform.
              </p>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                maxLength={200}
                rows={5}
                placeholder="Optional feedback"
                className="mt-5 w-full resize-none rounded-xl border border-neutral-300 bg-white px-4 py-3 text-[15px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-500"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDeactivate()}
                className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-red-600 text-[15px] font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                    Deactivating…
                  </>
                ) : (
                  "Deactivate my account"
                )}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="mt-2 flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : null}

          {/* ── Delete confirm ── */}
          {step === "deleteConfirm" ? (
            <div className="flex flex-col pt-6">
              <h2 className="text-[1.55rem] font-bold leading-tight tracking-tight text-neutral-900">
                Delete account?
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">
                This will permanently delete your account and associated data.
                This cannot be undone. Our team will process your request within
                72 hours.
              </p>
              <div className="mt-10 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStep("means")}
                  className="inline-flex h-11 items-center justify-center rounded-full px-5 text-[15px] font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDeleteRequest()}
                  className="inline-flex h-11 items-center justify-center rounded-full bg-red-600 px-6 text-[15px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    "Delete"
                  )}
                </button>
              </div>
            </div>
          ) : null}

          {/* ── Delete success ── */}
          {step === "deleteSuccess" ? (
            <div className="flex flex-col pt-10">
              <h2 className="text-[1.65rem] font-bold leading-tight tracking-tight text-neutral-900">
                Account deletion request successful
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-neutral-600">
                We&apos;ve received your request to delete your account and will
                process your request within 72 hours.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-10 flex h-12 w-full items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white hover:bg-brand-orange-strong"
              >
                Done
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}