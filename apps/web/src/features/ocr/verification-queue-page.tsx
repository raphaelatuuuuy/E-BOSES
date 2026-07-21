import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Eye, RefreshCw, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Separator } from "@workspace/ui/components/separator"

import {
  approveVerificationCase,
  fetchAuthorizedProof,
  getVerificationCase,
  listVerificationCases,
  rejectVerificationCase,
  retryVerificationCase,
  type ResidenceVerificationCase,
} from "@/features/ocr/api"

type QueueFilter = "manual_review" | "queued" | "processing" | "approved" | "rejected"

function caseLabel(status: string) {
  return status.replaceAll("_", " ")
}

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "approved") return "secondary"
  if (status === "rejected") return "destructive"
  if (status === "manual_review") return "default"
  return "outline"
}

export default function VerificationQueuePage() {
  const [filter, setFilter] = useState<QueueFilter>("manual_review")
  const [cases, setCases] = useState<ResidenceVerificationCase[]>([])
  const [selected, setSelected] = useState<ResidenceVerificationCase | null>(null)
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  async function loadCases(nextFilter = filter) {
    try {
      const result = await listVerificationCases({ status: nextFilter })
      setCases(result)
      if (selected) {
        const refreshed = await getVerificationCase(selected.id)
        setSelected(refreshed)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verification queue could not be loaded.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const initial = window.setTimeout(() => void loadCases(), 0)
    const interval = window.setInterval(() => void loadCases(), 15000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
    // Queue polling intentionally follows the selected filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  async function openCase(item: ResidenceVerificationCase) {
    try {
      setSelected(await getVerificationCase(item.id))
      setReason("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Case could not be opened.")
    }
  }

  async function decide(decision: "approve" | "reject") {
    if (!selected || !reason.trim()) {
      toast.error("Record a reason before making a decision.")
      return
    }
    setWorking(true)
    try {
      const next = decision === "approve"
        ? await approveVerificationCase(selected.id, reason)
        : await rejectVerificationCase(selected.id, reason)
      setSelected(next)
      setReason("")
      await loadCases()
      toast.success(decision === "approve" ? "Resident approved" : "Resident rejected")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The decision could not be saved.")
    } finally {
      setWorking(false)
    }
  }

  async function retry() {
    if (!selected) return
    setWorking(true)
    try {
      const next = await retryVerificationCase(selected.id)
      setSelected(next)
      await loadCases()
      toast.success("Case queued for OCR retry")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The case could not be retried.")
    } finally {
      setWorking(false)
    }
  }

  async function openProof(rawUrl?: string) {
    if (!rawUrl) return
    try {
      const blob = await fetchAuthorizedProof(rawUrl)
      const url = URL.createObjectURL(blob)
      setPreview((current) => {
        if (current) URL.revokeObjectURL(current)
        return url
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The protected proof could not be opened.")
    }
  }

  const latestAttempt = selected?.latest_attempt
  const extracted = latestAttempt?.extracted_fields ?? selected?.extracted_fields ?? {}
  const ruleResults = latestAttempt?.rule_results ?? selected?.rule_results ?? []
  const duplicateMatches = latestAttempt?.duplicate_identity_matches ?? []
  const duplicateFound = Boolean(latestAttempt?.duplicate_match_found)
  const extractedEntries: Array<[
    string,
    { label?: string; value?: string; confidence?: number | null },
  ]> = Array.isArray(extracted)
    ? extracted.map((field) => [field.key, field])
    : Object.entries(extracted)

  return (
    <main className="flex min-h-full flex-col gap-6 p-4 md:p-6 lg:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Documents / Verification queue</p>
          <h1 className="text-3xl font-semibold tracking-tight">Proof-of-residency review</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review uncertain OCR cases, inspect protected evidence, and record the official decision.</p>
        </div>
        <Button variant="outline" onClick={() => void loadCases()}><RefreshCw data-icon="inline-start" /> Refresh queue</Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
        <Card className="h-fit">
          <CardHeader>
            <div className="flex items-center justify-between gap-3"><CardTitle>Cases</CardTitle><Badge variant="outline">{cases.length}</Badge></div>
            <CardDescription>Official decisions remain terminal even if OCR later recovers.</CardDescription>
            <label className="sr-only" htmlFor="queue-filter">Filter verification cases</label>
            <select id="queue-filter" className="h-10 rounded-md border bg-background px-3 text-sm" value={filter} onChange={(event) => setFilter(event.target.value as QueueFilter)}>
              <option value="manual_review">Manual review</option>
              <option value="queued">Queued</option>
              <option value="processing">Processing</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </CardHeader>
          <CardContent className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
            {loading && <p className="text-sm text-muted-foreground">Loading queue…</p>}
            {!loading && cases.length === 0 && <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No cases in this view.</p>}
            {cases.map((item) => (
              <button key={item.id} type="button" onClick={() => void openCase(item)} className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${selected?.id === item.id ? "border-primary bg-primary/5" : ""}`}>
                <div className="flex items-start justify-between gap-3"><span className="font-medium">Case #{item.id}</span><Badge variant={statusVariant(item.status)}>{caseLabel(item.status)}</Badge></div>
                <p className="mt-1 text-sm text-muted-foreground">{typeof item.document_type === "string" ? item.document_type : item.document_type?.name ?? "Residence proof"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.reason_code ?? item.review_reason ?? "Awaiting verification"}</p>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          {!selected ? (
            <CardContent className="flex min-h-96 items-center justify-center text-center text-sm text-muted-foreground">Select a case to inspect extracted fields, rules, attempts, and protected proof media.</CardContent>
          ) : (
            <>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>Case #{selected.id}</CardTitle><CardDescription>{selected.resident?.full_name ?? "Resident"} · {selected.resident?.email ?? "No email"}</CardDescription><CardDescription>Configuration v{selected.configuration_version ?? "—"} · {typeof selected.document_type === "string" ? selected.document_type : selected.document_type?.name ?? "Residence proof"}</CardDescription></div><Badge variant={statusVariant(selected.status)}>{caseLabel(selected.status)}</Badge></div>
                <p className="rounded-md bg-muted/40 p-3 text-sm">Reason: <strong>{caseLabel(selected.reason_code ?? selected.review_reason ?? "pending")}</strong></p>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {duplicateFound && <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4" role="alert"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" /><div><h2 className="font-semibold text-destructive">Possible duplicate identity</h2><p className="mt-1 text-sm text-muted-foreground">A configured identity number exactly matches another verified account. Approval is blocked until the resident provides corrected proof or the duplicate account is resolved.</p>{duplicateMatches.length > 0 && <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{duplicateMatches.map((match) => <li key={`${match.field_code}-${match.matching_user_id}`}>Field {caseLabel(match.field_code)} matches verified user #{match.matching_user_id}{match.matching_case_id ? ` in case #${match.matching_case_id}` : ""}.</li>)}</ul>}</div></div></section>}
                <section><h2 className="font-medium">Submitted proof</h2><div className="mt-2 grid gap-2 sm:grid-cols-2">{(selected.proofs ?? []).map((proof) => <div key={proof.id} className="flex items-center justify-between gap-2 rounded-lg border p-3"><span className="min-w-0 truncate text-sm">{proof.filename ?? proof.original_filename} <span className="text-muted-foreground">({proof.side ?? "single"})</span></span><Button variant="outline" size="sm" onClick={() => proof.raw_url && void openProof(proof.raw_url)} disabled={!proof.raw_url}><Eye data-icon="inline-start" /> Open</Button></div>)}</div></section>
                <Separator />
                <section><h2 className="font-medium">Extracted fields</h2><div className="mt-2 grid gap-2 sm:grid-cols-2">{extractedEntries.map(([key, value]) => <div key={key} className="rounded-lg border p-3"><div className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{value.label ?? key}</span><span>{value.confidence != null ? `${Math.round(Number(value.confidence) * 100)}% confidence` : "No confidence"}</span></div><p className="mt-1 break-words text-sm">{value.value ?? "—"}</p></div>)}</div></section>
                <section><h2 className="font-medium">Validation results</h2><div className="mt-2 flex flex-col gap-2">{ruleResults.length === 0 ? <p className="text-sm text-muted-foreground">No rule results recorded yet.</p> : ruleResults.map((rule, index) => <div key={`${rule.code ?? rule.key ?? "rule"}-${index}`} className="flex items-start gap-2 rounded-lg border p-3 text-sm">{rule.passed ? <CheckCircle2 className="mt-0.5 size-4 text-primary" aria-hidden="true" /> : <XCircle className="mt-0.5 size-4 text-destructive" aria-hidden="true" />}<span><strong>{rule.name ?? rule.label ?? rule.code ?? "Rule"}</strong><span className="ml-2 text-muted-foreground">{rule.detail ?? rule.message ?? (rule.passed ? "Passed" : "Needs review")}</span></span></div>)}</div></section>
                <section><h2 className="font-medium">Decision</h2><label className="mt-2 block text-sm font-medium" htmlFor="decision-reason">Official reason</label><Input id="decision-reason" className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the evidence and decision" disabled={selected.status === "approved" || selected.status === "rejected"} /><div className="mt-3 flex flex-wrap gap-2">{selected.status === "manual_review" && <>{!duplicateFound && <Button onClick={() => void decide("approve")} disabled={working || !reason.trim()}><CheckCircle2 data-icon="inline-start" /> Approve</Button>}<Button variant="destructive" onClick={() => void decide("reject")} disabled={working || !reason.trim()}><XCircle data-icon="inline-start" /> Reject</Button></>}{selected.can_retry === true && selected.status === "manual_review" && <Button variant="outline" onClick={() => void retry()} disabled={working}><RefreshCw data-icon="inline-start" /> Retry OCR</Button>}</div></section>
              </CardContent>
            </>
          )}
        </Card>
      </div>

      {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4" role="dialog" aria-label="Protected proof preview" onClick={() => { URL.revokeObjectURL(preview); setPreview(null) }}><img src={preview} alt="Protected proof" className="max-h-[90vh] max-w-full rounded-lg object-contain" /></div>}
    </main>
  )
}
