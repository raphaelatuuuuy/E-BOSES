import { useEffect, useState } from "react"
import {
  AlertTriangleIcon,
  BotIcon,
  IdCardLanyard,
  MapIcon,
  ShieldCheckIcon,
  SirenIcon,
  FolderOpenIcon,
  UserCogIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import { CAPABILITIES } from "@/features/dashboard/lib/capabilities"
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list"
import { PageHeader, PageSection } from "@/components/ui/page-header"
import { Note } from "@/components/ui/note"
import { ServiceStatusSection } from "@/features/dashboard/components/official/service-status-section"

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
    title: "User management",
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
    title: "Operations",
    sections: [
      {
        key: "categories",
        label: "Concern categories",
        description: "What residents can report, and who answers each",
        icon: FolderOpenIcon,
        to: "/dashboard/configuration/categories",
        capability: CAPABILITIES.manageCategories,
      },
      {
        key: "classification",
        label: "System behavior",
        description: "How concerns, emergencies, and verification are handled",
        icon: BotIcon,
        to: "/dashboard/configuration/classification",
        capability: CAPABILITIES.configureClassification,
      },
      {
        key: "dispatch",
        label: "Emergency types",
        description: "The SOS buttons residents see, and who answers each",
        icon: SirenIcon,
        to: "/dashboard/configuration/dispatch",
        capability: CAPABILITIES.configureDispatch,
      },
      {
        key: "coverage",
        label: "Coverage area",
        description: "The area where your station accepts reports",
        icon: MapIcon,
        to: "/dashboard/configuration/coverage",
        capability: CAPABILITIES.configureGeography,
      },
      {
        key: "verification",
        label: "ID Documents",
        description: "Which documents prove a resident lives here",
        icon: IdCardLanyard,
        to: "/dashboard/configuration/id-proof-template",
        capability: CAPABILITIES.manageUsers,
      },
    ],
  },
]

/**
 * One hairline row per section.
 *
 * This used to be a grid of bordered status cards, each drawing its own box
 * with an icon well, a title, a description, an attention pill and a divided
 * status footer — eleven boxes competing for the same attention. A row states
 * the section, what it is for, and where it stands, and the only thing that
 * breaks the rhythm is a section that actually needs someone.
 */
function SectionRow({
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

  // Same icon treatment as the Help Center: a solid navy tile that lifts to the
  // accent on hover, so a row reads as one target instead of a decorated line.
  const leading = (
    <span
      className={cn(
        "flex size-12 items-center justify-center rounded-2xl bg-brand-navy text-white transition-[background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none",
        built && "group-hover:bg-accent group-hover:shadow-lg"
      )}
    >
      <Icon
        className={cn(
          "size-6 transition-transform duration-200 ease-out motion-reduce:transition-none",
          built && "group-hover:scale-110 motion-reduce:group-hover:scale-100"
        )}
        strokeWidth={1.7}
        aria-hidden
      />
    </span>
  )

  const meta = loading ? (
    <span className="block h-3 w-24 animate-pulse rounded-full bg-neutral-200" />
  ) : (
    <span className="block text-right">
      <span className="block text-row font-normal text-brand-navy transition-colors group-hover:text-accent">
        {state?.status ?? (built ? "—" : "Not configured")}
      </span>
      {state?.detail ? (
        <span className="mt-1 block text-meta text-neutral-400">
          {state.detail}
        </span>
      ) : null}
    </span>
  )

  const label = (
    <span
      className={cn("transition-colors", built && "group-hover:text-accent")}
    >
      {section.label}
    </span>
  )

  const title = state?.needs_attention ? (
    <span className="flex items-center gap-2">
      {label}
      <span className="inline-flex items-center gap-1 text-meta font-medium text-sos">
        <AlertTriangleIcon className="size-4" strokeWidth={2} aria-hidden />
        Needs attention
      </span>
    </span>
  ) : (
    label
  )

  // Sections without a screen yet are shown, not hidden: a visible
  // "Not configured" row is more honest than a feature nobody can find, and
  // it makes the remaining work legible inside the product.
  return (
    <HairlineRow
      leading={leading}
      title={title}
      subtitle={
        built
          ? section.description
          : `${section.description} · Screen not built yet`
      }
      meta={meta}
      to={section.to ?? undefined}
      className={built ? undefined : "opacity-60"}
    />
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
        // rows still render with their labels and no status.
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
    (section) => section.needs_attention
  ).length

  return (
    <div className="min-h-full bg-white">
      <div className="mx-auto w-full max-w-[1100px] px-6 pt-12 pb-40 sm:px-10 sm:pb-28">
        <PageHeader
          title="Configuration"
          subtitle="How this barangay routes concerns, dispatches responders and verifies residents."
          actions={
            !loading && attentionCount > 0 ? (
              <span className="inline-flex items-center gap-2 text-read font-medium text-sos">
                <AlertTriangleIcon
                  className="size-5"
                  strokeWidth={2}
                  aria-hidden
                />
                {attentionCount}{" "}
                {attentionCount === 1 ? "section needs" : "sections need"}{" "}
                attention
              </span>
            ) : null
          }
        />

        {error ? <Note className="mt-8">{error}</Note> : null}

        {GROUPS.map((group) => {
          // Sections the official has no capability for are omitted, matching
          // what their sidebar shows.
          const visible = granted
            ? group.sections.filter((section) =>
                granted.includes(section.capability)
              )
            : group.sections

          if (visible.length === 0) return null

          return (
            <PageSection key={group.title} title={group.title}>
              <HairlineList>
                {visible.map((section) => (
                  <SectionRow
                    key={section.key}
                    section={section}
                    state={summary?.sections[section.key]}
                    loading={loading}
                  />
                ))}
              </HairlineList>
            </PageSection>
          )
        })}

        {!loading && granted?.length === 0 ? (
          <p className="mt-14 text-center text-read text-neutral-500">
            You do not have access to any configuration section. Ask the
            Barangay Captain to assign you a position.
          </p>
        ) : (
          <ServiceStatusSection />
        )}
      </div>
    </div>
  )
}
