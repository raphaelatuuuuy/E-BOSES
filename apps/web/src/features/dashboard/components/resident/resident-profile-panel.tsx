"use client"

import { useNavigate } from "react-router-dom"

import { Skeleton } from "@workspace/ui/components/skeleton"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  SheetFactRow,
  SheetList,
  SheetPrimaryButton,
  SheetSectionLabel,
} from "@/features/dashboard/components/sheet-dialog"

/**
 * Who the resident is, and nothing else — shared by the Profile pop-up and the
 * standalone Profile page. One identity strip, one details list, one action.
 * Settings lives in the pop-up header's gear, not in here.
 */

export function ResidentProfilePanel() {
  const navigate = useNavigate()
  const { user, loading, signOut } = useAuthSession()

  if (loading) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-48 rounded-[18px]" />
      </div>
    )
  }

  const fullName =
    user?.full_name || `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "Resident"
  // DB default is often "Pending" — always show the barangay area for this product.
  const rawBarangay = (user?.barangay || "").trim()
  const barangay =
    !rawBarangay || rawBarangay.toLowerCase() === "pending" ? "Marikina Heights" : rawBarangay

  return (
    <div className="flex min-w-0 flex-col">
      <section className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[22px] font-bold text-navy-muted"
        >
          {initials(fullName).charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[20px] font-bold leading-tight tracking-tight text-neutral-900">
            {fullName}
          </h3>
          <p className="mt-1 truncate text-[15px] text-neutral-500">Resident · {barangay}</p>
        </div>
      </section>

      <SheetSectionLabel>Account details</SheetSectionLabel>
      <SheetList>
        <SheetFactRow label="Email" value={user?.email || "Not recorded"} />
        <SheetFactRow label="Phone" value={user?.phone_number || "Not recorded"} />
        <SheetFactRow label="Barangay" value={barangay} />
        <SheetFactRow
          label="Account status"
          value={user?.status === "verified" ? "Verified" : user?.status || "Not recorded"}
        />
      </SheetList>

      <div className="mt-6">
        <SheetPrimaryButton onClick={() => void signOut().finally(() => navigate("/sign-in"))}>
          Sign out
        </SheetPrimaryButton>
      </div>
    </div>
  )
}
