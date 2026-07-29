import { useRef } from "react"
import { Plus, ShieldCheckIcon } from "lucide-react"

import OcrTemplateBuilderPage from "@/features/ocr/ocr-template-builder-page"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  ConfigHeroAction,
  ConfigShell,
} from "@/features/dashboard/components/config/config-shell"

/**
 * ID & proof setup.
 *
 * The verification queue tab is gone. It duplicated work the concern and
 * account flows already own: cases needing a human decision surface as normal
 * account review, and having a second inbox meant officials had to remember to
 * check a place nothing else pointed at. What remains here is configuration —
 * which proof types the barangay accepts and how each one is read.
 */
export default function OfficialIdProofWorkspacePage() {
  usePageTitle("ID & proof setup")
  const ocrRef = useRef<{ startAddProofType: () => void }>(null)

  return (
    <ConfigShell
      icon={ShieldCheckIcon}
      eyebrow="Trust & privacy"
      title="ID & proof setup"
      description="Which documents a resident can use to prove they live here, and which details are read from each one."
      action={
        <ConfigHeroAction
          icon={Plus}
          onClick={() => ocrRef.current?.startAddProofType()}
        >
          Add proof type
        </ConfigHeroAction>
      }
    >
      <div className="overflow-hidden rounded-2xl border border-card-line bg-white">
        <OcrTemplateBuilderPage ref={ocrRef} />
      </div>
    </ConfigShell>
  )
}
