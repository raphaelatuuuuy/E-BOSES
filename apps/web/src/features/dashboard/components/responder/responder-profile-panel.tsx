import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Skeleton } from "@workspace/ui/components/skeleton"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { useResponderUnit } from "@/features/dashboard/hooks/use-responder-unit"
import {
  getActiveResponderShift,
  type ResponderShift,
} from "@/features/dashboard/emergency-api"
import { State } from "@/features/dashboard/components/responder/dispatch-surface"
import {
  SheetFactRow,
  SheetList,
  SheetPrimaryButton,
  SheetSectionLabel,
} from "@/features/dashboard/components/sheet-dialog"

/**
 * Who the responder is, and nothing else. One identity strip, one details
 * list, one action. Operational content lives on Map and Shift.
 */

export function ResponderProfilePanel() {
  const navigate = useNavigate()
  const { user, loading, signOut } = useAuthSession()
  const unit = useResponderUnit()
  const [activeShift, setActiveShift] = useState<ResponderShift | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loading) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void getActiveResponderShift()
        .then((nextShift) => {
          if (cancelled) return
          setActiveShift(nextShift)
        })
        .catch((error) => {
          toast.error(
            error instanceof Error ? error.message : "Responder profile could not be loaded.",
          )
        })
        .finally(() => {
          if (!cancelled) setLoaded(true)
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [loading])

  const fullName =
    user?.full_name || `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "Responder"
  const onDuty = Boolean(activeShift || unit.summary?.is_on_duty || user?.is_on_duty)

  if (!loaded) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-20 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  const details = [
    { label: "Email", value: user?.email || "Not recorded" },
    { label: "Phone", value: user?.phone_number || "Not recorded" },
    { label: "Barangay", value: user?.barangay || "Not recorded" },
    {
      label: "Account status",
      value: user?.status === "verified" ? "Verified" : user?.status || "Not recorded",
    },
  ]

  return (
    <div className="flex min-w-0 flex-col">
      <section className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[20px] font-semibold text-neutral-700"
        >
          {initials(fullName, "R")}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[20px] font-bold leading-tight tracking-tight text-neutral-900">
            {fullName}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <State label={onDuty ? "On duty" : "Off duty"} tone={onDuty ? "settled" : "idle"} />
            <span className="text-[15px] text-neutral-500">{unit.name}</span>
          </p>
        </div>
      </section>

      {!unit.assigned ? (
        <p className="mt-4 text-[15px] leading-relaxed text-neutral-500">
          No unit yet. A barangay official assigns one before you can be dispatched.
        </p>
      ) : null}

      <SheetSectionLabel>Account details</SheetSectionLabel>
      <SheetList>
        {details.map((entry) => (
          <SheetFactRow key={entry.label} label={entry.label} value={entry.value} />
        ))}
      </SheetList>

      <div className="mt-6">
        <SheetPrimaryButton onClick={() => void signOut().finally(() => navigate("/sign-in"))}>
          Sign out
        </SheetPrimaryButton>
      </div>
    </div>
  )
}
