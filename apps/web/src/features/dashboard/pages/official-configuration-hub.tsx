import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangleIcon,
  BrainCircuitIcon,
  ChevronRightIcon,
  FileLock2Icon,
  MapIcon,
  ShieldCheckIcon,
  SirenIcon,
  TagsIcon,
  UserCogIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import { apiRequest } from "@/lib/api"
import { CAPABILITIES } from "@/features/dashboard/lib/capabilities"

/**
 * Configuration hub.
 *
 * Configuration used to be a sidebar flyout with five children, and needs to
 * hold eleven sections. Rather than a longer flyout, it is now one destination
 * with four groups of status cards.
 *
 * Each card carries live status, so an official can see whether anything needs
 * them without opening anything — and the whole hub is one request rather than
 * eleven. Sections whose screens are not built yet still appear, honestly
 * labelled, which doubles as a visible roadmap.
 */

interface SectionStatus {
  status: string | null
  detail: string
  needs_attention: boolean
  available?: boolean
}

interface SummaryResponse {
  sections: Record<string, SectionStatus>
  capabilities: string[]
}

interface SectionDef {
  key: string
  label: string
  description: string
  icon: LucideIcon
  to: string | null
  capability: string
}

const GROUPS: { title: string; sections: SectionDef[] }[] = [
  {
    title: "People & access",
    sections: [
      {
        key: "units",
        label: "Units",
        description: "Barangay units, desks and committees",
        icon: UsersIcon,
        to: "/dashboard/configuration/units",
        capability: CAPABILITIES.manageUnits,
      },
      {
        key: "roles",
        label: "Permissions",
        description: "What each position is allowed to do",
        icon: ShieldCheckIcon,
        to: "/dashboard/configuration/roles",
        capability: CAPABILITIES.manageRoles,
      },
      {
        key: "users",
        label: "Users",
        description: "Accounts, unit assignments and status",
        icon: UserCogIcon,
        to: "/dashboard/configuration/users",
        capability: CAPABILITIES.manageUsers,
      },
    ],
  },
  {
    title: "Intake & routing",
    sections: [
      {
        key: "categories",
        label: "Concern categories",
        description: "What residents can report, and who answers each",
        icon: TagsIcon,
        to: "/dashboard/configuration/categories",
        capability: CAPABILITIES.manageCategories,
      },
      {
        key: "classification",
        label: "Report checking",
        description: "How submitted reports are checked before you see them",
        icon: BrainCircuitIcon,
        to: "/dashboard/configuration/classification",
        capability: CAPABILITIES.configureClassification,
      },
    ],
  },
  {
    title: "Emergency response",
    sections: [
      {
        key: "dispatch",
        label: "Emergency categories",
        description: "SOS choices and the units that answer each",
        icon: SirenIcon,
        to: "/dashboard/configuration/dispatch",
        capability: CAPABILITIES.configureDispatch,
      },
      {
        key: "zones",
        label: "Zones, radius & SMS",
        description: "Coverage rings and the SMS fallback number",
        icon: MapIcon,
        to: "/dashboard/configuration/map-dispatch",
        capability: CAPABILITIES.configureGeography,
      },
    ],
  },
  {
    title: "Trust & privacy",
    sections: [
      {
        key: "verification",
        label: "ID verification",
        description: "Resident ID and residence proof",
        icon: ShieldCheckIcon,
        to: "/dashboard/configuration/id-proof-template",
        capability: CAPABILITIES.reviewVerification,
      },
      {
        key: "privacy",
        label: "Privacy requests",
        description: "Data export, deactivation and deletion",
        icon: FileLock2Icon,
        to: "/dashboard/configuration/privacy-requests",
        capability: CAPABILITIES.handlePrivacy,
      },
    ],
  },
]

function SectionCard({
  section,
  state,
  loading,
}: {
  section: SectionDef
  state: SectionStatus | undefined
  loading: boolean
}) {
  const Icon = section.icon
  const built = Boolean(section.to)

  const body = (
    <>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-xl bg-tint p-2 text-brand-navy">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold text-foreground">{section.label}</p>
            {state?.needs_attention ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-status-open-surface px-2 py-0.5 text-[10px] font-bold text-status-open-ink"
                title="Needs attention"
              >
                <AlertTriangleIcon className="size-3" aria-hidden />
                Attention
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
            {section.description}
          </p>
        </div>
        {built ? (
          <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
      </div>

      <div className="mt-3 border-t border-card-line pt-2.5">
        {loading ? (
          <span className="block h-3 w-32 animate-pulse rounded-full bg-chart-track" />
        ) : (
          <>
            <p className="truncate text-sm font-bold tabular-nums text-foreground">
              {state?.status ?? (built ? "Status unavailable" : "Not configured")}
            </p>
            {state?.detail ? (
              <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
                {state.detail}
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  )

  const shell = "rounded-2xl border border-card-line bg-card p-4 text-left"

  // Sections without a screen yet are shown, not hidden: a visible
  // "Not configured" card is more honest than a feature nobody can find, and
  // it makes the remaining work legible inside the product.
  if (!built) {
    return (
      <div className={`${shell} opacity-75`} aria-disabled>
        {body}
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Screen not built yet
        </p>
      </div>
    )
  }

  return (
    <Link to={section.to!} className={`${shell} block transition hover:border-brand-orange`}>
      {body}
    </Link>
  )
}

export default function OfficialConfigurationHubPage() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    apiRequest<SummaryResponse>("/config/summary/")
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch(() => {
        // Configuration must stay reachable when a status query breaks, so the
        // cards still render with their labels and no status.
        if (!cancelled) setError("Live status is unavailable right now.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const granted = summary?.capabilities
  const attentionCount = Object.values(summary?.sections ?? {}).filter(
    (section) => section.needs_attention,
  ).length

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Configuration</h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            How this barangay routes concerns, dispatches responders and verifies residents.
          </p>
        </div>
        {!loading && attentionCount > 0 ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-status-open-surface px-3 py-1.5 text-xs font-bold text-status-open-ink">
            <AlertTriangleIcon className="size-3.5" aria-hidden />
            {attentionCount} {attentionCount === 1 ? "section needs" : "sections need"} attention
          </span>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-xl border border-card-line bg-tint px-3 py-2 text-sm font-semibold text-muted-foreground">
          {error}
        </p>
      ) : null}

      {GROUPS.map((group) => {
        // Sections the official has no capability for are omitted, matching
        // what their sidebar shows.
        const visible = granted
          ? group.sections.filter((section) => granted.includes(section.capability))
          : group.sections

        if (visible.length === 0) return null

        return (
          <section key={group.title} className="space-y-3">
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {group.title}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((section) => (
                <SectionCard
                  key={section.key}
                  section={section}
                  state={summary?.sections[section.key]}
                  loading={loading}
                />
              ))}
            </div>
          </section>
        )
      })}

      {!loading && granted?.length === 0 ? (
        <p className="rounded-2xl border border-card-line bg-card p-6 text-center text-sm font-semibold text-muted-foreground">
          You do not have access to any configuration section. Ask the Barangay Captain to assign
          you a position.
        </p>
      ) : null}
    </div>
  )
}
