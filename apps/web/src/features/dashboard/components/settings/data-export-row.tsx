import { useState } from "react"

import {
  createAccountRequest,
  getAccountDataExport,
  listAccountRequests,
} from "@/features/auth/api"
import { SheetOptionRow } from "@/features/dashboard/components/sheet-dialog"

type Phase = "idle" | "working" | "done" | "error"

const PROMPTS: Record<Phase, string> = {
  idle: "A JSON copy of your account, reports, comments and consents.",
  working: "Preparing your copy…",
  done: "Downloaded. Ask again any time.",
  error: "That did not work. Please try again in a moment.",
}

function downloadJson(payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `eboses-my-data-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * Residents get their own data without asking anyone. The request row is still
 * created so the download is audited, but it completes server-side on creation
 * rather than waiting for an official to press a button.
 */
export function DataExportRow() {
  const [phase, setPhase] = useState<Phase>("idle")

  async function run() {
    if (phase === "working") return
    setPhase("working")
    try {
      const existing = await listAccountRequests()
      const ready = existing.find(
        (request) => request.type === "data_export" && request.status === "completed",
      )
      const target = ready ?? (await createAccountRequest({ type: "data_export" }))
      const payload = await getAccountDataExport(target.id)
      downloadJson(payload)
      setPhase("done")
    } catch {
      setPhase("error")
    }
  }

  return (
    <SheetOptionRow
      title="Download my data"
      description={PROMPTS[phase]}
      onClick={run}
      showChevron={phase !== "working"}
    />
  )
}
