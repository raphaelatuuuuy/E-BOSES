import { useEffect, useState } from "react"
import { ChevronDownIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { getLlmDecisionLog, type LlmDecisionLogDomain, type LlmDecisionLogEntry } from "./api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { displayValue, readable, verdictMeta } from "./shared"

const DOMAIN_FILTERS: { value: LlmDecisionLogDomain | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "concern", label: "Concern" },
  { value: "emergency", label: "Emergency" },
  { value: "community", label: "Community" },
]

const DOMAIN_LABEL: Record<LlmDecisionLogDomain, string> = {
  concern: "Concern",
  emergency: "Emergency",
  community: "Community",
}

const PAGE_SIZE = 25

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return String(value)
}

function SnapshotValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (!value.length) return <>—</>
    if (value.some((item) => isPlainObject(item))) {
      return (
        <div className="space-y-2">
          {value.map((item, index) => (
            <div key={index} className="rounded-lg border border-neutral-200 bg-white p-2">
              <SnapshotValue value={item} />
            </div>
          ))}
        </div>
      )
    }
    return <>{value.map((item) => formatPrimitive(item)).join(", ")}</>
  }
  if (isPlainObject(value)) {
    const rows = Object.entries(value)
    if (!rows.length) return <>—</>
    return (
      <dl className="space-y-1 border-l-2 border-neutral-200 pl-3">
        {rows.map(([key, nested]) => (
          <div key={key} className="flex gap-2 text-[12px] leading-relaxed">
            <dt className="shrink-0 font-semibold capitalize text-neutral-500">{readable(key)}</dt>
            <dd className="min-w-0 break-words text-neutral-800">
              <SnapshotValue value={nested} />
            </dd>
          </div>
        ))}
      </dl>
    )
  }
  return <>{formatPrimitive(value)}</>
}

function SnapshotTable({ label, snapshot }: { label: string; snapshot: Record<string, unknown> }) {
  const rows = Object.entries(snapshot ?? {})
  if (rows.length === 0) return null
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">{label}</p>
      <dl className="space-y-1 rounded-[10px] bg-white p-3">
        {rows.map(([key, value]) => (
          <div key={key} className="flex gap-2 text-[12px] leading-relaxed">
            <dt className="shrink-0 font-semibold capitalize text-neutral-500">{readable(key)}</dt>
            <dd className="min-w-0 break-words text-neutral-800">
              <SnapshotValue value={value} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function DecisionLogTab() {
  const [domain, setDomain] = useState<LlmDecisionLogDomain | "">("")
  const [entries, setEntries] = useState<LlmDecisionLogEntry[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void getLlmDecisionLog({ domain: domain || undefined, page: 1, page_size: PAGE_SIZE })
      .then((response) => {
        if (cancelled) return
        setEntries(response.results)
        setCount(response.count)
        setPage(1)
      })
      .catch((error) => toast.error(describeApiError(error, "Could not load the decision log.")))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [domain])

  async function loadMore() {
    const nextPage = page + 1
    try {
      const response = await getLlmDecisionLog({ domain: domain || undefined, page: nextPage, page_size: PAGE_SIZE })
      setEntries((prev) => [...prev, ...response.results])
      setPage(nextPage)
    } catch (error) {
      toast.error(describeApiError(error, "Could not load more entries."))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-0.5 rounded-full bg-neutral-100 p-1">
        {DOMAIN_FILTERS.map((filter) => (
          <button
            key={filter.value || "all"}
            type="button"
            onClick={() => setDomain(filter.value)}
            className={`flex-1 rounded-full py-2 text-[13px] font-medium transition-colors ${
              domain === filter.value ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-400 hover:bg-white/60 hover:text-neutral-900"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <LoaderCircleIcon className="size-6 animate-spin text-brand-navy" />
        </div>
      ) : entries.length === 0 ? (
        <p className="py-10 text-center text-[14px] font-medium text-neutral-500">No decisions logged yet.</p>
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-neutral-200">
          {entries.map((entry) => {
            const isOpen = expanded.has(entry.id)
            const verdict = verdictMeta(entry.recommended_action)
            return (
              <div key={entry.id} className="border-b border-neutral-200 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleExpanded(entry.id)}
                  className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-neutral-50"
                >
                  <verdict.icon className={cn("mt-0.5 size-5 shrink-0", verdict.tone)} strokeWidth={2} aria-hidden />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                        {DOMAIN_LABEL[entry.domain]} · {entry.run_kind === "simulation" ? "Test" : "Live"}
                        {entry.model_version ? ` · ${entry.model_version}` : ""}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-[12px] font-medium text-neutral-400">
                        {new Date(entry.created_at).toLocaleString()}
                        <ChevronDownIcon className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
                      </span>
                    </div>
                    <p className="text-[14px] font-semibold text-neutral-900">
                      {entry.recommended_action ? displayValue(entry.recommended_action) : "No action recorded"}
                    </p>
                    {entry.resident_message ? (
                      <p className="text-[13px] leading-relaxed text-neutral-500">&ldquo;{entry.resident_message}&rdquo;</p>
                    ) : null}
                    {entry.routing_reason ? (
                      <p className="text-[13px] leading-relaxed text-neutral-500">{entry.routing_reason}</p>
                    ) : null}
                    {entry.assigned_department ? (
                      <p className="text-[12px] font-medium text-neutral-400">→ {entry.assigned_department.name}</p>
                    ) : null}
                  </div>
                </button>
                {isOpen ? (
                  <div className="space-y-3 border-t border-neutral-100 bg-neutral-50 p-4">
                    {entry.duration_ms != null ? (
                      <p className="text-[12px] font-medium text-neutral-500">Took {entry.duration_ms} ms</p>
                    ) : null}
                    <SnapshotTable label="Input" snapshot={entry.input_snapshot} />
                    <SnapshotTable label="Output" snapshot={entry.output_snapshot} />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {!loading && entries.length < count ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          className="w-full rounded-full border border-neutral-300 py-2.5 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-100"
        >
          Load more
        </button>
      ) : null}
    </div>
  )
}
