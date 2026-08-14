import { useEffect, useState } from "react"
import { toast } from "sonner"

import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { revealReporterContact } from "@/features/dashboard/emergency-api"

const READS_AS_MASKED = /[•*x]/i

function isReadable(raw: string) {
  return /[0-9]/.test(raw) && !READS_AS_MASKED.test(raw)
}

/**
 * Reporter phone reveal + dial, shared by the responder console and both
 * official surfaces so every role dials the same audited way.
 *
 * The number is masked server-side until `revealReporterContact` is called
 * (which logs the access for the privacy audit), so the digits are never
 * dialled raw. `autoReveal` controls the on-screen value:
 *
 * - `true` (responder console): reveal once on mount so the number is visible.
 * - `false` (official panels): keep it masked until the official actually
 *   dials, so the audit trail records one reveal per call, not one per view.
 *
 * Either way `call()` reveals on demand when the number is not already known,
 * hands the digits to the OS dialer, and never renders them into the DOM.
 */
export function useReporterPhone(
  alert: EmergencyAlert | null,
  { autoReveal = false }: { autoReveal?: boolean } = {},
) {
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState<{ forAlertId: number; value: string } | null>(null)

  const raw = alert?.reporter_phone?.trim() ?? ""
  const alreadyReadable = isReadable(raw)

  useEffect(() => {
    if (!autoReveal || !alert || alreadyReadable) return
    if (revealed?.forAlertId === alert.id) return
    let cancelled = false
    revealReporterContact(alert.id)
      .then(({ phone_number }) => {
        if (!cancelled) setRevealed({ forAlertId: alert.id, value: phone_number })
      })
      .catch(() => {
        // The button still dials on demand (it reveals again) — only the
        // on-screen number stays hidden.
      })
    return () => {
      cancelled = true
    }
  }, [alert, autoReveal, revealed, alreadyReadable])

  const phone = alert && revealed?.forAlertId === alert.id ? revealed.value : alreadyReadable ? raw : null

  async function call() {
    if (!alert || busy) return
    setBusy(true)
    try {
      // Reveal only when the number is not known already: the reveal call is
      // audited, so zero unnecessary accesses is the point.
      const known = revealed?.forAlertId === alert.id ? revealed.value : null
      const dialable = known ?? (alreadyReadable ? raw : (await revealReporterContact(alert.id)).phone_number)
      // `tel:` hands off to the OS dialer; the digits never render into the
      // DOM, get copied to the clipboard, or land in a toast.
      window.location.href = `tel:${dialable.replace(/\s+/g, "")}`
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the dialer.", {
        id: "call-reporter",
      })
    } finally {
      setBusy(false)
    }
  }

  return { phone, busy, call }
}
