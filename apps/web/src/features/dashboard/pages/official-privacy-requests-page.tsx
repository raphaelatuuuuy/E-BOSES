import { useCallback, useEffect, useMemo, useState } from "react"
import { DownloadIcon, EyeIcon, FileLock2Icon, RefreshCwIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  listManagedAccountRequests,
  listSensitiveAccessAudits,
  reviewAccountRequest,
  type AccountRequest,
  type SensitiveAccessAudit,
} from "@/features/auth/api"
import { usePageTitle } from "@/hooks/use-page-title"
import { StateMarker, type StateTone } from "@/components/ui/state-marker"

type RequestTypeFilter = "all" | "data_export" | "deletion"
type StatusFilter = "all" | AccountRequest["status"]

const statusFilters: StatusFilter[] = ["all", "submitted", "reviewed", "completed", "rejected"]

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function personName(request: AccountRequest) {
  return request.user?.full_name || request.user?.email || `Resident #${request.id}`
}

function statusTone(status: AccountRequest["status"]): StateTone {
  if (status === "completed") return "closed"
  if (status === "rejected") return "alarm"
  if (status === "reviewed") return "active"
  return "open"
}

export default function OfficialPrivacyRequestsPage() {
  usePageTitle("Privacy Requests")
  const [requests, setRequests] = useState<AccountRequest[]>([])
  const [typeFilter, setTypeFilter] = useState<RequestTypeFilter>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [accessRows, setAccessRows] = useState<SensitiveAccessAudit[]>([])
  const [accessKind, setAccessKind] = useState<"all" | "media" | "export">("all")
  const [accessSearch, setAccessSearch] = useState("")
  const [accessLoading, setAccessLoading] = useState(true)
  const [accessError, setAccessError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setRequests(await listManagedAccountRequests(statusFilter))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load privacy requests.")
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const loadAccess = useCallback(async () => {
    setAccessLoading(true)
    setAccessError("")
    try {
      setAccessRows(await listSensitiveAccessAudits({ kind: accessKind, search: accessSearch }))
    } catch (loadError) {
      setAccessError(loadError instanceof Error ? loadError.message : "Could not load sensitive access history.")
    } finally {
      setAccessLoading(false)
    }
  }, [accessKind, accessSearch])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAccess(), 250)
    return () => window.clearTimeout(timer)
  }, [loadAccess])

  const visible = useMemo(
    () => requests.filter((request) => typeFilter === "all" || request.type === typeFilter),
    [requests, typeFilter],
  )

  async function decide(request: AccountRequest, status: "reviewed" | "completed" | "rejected") {
    const note = (notes[request.id] || "").trim()
    if (status === "rejected" && !note) {
      toast.error("Add a clear reason before rejecting this request.")
      return
    }
    setBusy(request.id)
    try {
      const next = await reviewAccountRequest(request.id, {
        status,
        staff_note: note || (status === "completed" ? "Privacy request completed." : "Privacy request is under review."),
      })
      setRequests((current) => current.map((item) => item.id === next.id ? next : item))
      toast.success(status === "completed" ? "Request completed" : status === "rejected" ? "Request rejected" : "Request marked under review")
    } catch (decisionError) {
      toast.error(decisionError instanceof Error ? decisionError.message : "Could not update the request.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="min-h-full flex-1 bg-canvas p-4 md:p-6 lg:p-8">
      <section className="rounded-2xl border border-line-tint bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[12px] font-semibold text-brand-orange">Configuration · Privacy</p>
            <h1 className="mt-1 text-2xl font-semibold text-brand-navy">Resident privacy requests</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-subtle-foreground">
              Review data exports and deletion requests separately from user administration. Deletion preserves anonymized civic records and is deferred while a case remains active.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className={cn("mr-2 size-4", loading && "animate-spin")} /> Refresh
          </Button>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-line-tint pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" aria-label="Request type filter">
            {(["all", "data_export", "deletion"] as RequestTypeFilter[]).map((value) => (
              <button key={value} type="button" onClick={() => setTypeFilter(value)} className={cn("rounded-md border px-3 py-2 text-xs font-semibold", typeFilter === value ? "border-brand-blue bg-brand-blue text-white" : "border-line-tint bg-canvas text-navy-muted")}>{value === "all" ? "All requests" : value === "data_export" ? "Data exports" : "Deletion"}</button>
            ))}
          </div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="h-10 rounded-lg border border-line-tint bg-white px-3 text-xs font-bold text-brand-navy">
            {statusFilters.map((value) => <option key={value} value={value}>{value === "all" ? "All statuses" : value.replace(/_/g, " ")}</option>)}
          </select>
        </div>
      </section>

      {error ? <div className="mt-4 rounded-xl border border-neutral-200 p-4 text-read text-destructive">{error}<Button type="button" size="sm" variant="outline" onClick={() => void load()} className="ml-3">Retry</Button></div> : null}
      {loading ? <div className="mt-4 rounded-2xl border border-line-tint bg-white p-8 text-sm font-bold text-subtle-foreground">Loading privacy requests…</div> : null}

      {!loading && !error ? (
        <section className="mt-4 grid gap-4 xl:grid-cols-2">
          {visible.map((request) => (
            <article key={request.id} className="rounded-2xl border border-line-tint bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", request.type === "data_export" ? "bg-neutral-100 text-neutral-600" : "bg-neutral-100 text-destructive")}>{request.type === "data_export" ? <DownloadIcon className="size-5" /> : <Trash2Icon className="size-5" />}</span>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-brand-navy">{personName(request)}</h2>
                    <p className="mt-1 text-xs font-semibold text-subtle-foreground">{request.user?.email || "Anonymized account"} · {formatDate(request.created_at)}</p>
                  </div>
                </div>
                <StateMarker tone={statusTone(request.status)} label={request.status.replace(/_/g, " ")} className="capitalize" />
              </div>

              <div className="mt-4 rounded-xl bg-canvas p-3">
                <p className="text-[11px] font-semibold text-subtle-foreground">{request.type === "data_export" ? "Data export" : "Account deletion"}</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-navy-muted">{request.note || "No resident note supplied."}</p>
                {request.staff_note ? <p className="mt-2 border-t border-line-tint pt-2 text-xs font-semibold text-brand-navy">Official note: {request.staff_note}</p> : null}
              </div>

              {!["completed", "rejected"].includes(request.status) ? (
                <div className="mt-4">
                  <label htmlFor={`privacy-note-${request.id}`} className="text-[11px] font-semibold text-subtle-foreground">Official decision note</label>
                  <textarea id={`privacy-note-${request.id}`} value={notes[request.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} rows={3} placeholder={request.type === "deletion" ? "Record retention checks or the reason processing is deferred." : "Add preparation or rejection details."} className="mt-2 w-full resize-none rounded-xl border border-line-tint bg-white p-3 text-sm font-semibold text-brand-navy outline-none focus:border-brand-orange" />
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <Button type="button" variant="outline" disabled={busy === request.id} onClick={() => void decide(request, "reviewed")}>Under review</Button>
                    <Button type="button" disabled={busy === request.id} onClick={() => void decide(request, "completed")} className="bg-brand-navy text-white hover:bg-brand-navy/90">Complete</Button>
                    <Button type="button" variant="outline" disabled={busy === request.id} onClick={() => void decide(request, "rejected")} className="text-destructive">Reject</Button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-tint bg-white p-10 text-center xl:col-span-2">
              <FileLock2Icon className="mx-auto size-9 text-subtle-foreground" />
              <h2 className="mt-3 font-semibold text-brand-navy">No privacy requests in this view</h2>
              <p className="mt-1 text-sm font-semibold text-subtle-foreground">Change the type or status filter to review another queue.</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-6 rounded-2xl border border-line-tint bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-brand-blue"><EyeIcon className="size-5" /><p className="text-[12px] font-semibold">Sensitive access review</p></div>
            <h2 className="mt-1 text-xl font-semibold text-brand-navy">Protected information access</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-subtle-foreground">Review who opened protected media or downloaded an approved resident export. Network addresses and browser fingerprints are intentionally omitted from this screen.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadAccess()} disabled={accessLoading}><RefreshCwIcon className={cn("mr-2 size-4", accessLoading && "animate-spin")} />Refresh</Button>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-line-tint pt-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {(["all", "media", "export"] as const).map((value) => <button key={value} type="button" onClick={() => setAccessKind(value)} className={cn("rounded-md border px-3 py-2 text-xs font-semibold", accessKind === value ? "border-brand-blue bg-brand-blue text-white" : "border-line-tint bg-canvas text-navy-muted")}>{value === "all" ? "All access" : value === "media" ? "Protected media" : "Data exports"}</button>)}
          </div>
          <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-line-tint bg-white px-3 md:max-w-sm"><SearchIcon className="size-4 text-subtle-foreground" /><input value={accessSearch} onChange={(event) => setAccessSearch(event.target.value)} placeholder="Search actor or resident" className="min-w-0 flex-1 bg-transparent text-xs font-bold text-brand-navy outline-none" /></label>
        </div>

        {accessError ? <div className="mt-4 rounded-xl border border-neutral-200 p-3 text-meta text-destructive">{accessError}</div> : null}
        {accessLoading ? <div className="mt-4 rounded-xl bg-canvas p-5 text-sm font-bold text-subtle-foreground">Loading access history…</div> : null}
        {!accessLoading && !accessError ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-line-tint">
            <div className="hidden grid-cols-[1.3fr_1.3fr_1fr_1fr] gap-3 bg-canvas px-4 py-3 text-[10px] font-semibold text-subtle-foreground md:grid"><span>Accessed by</span><span>Resident / subject</span><span>Protected resource</span><span>When</span></div>
            <div className="divide-y divide-line-tint">
              {accessRows.map((row) => (
                <div key={row.id} className="grid gap-2 px-4 py-4 text-xs md:grid-cols-[1.3fr_1.3fr_1fr_1fr] md:items-center md:gap-3">
                  <div><span className="font-semibold text-brand-navy">{row.actor?.full_name || "System"}</span><span className="mt-0.5 block truncate text-[11px] font-semibold text-subtle-foreground">{row.actor?.email || "No user actor"}</span></div>
                  <div><span className="font-semibold text-brand-navy">{row.subject?.full_name || "No subject"}</span><span className="mt-0.5 block truncate text-[11px] font-semibold text-subtle-foreground">{row.subject?.email || "—"}</span></div>
                  <div><span className="rounded-md bg-tint px-2 py-1 font-semibold text-brand-blue">{row.resource_type.replace(/_/g, " ")}</span><span className="mt-1 block text-[10px] font-semibold text-subtle-foreground">Record {row.resource_id || "—"}</span></div>
                  <time className="font-semibold text-navy-muted">{formatDate(row.created_at)}</time>
                </div>
              ))}
              {accessRows.length === 0 ? <div className="p-8 text-center text-sm font-semibold text-subtle-foreground">No protected access events match this filter.</div> : null}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}