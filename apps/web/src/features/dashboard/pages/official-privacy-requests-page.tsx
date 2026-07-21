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

function statusClass(status: AccountRequest["status"]) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700"
  if (status === "reviewed") return "border-blue-200 bg-blue-50 text-blue-700"
  return "border-amber-200 bg-amber-50 text-amber-800"
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
    <main className="min-h-full bg-[#f7f8fc] p-4 md:p-6 lg:p-8">
      <section className="rounded-2xl border border-[#dfe7f5] bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[12px] font-black uppercase tracking-wide text-[#ff6a1a]">Configuration · Privacy</p>
            <h1 className="mt-1 text-2xl font-black text-[#07145f]">Resident privacy requests</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#68739c]">
              Review data exports and deletion requests separately from user administration. Deletion preserves anonymized civic records and is deferred while a case remains active.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className={cn("mr-2 size-4", loading && "animate-spin")} /> Refresh
          </Button>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-[#e7edf8] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" aria-label="Request type filter">
            {(["all", "data_export", "deletion"] as RequestTypeFilter[]).map((value) => (
              <button key={value} type="button" onClick={() => setTypeFilter(value)} className={cn("rounded-md border px-3 py-2 text-xs font-black", typeFilter === value ? "border-[#2447b3] bg-[#2447b3] text-white" : "border-[#dfe7f5] bg-[#f8fafc] text-[#43507f]")}>{value === "all" ? "All requests" : value === "data_export" ? "Data exports" : "Deletion"}</button>
            ))}
          </div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="h-10 rounded-lg border border-[#dfe7f5] bg-white px-3 text-xs font-bold text-[#07145f]">
            {statusFilters.map((value) => <option key={value} value={value}>{value === "all" ? "All statuses" : value.replace(/_/g, " ")}</option>)}
          </select>
        </div>
      </section>

      {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}<Button type="button" size="sm" variant="outline" onClick={() => void load()} className="ml-3">Retry</Button></div> : null}
      {loading ? <div className="mt-4 rounded-2xl border border-[#dfe7f5] bg-white p-8 text-sm font-bold text-[#68739c]">Loading privacy requests…</div> : null}

      {!loading && !error ? (
        <section className="mt-4 grid gap-4 xl:grid-cols-2">
          {visible.map((request) => (
            <article key={request.id} className="rounded-2xl border border-[#dfe7f5] bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", request.type === "data_export" ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-700")}>{request.type === "data_export" ? <DownloadIcon className="size-5" /> : <Trash2Icon className="size-5" />}</span>
                  <div className="min-w-0">
                    <h2 className="truncate font-black text-[#07145f]">{personName(request)}</h2>
                    <p className="mt-1 text-xs font-semibold text-[#68739c]">{request.user?.email || "Anonymized account"} · {formatDate(request.created_at)}</p>
                  </div>
                </div>
                <span className={cn("rounded-md border px-2.5 py-1 text-[10px] font-black uppercase", statusClass(request.status))}>{request.status}</span>
              </div>

              <div className="mt-4 rounded-xl bg-[#f8fafc] p-3">
                <p className="text-[11px] font-black uppercase text-[#68739c]">{request.type === "data_export" ? "Data export" : "Account deletion"}</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-[#43507f]">{request.note || "No resident note supplied."}</p>
                {request.staff_note ? <p className="mt-2 border-t border-[#dfe7f5] pt-2 text-xs font-semibold text-[#07145f]">Official note: {request.staff_note}</p> : null}
              </div>

              {!["completed", "rejected"].includes(request.status) ? (
                <div className="mt-4">
                  <label htmlFor={`privacy-note-${request.id}`} className="text-[11px] font-black uppercase text-[#68739c]">Official decision note</label>
                  <textarea id={`privacy-note-${request.id}`} value={notes[request.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} rows={3} placeholder={request.type === "deletion" ? "Record retention checks or the reason processing is deferred." : "Add preparation or rejection details."} className="mt-2 w-full resize-none rounded-xl border border-[#dfe7f5] bg-white p-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <Button type="button" variant="outline" disabled={busy === request.id} onClick={() => void decide(request, "reviewed")}>Under review</Button>
                    <Button type="button" disabled={busy === request.id} onClick={() => void decide(request, "completed")} className="bg-emerald-600 text-white hover:bg-emerald-700">Complete</Button>
                    <Button type="button" variant="outline" disabled={busy === request.id} onClick={() => void decide(request, "rejected")} className="border-red-200 text-red-700 hover:bg-red-50">Reject</Button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#cbd8ee] bg-white p-10 text-center xl:col-span-2">
              <FileLock2Icon className="mx-auto size-9 text-[#68739c]" />
              <h2 className="mt-3 font-black text-[#07145f]">No privacy requests in this view</h2>
              <p className="mt-1 text-sm font-semibold text-[#68739c]">Change the type or status filter to review another queue.</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-6 rounded-2xl border border-[#dfe7f5] bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#2447b3]"><EyeIcon className="size-5" /><p className="text-[12px] font-black uppercase tracking-wide">Sensitive access review</p></div>
            <h2 className="mt-1 text-xl font-black text-[#07145f]">Protected information access</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#68739c]">Review who opened protected media or downloaded an approved resident export. Network addresses and browser fingerprints are intentionally omitted from this screen.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadAccess()} disabled={accessLoading}><RefreshCwIcon className={cn("mr-2 size-4", accessLoading && "animate-spin")} />Refresh</Button>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-[#e7edf8] pt-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {(["all", "media", "export"] as const).map((value) => <button key={value} type="button" onClick={() => setAccessKind(value)} className={cn("rounded-md border px-3 py-2 text-xs font-black", accessKind === value ? "border-[#2447b3] bg-[#2447b3] text-white" : "border-[#dfe7f5] bg-[#f8fafc] text-[#43507f]")}>{value === "all" ? "All access" : value === "media" ? "Protected media" : "Data exports"}</button>)}
          </div>
          <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-[#dfe7f5] bg-white px-3 md:max-w-sm"><SearchIcon className="size-4 text-[#68739c]" /><input value={accessSearch} onChange={(event) => setAccessSearch(event.target.value)} placeholder="Search actor or resident" className="min-w-0 flex-1 bg-transparent text-xs font-bold text-[#07145f] outline-none" /></label>
        </div>

        {accessError ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{accessError}</div> : null}
        {accessLoading ? <div className="mt-4 rounded-xl bg-[#f8fafc] p-5 text-sm font-bold text-[#68739c]">Loading access history…</div> : null}
        {!accessLoading && !accessError ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-[#dfe7f5]">
            <div className="hidden grid-cols-[1.3fr_1.3fr_1fr_1fr] gap-3 bg-[#f8fafc] px-4 py-3 text-[10px] font-black uppercase text-[#68739c] md:grid"><span>Accessed by</span><span>Resident / subject</span><span>Protected resource</span><span>When</span></div>
            <div className="divide-y divide-[#e7edf8]">
              {accessRows.map((row) => (
                <div key={row.id} className="grid gap-2 px-4 py-4 text-xs md:grid-cols-[1.3fr_1.3fr_1fr_1fr] md:items-center md:gap-3">
                  <div><span className="font-black text-[#07145f]">{row.actor?.full_name || "System"}</span><span className="mt-0.5 block truncate text-[11px] font-semibold text-[#68739c]">{row.actor?.email || "No user actor"}</span></div>
                  <div><span className="font-black text-[#07145f]">{row.subject?.full_name || "No subject"}</span><span className="mt-0.5 block truncate text-[11px] font-semibold text-[#68739c]">{row.subject?.email || "—"}</span></div>
                  <div><span className="rounded-md bg-[#eef3ff] px-2 py-1 font-black text-[#2447b3]">{row.resource_type.replace(/_/g, " ")}</span><span className="mt-1 block text-[10px] font-semibold text-[#68739c]">Record {row.resource_id || "—"}</span></div>
                  <time className="font-semibold text-[#43507f]">{formatDate(row.created_at)}</time>
                </div>
              ))}
              {accessRows.length === 0 ? <div className="p-8 text-center text-sm font-semibold text-[#68739c]">No protected access events match this filter.</div> : null}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}
