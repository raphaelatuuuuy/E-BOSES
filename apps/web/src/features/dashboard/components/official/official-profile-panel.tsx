"use client"

import { useNavigate } from "react-router-dom"

import { Skeleton } from "@workspace/ui/components/skeleton"

import { useAuthSession } from "@/features/auth/auth-session"
import { displayUnit } from "@/features/dashboard/lib/position"
import {
  SheetFactRow,
  SheetList,
  SheetPrimaryButton,
  SheetSectionLabel,
} from "@/features/dashboard/components/sheet-dialog"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"

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
  ]

  return (
    <div className="flex min-w-0 flex-col">
      <section className="flex items-center gap-4">
        <UserAvatar user={user} online={Boolean(user)} showStatus={false} size="lg" className="!size-16 text-[22px]" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[20px] font-bold leading-tight tracking-tight text-neutral-900">
            {fullName}
          </h3>
          <p className="mt-1 break-words text-[15px] text-neutral-500">
            {displayUnit(user)}
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
        <SheetPrimaryButton tone="accent" onClick={() => void signOut().finally(() => navigate("/sign-in"))}>
          Sign out
        </SheetPrimaryButton>
      </div>
    </div>
  )
}
