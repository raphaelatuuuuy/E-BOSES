import { LogInIcon, UserPlusIcon, UserRoundIcon } from "lucide-react"

import {
  SheetDialog,
  SheetList,
  SheetOptionRow,
} from "@/features/dashboard/components/sheet-dialog"

export function IdentityDialog({
  open,
  onClose,
  onGuest,
  onSignUp,
  onSignIn,
}: {
  open: boolean
  onClose: () => void
  onGuest: () => void
  onSignUp: () => void
  onSignIn: () => void
}) {
  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      title="Report as"
      description="Choose how you want to send this concern."
    >
      <div className="space-y-4">
        <SheetList>
          <SheetOptionRow
            leading={<UserRoundIcon className="size-5" strokeWidth={1.8} />}
            title="Continue as guest"
            description="No account required."
            onClick={onGuest}
            showChevron
          />
          <SheetOptionRow
            leading={<UserPlusIcon className="size-5" strokeWidth={1.8} />}
            title="Create an account"
            description="Save reports and receive updates."
            onClick={onSignUp}
            showChevron
          />
          <SheetOptionRow
            leading={<LogInIcon className="size-5" strokeWidth={1.8} />}
            title="Sign in"
            description="Use your existing E-Boses account."
            onClick={onSignIn}
            showChevron
          />
        </SheetList>
      </div>
    </SheetDialog>
  )
}
