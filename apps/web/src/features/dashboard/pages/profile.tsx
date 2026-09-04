import { SettingsIcon } from "lucide-react"

import { ResidentProfilePanel } from "@/features/dashboard/components/resident/resident-profile-panel"
import { openSettingsDialog } from "@/features/dashboard/components/settings/settings-event"
import { usePageTitle } from "@/hooks/use-page-title"

/**
 * Who the resident is, and nothing else. The content lives in
 * `ResidentProfilePanel` (shared with the account pop-up and the mobile
 * header sheet) so the page and the pop-up can never drift apart. The gear
 * mirrors the pop-up header's Settings action.
 */

export default function ProfilePage() {
  usePageTitle("Profile")

  return (
    <main
      className="min-h-full flex-1 bg-canvas p-4 pb-6 md:p-6 md:pb-8"
    >
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between border-b border-card-line pb-3">
          <h1 className="text-lg font-semibold text-foreground">Profile</h1>
          <button
            type="button"
            onClick={() => openSettingsDialog()}
            aria-label="Settings"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted"
          >
            <SettingsIcon className="size-4" />
          </button>
        </div>
        <ResidentProfilePanel />
      </div>
    </main>
  )
}
