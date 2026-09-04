import { useEffect, useState } from "react"
import { ShieldAlertIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import { usePageTitle } from "@/hooks/use-page-title"
import { ConfigBreadcrumb } from "@/features/dashboard/components/config/config-shell"
import { FilterRow, ListSearch, Pager, PAGE_SIZE } from "@/components/ui/list-controls"
import { useWheelScroll } from "@/hooks/use-wheel-scroll"

/**
 * The audit log.
 *
 * This replaced Privacy requests. That screen asked officials to approve a
 * resident getting their own data back, which is not a decision anybody needs
 * to make — exports already complete themselves. The real gap was the reverse:
 * no way to see who did what, including which official opened an unblurred
 * photo of somebody.
 *
 * Laid out as an editorial list rather than cards: a left rail carrying when
 * and what kind, a strong line saying what happened, and a quiet line saying
 * who and where. Hairlines divide the rows; nothing is boxed.
 */

interface Person {
  id: number
  name: string
  email: string
}

interface Entry {
  id: number
  action: string
  label: string
  category: string
  sensitive: boolean
  actor: Person | null
  target: Person | null
  ip_address: string
  metadata: Record<string, unknown>
  created_at: string
}

interface AuditResponse {
  total: number
  offset: number
  limit: number
  categories: { key: string; label: string }[]
  entries: Entry[]
}

const RANGES = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "all", label: "All time" },
]

function when(iso: string): { day: string; time: string } {
  const date = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const midnight = new Date(date)
  midnight.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - midnight.getTime()) / 86_400_000)
  const day =
    diff === 0
      ? "Today"
      : diff === 1
        ? "Yesterday"
        : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  return { day, time: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) }
}

/**
 * Metadata worth reading, as named facts.
 *
 * The raw record holds whatever each action chose to store. Printing that as a
 * dotted run of bare values told an official nothing — "resolved · roads · 3"
 * does not say which of those is a status. Each fact carries its own label, and
 * anything unrecognised stays in the record rather than being guessed at.
 */
const FACT_LABELS: Record<string, string> = {
  reason: "Reason",
  status: "Status",
  type: "Type",
  field: "Field",
  emergency_type: "Emergency",
  category: "Category",
  tracking_number: "Report",
  request_id: "Request",
  proof_type: "Proof type",
  document: "Document",
  unit: "Unit",
  position: "Position",
}

function humanise(value: string): string {
  const text = value.replace(/_/g, " ").trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function detailsOf(entry: Entry): { label: string; value: string }[] {
  const meta = entry.metadata ?? {}
  const facts: { label: string; value: string }[] = []

  if (entry.target && entry.target.id !== entry.actor?.id) {
    facts.push({ label: "About", value: entry.target.name })
  }
  for (const [key, label] of Object.entries(FACT_LABELS)) {
    const value = meta[key]
    if (typeof value === "string" && value) facts.push({ label, value: humanise(value) })
    else if (typeof value === "number") facts.push({ label, value: String(value) })
  }
  if (entry.ip_address) facts.push({ label: "From", value: entry.ip_address })

  return facts.slice(0, 4)
}

export default function OfficialAuditLogPage() {
  usePageTitle("Audit log")

  const [data, setData] = useState<AuditResponse | null>(null)
  const [category, setCategory] = useState("all")
  const [range, setRange] = useState("30")
  const [sensitiveOnly, setSensitiveOnly] = useState(false)
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [offset, setOffset] = useState(0)
  const [loadedKey, setLoadedKey] = useState("")
  const [error, setError] = useState("")
  const rangeScrollRef = useWheelScroll<HTMLDivElement>()

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  // Any change of filter starts the list again, otherwise page 4 of one filter
  // silently becomes page 4 of another.
  const filterKey = `${category}|${range}|${sensitiveOnly}|${debounced}`
  const [prevKey, setPrevKey] = useState(filterKey)
  if (prevKey !== filterKey) {
    setPrevKey(filterKey)
    setOffset(0)
  }

  // Loading is derived, not set: the request key that produced `data` is
  // compared with the one the filters currently ask for. Flipping a boolean at
  // the top of the effect would be a synchronous setState during render.
  const requestKey = `${filterKey}|${offset}`

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({
      category,
      days: range,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    })
    if (sensitiveOnly) params.set("sensitive", "1")
    if (debounced) params.set("search", debounced)

    void (async () => {
      try {
        const next = await apiRequest<AuditResponse>(`/config/audit-log/?${params}`)
        if (cancelled) return
        setData(next)
        setLoadedKey(requestKey)
        setError("")
      } catch {
        if (cancelled) return
        setLoadedKey(requestKey)
        setError("The audit log could not be read right now.")
      }
    })()

    return () => {
      cancelled = true
    }
  }, [category, range, sensitiveOnly, debounced, offset, requestKey])

  const loading = loadedKey !== requestKey

  const categories = data?.categories ?? [{ key: "all", label: "Everything" }]
  const total = data?.total ?? 0
  const entries = data?.entries ?? []

  return (
    <div className="min-h-full bg-white">
      <div className="mx-auto w-full max-w-[1100px] px-6 pt-10 pb-6 sm:px-10 lg:pb-28">
        <ConfigBreadcrumb
          trail={[
            { label: "Configuration", to: "/dashboard/configuration" },
            { label: "Monitoring", to: "/dashboard/configuration" },
            { label: "Audit log" },
          ]}
        />

        <header className="mt-8">
          <h1 className="text-page-title text-brand-navy">Audit log</h1>
          <p className="mt-3 max-w-2xl text-read leading-relaxed text-neutral-500">
            Everything people and services did, newest first — including every time an official
            opened an unblurred photo. Nothing here can be edited or deleted.
          </p>
        </header>

        <FilterRow
          options={categories}
          value={category}
          onChange={setCategory}
          className="mt-10"
        />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <ListSearch
            value={search}
            onChange={setSearch}
            placeholder="Search a person or an action"
            label="Search the audit log"
            className="flex-1 sm:max-w-xs"
          />

          <div
            ref={rangeScrollRef}
            className="flex items-center gap-6 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <button
              type="button"
              onClick={() => setSensitiveOnly((value) => !value)}
              aria-pressed={sensitiveOnly}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 text-meta transition-colors",
                sensitiveOnly ? "font-medium text-accent" : "text-neutral-500 hover:text-brand-navy",
              )}
            >
              <ShieldAlertIcon className="size-4" strokeWidth={1.8} aria-hidden />
              Private data only
            </button>
            {RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setRange(item.key)}
                className={cn(
                  "shrink-0 text-meta transition-colors",
                  range === item.key
                    ? "font-medium text-brand-navy"
                    : "text-neutral-400 hover:text-brand-navy",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p className="mt-12 text-read text-neutral-500">{error}</p>
        ) : loading ? (
          <p className="mt-12 text-read text-neutral-400">Reading the log…</p>
        ) : entries.length === 0 ? (
          <p className="mt-12 text-read text-neutral-500">
            Nothing was recorded for this filter. Try a longer time range.
          </p>
        ) : (
          <ol className="mt-6">
            {entries.map((entry) => {
              const stamp = when(entry.created_at)
              const facts = detailsOf(entry)
              return (
                <li
                  key={entry.id}
                  className="grid grid-cols-1 gap-x-8 gap-y-2 border-b border-neutral-200 py-6 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)]"
                >
                  <div className="text-meta tabular-nums text-neutral-400">
                    <p className="text-neutral-500">{stamp.day}</p>
                    <p className="mt-0.5">{stamp.time}</p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-row font-normal text-brand-navy">
                      {entry.label}
                      {entry.sensitive ? (
                        <span className="ml-2 align-middle text-meta font-medium text-accent">
                          private data
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1.5 text-meta text-neutral-500">
                      {entry.actor ? entry.actor.name : "The system"}
                    </p>

                    {/* Facts as label/value pairs, not a run-on line of raw values. */}
                    {facts.length > 0 ? (
                      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                        {facts.map((fact) => (
                          <div key={fact.label} className="min-w-0">
                            <dt className="text-meta text-neutral-400">{fact.label}</dt>
                            <dd className="mt-0.5 truncate text-meta text-brand-navy">
                              {fact.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        <Pager offset={offset} total={total} onChange={setOffset} noun="entries" />
      </div>
    </div>
  )
}
