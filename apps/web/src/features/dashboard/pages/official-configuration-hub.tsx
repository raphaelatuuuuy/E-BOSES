import { useEffect, useState } from "react"
import {
  AlertTriangleIcon,
  FolderOpenIcon,
  IdCardLanyard,
  MapIcon,
  MegaphoneIcon,
  PlusIcon,
  SaveIcon,
  ShieldCheckIcon,
  UserCogIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import { CAPABILITIES } from "@/features/dashboard/lib/capabilities"
import { PageHeader, PageSection } from "@/components/ui/page-header"
import { Note } from "@/components/ui/note"
import { SheetDialog, SheetIconButton } from "@/features/dashboard/components/sheet-dialog"
import { ServiceStatusSection } from "@/features/dashboard/components/official/service-status-section"
import OfficialCategoriesPage from "@/features/dashboard/pages/official-categories-page"
import OfficialCommunityContentPage from "@/features/dashboard/pages/official-community-content-page"
import OfficialCoverageAreaPage from "@/features/dashboard/pages/official-coverage-area-page"
import OfficialIdProofWorkspacePage from "@/features/dashboard/pages/official-id-proof-workspace"
import OfficialRolesPage from "@/features/dashboard/pages/official-roles-page"
import OfficialUnitsPage from "@/features/dashboard/pages/official-units-page"
import OfficialUsersManagePage from "@/features/dashboard/pages/official-users-manage-page"

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
        label: "Report categories",
        description: "What residents can report, where it goes, and what appears in SOS",
        icon: FolderOpenIcon,
        to: "/dashboard/configuration/categories",
        capability: CAPABILITIES.manageCategories,
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
      {
        key: "announcements",
        label: "Announcements",
        description: "Advisories, schedules and resident updates",
        icon: MegaphoneIcon,
        to: "/dashboard/configuration/announcements",
        capability: CAPABILITIES.publishAnnouncements,
      },
    ],
  },
]

function SectionRow({
  section,
  merged = false,
  onOpen,
}: {
  section: SectionDef
  merged?: boolean
  onOpen?: (section: SectionDef) => void
}) {
  const Icon = section.icon
  const built = Boolean(section.to)
  const cardClassName = cn(
    merged
      ? "group relative flex min-h-[104px] min-w-0 flex-col rounded-none border-0 border-r border-neutral-200 bg-white p-3 pb-12 text-left no-underline transition-colors duration-200 ease-out last:border-r-0"
      : "group relative flex min-h-[104px] min-w-0 flex-col rounded-2xl border border-neutral-200 bg-white p-3 pb-12 text-left no-underline shadow-[0_3px_16px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow,background-color] duration-200 ease-out",
    built && "hover:border-neutral-300 hover:bg-neutral-100 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/30",
    !built && "opacity-60",
  )
  const cardContent = (
    <>
      <h3 className="text-[12.5px] font-bold text-neutral-900">
        {section.label}
      </h3>
      <p className="mt-1 break-words text-[10.5px] leading-relaxed text-neutral-500">
        {section.description}
      </p>
      <span className="absolute right-2.5 bottom-2.5 flex size-[30px] items-center justify-center rounded-full bg-brand-navy text-white transition-colors group-hover:bg-brand-orange group-hover:text-white">
        <Icon className="size-4" strokeWidth={1.9} aria-hidden />
      </span>
    </>
  )

  return section.to ? (
    <button type="button" onClick={() => onOpen?.(section)} className={cardClassName} aria-haspopup="dialog">
      {cardContent}
    </button>
  ) : (
    <div className={cardClassName}>{cardContent}</div>
  )
}

function ConfigurationSection({ section }: { section: SectionDef }) {
  switch (section.key) {
    case "units": return <OfficialUnitsPage embedded />
    case "roles": return <OfficialRolesPage embedded />
    case "users": return <OfficialUsersManagePage embedded />
    case "categories": return <OfficialCategoriesPage embedded />
    case "coverage": return <OfficialCoverageAreaPage embedded />
    case "verification": return <OfficialIdProofWorkspacePage embedded />
    case "announcements": return <OfficialCommunityContentPage embedded />
    default: return null
  }
}

function actionFor(section: SectionDef) {
  if (section.key === "coverage") return { label: "Save coverage", icon: SaveIcon }
  if (section.key === "verification") return { label: "Add proof type", icon: PlusIcon }
  if (section.key === "users") return { label: "Create user", icon: PlusIcon }
  if (section.key === "roles") return { label: "New position", icon: PlusIcon }
  if (section.key === "categories") return { label: "Add category", icon: PlusIcon }
  if (section.key === "announcements") return { label: "New announcement", icon: PlusIcon }
  return { label: "New unit", icon: PlusIcon }
}

export default function OfficialConfigurationHubPage({
  initialSectionKey,
  initialMonitoringKey,
}: {
  initialSectionKey?: string
  initialMonitoringKey?: "system" | "audit"
}) {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const initialSection = GROUPS.flatMap((group) => group.sections).find(
    (section) => section.key === initialSectionKey,
  ) ?? null
  const [activeSection, setActiveSection] = useState<SectionDef | null>(initialSection)

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
  const closeSection = () => {
    setActiveSection(null)
    if (initialSectionKey || initialMonitoringKey) {
      navigate("/dashboard/configuration", { replace: true })
    }
  }
  return (
    <div className="min-h-full bg-white">
      <div className="mx-auto w-full max-w-[1100px] px-6 pt-6 pb-6 sm:px-10 sm:pt-8 lg:pb-20">
        <PageHeader
          title={
            <>
              Set up your <span className="text-brand-orange">Area</span>
            </>
          }
          subtitle="Manage how your community routes concerns, dispatches responders and verifies residents."
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

        {error ? <Note className="mt-4">{error}</Note> : null}

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
            <PageSection
              key={group.title}
              title={group.title}
              className="mt-7 [&>div]:mb-3"
            >
              <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_3px_16px_rgba(15,23,42,0.04)]">
                {visible.map((section) => (
                  <SectionRow
                    key={section.key}
                    section={section}
                    merged
                    onOpen={setActiveSection}
                  />
                ))}
              </div>
            </PageSection>
          )
        })}

        {!loading && granted?.length === 0 ? (
          <p className="mt-7 text-center text-read text-neutral-500">
            You do not have access to any configuration section. Ask the
            Barangay Captain to assign you a position.
          </p>
        ) : (
          <ServiceStatusSection initialOpen={initialMonitoringKey} />
        )}
      </div>
      <SheetDialog
        open={Boolean(activeSection)}
        onClose={closeSection}
        title={activeSection?.label ?? "Configuration"}
        description={activeSection?.description}
        size="wide"
        draggable
        actions={activeSection ? (() => {
          const action = actionFor(activeSection)
          const Icon = action.icon
          return <SheetIconButton label={action.label} onClick={() => window.dispatchEvent(new Event("configuration-primary-action"))}><Icon className="size-5" strokeWidth={1.9} aria-hidden /></SheetIconButton>
        })() : null}
        bodyClassName="px-5 sm:px-7"
      >
        {activeSection ? <ConfigurationSection section={activeSection} /> : null}
      </SheetDialog>
    </div>
  )
}
