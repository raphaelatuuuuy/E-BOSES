"use client"

import { useNavigate } from "react-router-dom"

import { Skeleton } from "@workspace/ui/components/skeleton"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { displayPosition } from "@/features/dashboard/lib/position"
import {
  SheetFactRow,
  SheetList,
  SheetPrimaryButton,
  SheetSectionLabel,
} from "@/features/dashboard/components/sheet-dialog"

/**
 * Who the official is, and nothing else. One identity strip, one details
 * list, one action. Settings lives in the pop-up header's gear, not in here.
 */

export function OfficialProfilePanel() {
  const navigate = useNavigate()
  const { user, loading, signOut } = useAuthSession()

  if (loading) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
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

  const fullName = user?.full_name || "Barangay official"
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
          {initials(fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[20px] font-bold leading-tight tracking-tight text-neutral-900">
            {fullName}
          </h3>
          <p className="mt-1 truncate text-[15px] text-neutral-500">
            Barangay official · {displayPosition(user)}
          </p>
        </div>
      </section>

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