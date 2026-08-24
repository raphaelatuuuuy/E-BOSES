import { useEffect, useMemo, useState } from "react"

import { Footer } from "@/features/landing/components/footer"
import { Navbar } from "@/features/landing/components/navbar"
import {
  fetchActiveCommunities,
  fetchCommunityBoundary,
  type ActiveCommunities,
  type Community,
  type CommunityBoundary,
} from "./api"
import { BarangayBoundary } from "./barangay-boundary"
import { PhilippinesMap, type RegionFigures } from "./philippines-map"

const numbers = new Intl.NumberFormat("en-PH")

const CAPTION = "mt-1 text-sm text-landing-cream/45"

function sum(rows: Community[], pick: (row: Community) => number) {
  return rows.reduce((total, row) => total + pick(row), 0)
}

function yearOf(since: string | null) {
  return since ? since.slice(0, 4) : ""
}

function StatIcon({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="material-symbols-outlined shrink-0 select-none transition-all duration-300"
      style={{
        color: "var(--color-brand-orange)",
        fontSize: "46px",
        lineHeight: 1,
        textShadow: "0 0 12px rgba(255,106,26,0.4), 0 0 28px rgba(255,106,26,0.12)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.textShadow = "0 0 16px rgba(255,106,26,0.8), 0 0 40px rgba(255,106,26,0.4), 0 0 60px rgba(255,106,26,0.15)"
        e.currentTarget.style.transform = "scale(1.08)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.textShadow = "0 0 12px rgba(255,106,26,0.4), 0 0 28px rgba(255,106,26,0.12)"
        e.currentTarget.style.transform = "scale(1)"
      }}
    >
      {name}
    </span>
  )
}

function Stat({
  icon,
  value,
  label,
  caption,
  loading,
}: {
  icon: string
  value: number
  label: string
  caption: string
  loading: boolean
}) {
  return (
    <div className="group flex items-center gap-5 border-b border-white/8 py-6 last:border-b-0">
      <StatIcon name={icon} />
      <div className="min-w-0">
        {loading ? (
          <div className="h-12 w-32 animate-pulse rounded-lg bg-white/8" />
        ) : (
          <p className="font-heading text-5xl leading-none tracking-tight text-landing-cream sm:text-6xl">
            {numbers.format(value)}
          </p>
        )}
        <p className="mt-2 text-base font-medium text-landing-cream/85">{label}</p>
        <p className="mt-1 text-sm text-landing-cream/50">{loading ? " " : caption}</p>
      </div>
    </div>
  )
}


export default function ActiveCommunitiesPage() {
  const [data, setData] = useState<ActiveCommunities | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState("all")
  const [boundary, setBoundary] = useState<CommunityBoundary | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchActiveCommunities(controller.signal)
      .then((result) => setData(result))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : "Could not load the coverage figures.")
      })
    return () => controller.abort()
  }, [])

  const loading = !data && !error
  const all = useMemo(() => data?.communities ?? [], [data])

  const years = useMemo(() => {
    const found = new Set(all.map((item) => yearOf(item.since)).filter(Boolean))
    return [...found].sort()
  }, [all])

  const communities = useMemo(() => {
    if (period === "all") return all
    return all.filter((item) => yearOf(item.since) && yearOf(item.since) <= period)
  }, [all, period])

  const totals = useMemo(() => {
    return {
      communities: communities.length,
      cities: new Set(communities.map((item) => item.city).filter(Boolean)).size,
      residents: sum(communities, (item) => item.residents),
      responders: sum(communities, (item) => item.responders),
      officials: sum(communities, (item) => item.officials),
      reports: sum(communities, (item) => item.reports),
      resolvedReports: sum(communities, (item) => item.resolved_reports),
      emergencies: sum(communities, (item) => item.emergencies),
      closedEmergencies: sum(communities, (item) => item.closed_emergencies),
    }
  }, [communities])

  const regions = useMemo(() => {
    const map: Record<string, RegionFigures> = {}
    for (const item of communities) {
      if (!item.region) continue
      const current = map[item.region] ?? { communities: 0, residents: 0, reports: 0, emergencies: 0 }
      map[item.region] = {
        communities: current.communities + 1,
        residents: current.residents + item.residents,
        reports: current.reports + item.reports,
        emergencies: current.emergencies + item.emergencies,
      }
    }
    return map
  }, [communities])

  const selected = useMemo(() => {
    if (communities.length === 0) return null
    return communities.find((item) => item.is_home) ?? communities[0]
  }, [communities])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    fetchCommunityBoundary(selected.id, controller.signal)
      .then((result) => setBoundary(result))
      .catch((_cause: unknown) => {
        if (!controller.signal.aborted) setBoundary(null)
      })
    return () => controller.abort()
  }, [selected])

  const boundaryLoading = !!selected && (!boundary || boundary.id !== selected.id)

  return (
    <div className="landing-fonts flex min-h-screen flex-col overflow-x-hidden bg-landing-bg text-landing-cream">
      <Navbar />
      <main className="flex-grow">
        <section className="mx-auto w-full max-w-6xl px-5 pt-8 pb-10 sm:px-8 sm:pt-10">
          <p className="inline-block bg-brand-orange px-3 py-1 text-xs font-semibold tracking-[0.18em] text-landing-bg uppercase">
            Active communities
          </p>
          <h1 className="font-heading mt-3 text-4xl leading-[1.05] tracking-tight sm:text-6xl">
            Status of Operation
          </h1>
          <p className="mt-4 max-w-2xl text-base text-landing-cream/55">
            Live counts, see the total communities using E-Boses.
          </p>

          {error ? (
            <p className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-sm text-landing-cream/70">
              {error}
            </p>
          ) : null}

          <div className="mt-10 grid gap-8 lg:grid-cols-[1.05fr_1fr] lg:items-start lg:gap-12">
            <div>
              <div className="flex flex-wrap gap-1">
                {years.map((year) => (
                  <button
                    key={year}
                    type="button"
                    aria-pressed={period === year}
                    onClick={() => setPeriod(year)}
                    className="py-2 font-heading text-2xl font-bold tracking-tight text-brand-orange transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:text-3xl"
                  >
                    Live by {year}
                  </button>
                ))}
              </div>

              <div className="mt-6">
                <Stat
                  icon="apartment"
                  value={totals.communities}
                  label="Barangays covered"
                  caption={`${numbers.format(totals.cities)} ${totals.cities === 1 ? "city" : "cities"} and municipalities`}
                  loading={loading}
                />
                <Stat
                  icon="emoji_language"
                  value={totals.residents}
                  label="Verified residents"
                  caption={`${numbers.format(totals.responders)} responders and ${numbers.format(totals.officials)} officials on duty`}
                  loading={loading}
                />
                <Stat
                  icon="home_storage"
                  value={totals.reports}
                  label="Reports filed"
                  caption={`${numbers.format(totals.resolvedReports)} resolved`}
                  loading={loading}
                />
                <Stat
                  icon="siren_check"
                  value={totals.emergencies}
                  label="Emergency alerts handled"
                  caption={`${numbers.format(totals.closedEmergencies)} closed`}
                  loading={loading}
                />
              </div>
            </div>

            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-landing-cream">Coverage map</h2>
                  <p className={CAPTION}>Regions fill in as barangays go live.</p>
                </div>
                <span aria-hidden className="material-symbols-outlined size-5 shrink-0 text-landing-cream/35" style={{ fontSize: '20px' }}>grid_view</span>
              </div>
              <div className="mt-5">
                <PhilippinesMap figures={regions} loading={loading} />
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
          <div className="animate-fade-slide-up text-center">
            <h2 className="font-heading text-5xl leading-[1.05] tracking-tight sm:text-7xl">
              Cities and barangays
            </h2>
          </div>

          {selected ? (
            <div key={selected.id} className="animate-fade-slide-up mt-10 text-center">
              <p className="text-xs font-semibold tracking-[0.18em] text-landing-cream/40 uppercase">
                {selected.city || selected.locality}
              </p>
              <h3 className="font-heading mt-2 text-2xl tracking-tight text-landing-cream sm:text-3xl">
                {selected.name}
              </h3>
              <div className="mt-6">
                <BarangayBoundary
                  name={selected.name}
                  geometry={boundaryLoading ? null : (boundary?.geometry ?? null)}
                  loading={boundaryLoading}
                />
              </div>

              <dl className="mx-auto mt-8 flex w-fit divide-x divide-white/10">
                <div className="px-8">
                  <dt className="text-xs font-medium tracking-[0.14em] text-landing-cream/40 uppercase">
                    Residents
                  </dt>
                  <dd className="font-heading mt-2 text-3xl text-landing-cream">
                    {numbers.format(selected.residents)}
                  </dd>
                </div>
                {selected.since ? (
                  <div className="px-8">
                    <dt className="text-xs font-medium tracking-[0.14em] text-landing-cream/40 uppercase">
                      Live since
                    </dt>
                    <dd className="font-heading mt-2 text-3xl text-landing-cream">{selected.since}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : loading ? (
            <div className="mt-10 flex justify-center">
              <div className="size-48 animate-pulse rounded-full bg-white/5" />
            </div>
          ) : (
            <p className="mt-10 text-center text-sm text-landing-cream/55">
              No barangay is live on E-Boses for this period yet.
            </p>
          )}
        </section>
      </main>
      <Footer />
    </div>
  )
}
