import type { AccountRequest } from "@/features/auth/api"
import {
  SheetList,
  SheetOptionRow,
  SheetSectionLabel,
} from "@/features/dashboard/components/sheet-dialog"

export type AccountFlow =
  | "change-password"
  | "reverify-name"
  | "reverify-email"
  | "reverify-phone"

function orDash(value: string | null | undefined) {
  const text = (value || "").trim()
  return text || "Not set"
}

export function AccountPanel({
  onOpenFlow,
  fullName,
  email,
  phoneE164,
  displayAddress,
  onOpenAddressFlow,
  pendingDeletion,
  onOpenLifecycle,
}: {
  onOpenFlow: (flow: AccountFlow) => void
  fullName: string
  email: string
  phoneE164: string
  displayAddress: string
  onOpenAddressFlow: () => void
  pendingDeletion: AccountRequest | undefined
  onOpenLifecycle: () => void
}) {
  return (
    <>
      <SheetSectionLabel>Your details</SheetSectionLabel>
      <SheetList>
        <SheetOptionRow
          title="Name"
          description={orDash(fullName)}
          onClick={() => onOpenFlow("reverify-name")}
          showChevron
        />
        <SheetOptionRow
          title="Email"
          description={orDash(email)}
          onClick={() => onOpenFlow("reverify-email")}
          showChevron
        />
        <SheetOptionRow
          title="Mobile number"
          description={orDash(phoneE164)}
          onClick={() => onOpenFlow("reverify-phone")}
          showChevron
        />
        <SheetOptionRow
          title="Address"
          description={orDash(displayAddress)}
          onClick={onOpenAddressFlow}
          showChevron
        />
      </SheetList>

      <SheetSectionLabel>Security</SheetSectionLabel>
      <SheetList>
        <SheetOptionRow
          title="Change password"
          onClick={() => onOpenFlow("change-password")}
          showChevron
        />
      </SheetList>

      <SheetSectionLabel>Account</SheetSectionLabel>
      <SheetList>
        <SheetOptionRow
          title={pendingDeletion ? "Deletion requested" : "Deactivate account"}
          description={
            pendingDeletion
              ? "An official is reviewing your request."
              : "Sign-in pauses, reports stay."
          }
          tone={pendingDeletion ? "default" : "danger"}
          onClick={pendingDeletion ? undefined : onOpenLifecycle}
          showChevron={!pendingDeletion}
        />
      </SheetList>
    </>
  )
}
