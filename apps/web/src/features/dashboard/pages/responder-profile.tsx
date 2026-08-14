import { MOBILE_BAR_CLEARANCE } from "@/features/dashboard/lib/shell"
import { ResponderProfilePanel } from "@/features/dashboard/components/responder/responder-profile-panel"
import { usePageTitle } from "@/hooks/use-page-title"

/**
 * Who the responder is, and nothing else. The content lives in
 * `ResponderProfilePanel` (shared with the sidebar account pop-up and the
 * mobile header sheet) so the page and the pop-up can never drift apart.
 */

export default function ResponderProfilePage() {
  usePageTitle("Responder Profile")

  return (
    <main
      className="min-h-full flex-1 bg-canvas p-4 md:p-6"
      style={{ paddingBottom: `calc(${MOBILE_BAR_CLEARANCE} + 1.5rem)` }}
    >
      <div className="mx-auto max-w-3xl">
        <ResponderProfilePanel />
      </div>
    </main>
  )
}