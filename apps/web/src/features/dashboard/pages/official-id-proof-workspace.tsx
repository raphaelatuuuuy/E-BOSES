import { useEffect, useRef } from "react"
import { IdCardLanyard, Plus } from "lucide-react"

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
export default function OfficialIdProofWorkspacePage({ embedded = false }: { embedded?: boolean }) {
  usePageTitle("ID & proof setup")
  const ocrRef = useRef<{ startAddProofType: () => void }>(null)

  useEffect(() => {
    if (!embedded) return
    const handle = () => ocrRef.current?.startAddProofType()
    window.addEventListener("configuration-primary-action", handle)
    return () => window.removeEventListener("configuration-primary-action", handle)
  }, [embedded])

  return (
    <ConfigShell
      embedded={embedded}
      hideEmbeddedAction={embedded}
      icon={IdCardLanyard}
      eyebrow="Operations"
      title="ID Documents"
      description="Which documents prove a resident lives here, and which details are read from each one."
      action={
        <ConfigHeroAction
          icon={Plus}
          onClick={() => ocrRef.current?.startAddProofType()}
        >
          Add proof type
        </ConfigHeroAction>
      }
    >
      <OcrTemplateBuilderPage ref={ocrRef} />
    </ConfigShell>
  )
}
