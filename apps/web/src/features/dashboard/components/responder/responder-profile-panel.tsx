import { useNavigate } from "react-router-dom"

import { useAuthSession } from "@/features/auth/auth-session"
import { useResponderUnit } from "@/features/dashboard/hooks/use-responder-unit"
import {
  SheetFactRow,
  SheetList,
  SheetPrimaryButton,
  SheetSectionLabel,
} from "@/features/dashboard/components/sheet-dialog"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"

/**
 * Who the responder is, and nothing else. One identity strip, one details
 * list, one action. Operational content lives on Alerts and Concerns.
 */

export function ResponderProfilePanel() {
  const navigate = useNavigate()
  const { user, signOut } = useAuthSession()
  const unit = useResponderUnit()

  const fullName =
    user?.full_name || `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "Responder"
  const details = [
    { label: "Email", value: user?.email || "Not recorded" },
    { label: "Phone", value: user?.phone_number || "Not recorded" },
    { label: "Barangay", value: user?.barangay || "Not recorded" },
  ]

  return (
    <div className="flex min-w-0 flex-col">
      <section className="flex items-center gap-4">
        <UserAvatar user={user} online={Boolean(user)} size="lg" className="!size-16 text-[32px]" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[20px] font-bold leading-tight tracking-tight text-neutral-900">
            {fullName}
          </h3>
          <p className="mt-1 break-words text-[15px] text-neutral-500">
            {unit.name}
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
        <SheetPrimaryButton tone="accent" onClick={() => void signOut().finally(() => navigate("/sign-in"))}>
          Sign out
        </SheetPrimaryButton>
      </div>
    </div>
  )
}
