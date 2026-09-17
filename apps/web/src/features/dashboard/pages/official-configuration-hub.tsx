import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  IdCardLanyard,
  MapIcon,
  MegaphoneIcon,
  ShieldCheckIcon,
  UserCogIcon,
  UsersIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { apiRequest } from "@/lib/api"
import { CAPABILITIES } from "@/features/dashboard/lib/capabilities"
import OfficialCategoriesPage from "@/features/dashboard/pages/official-categories-page"
import OfficialCommunityContentPage from "@/features/dashboard/pages/official-community-content-page"
import OfficialCoverageAreaPage from "@/features/dashboard/pages/official-coverage-area-page"
import OfficialIdProofWorkspacePage from "@/features/dashboard/pages/official-id-proof-workspace"
import OfficialRolesPage from "@/features/dashboard/pages/official-roles-page"
import OfficialUnitsPage from "@/features/dashboard/pages/official-units-page"
import OfficialUsersManagePage from "@/features/dashboard/pages/official-users-manage-page"
import { PageHeader } from "@/components/ui/page-header"
import { Note } from "@/components/ui/note"
import {
  CONFIGURATION_PAGE_SIZE,
  ConfigurationListToolbar,
  ConfigurationPager,
} from "@/features/dashboard/components/config/configuration-list-controls"
import {
  ConfigurationInfoRow,
  ConfigurationTable,
} from "@/features/dashboard/components/config/configuration-table"
import { SheetDialog, SheetIconButton } from "@/features/dashboard/components/sheet-dialog"
import { ServiceStatusSection } from "@/features/dashboard/components/official/service-status-section"

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
  group: "User management" | "Operations"
  capability: string
}

const GROUPS: { title: string; sections: SectionDef[] }[] = [
  {
    title: "User management",
    sections: [
      { key: "units", label: "Units", description: "Barangay units, desks and committees", icon: UsersIcon, to: "/dashboard/configuration/units", group: "User management", capability: CAPABILITIES.manageUnits },
      { key: "roles", label: "Permissions", description: "What each position is allowed to do", icon: ShieldCheckIcon, to: "/dashboard/configuration/roles", group: "User management", capability: CAPABILITIES.manageRoles },
      { key: "users", label: "Users", description: "Accounts, unit assignments and status", icon: UserCogIcon, to: "/dashboard/configuration/users", group: "User management", capability: CAPABILITIES.manageUsers },
    ],
  },
  {
    title: "Operations",
    sections: [
      { key: "categories", label: "Report categories", description: "What residents can report, where it goes, and what appears in SOS", icon: FolderOpenIcon, to: "/dashboard/configuration/categories", group: "Operations", capability: CAPABILITIES.manageCategories },
      { key: "coverage", label: "Coverage area", description: "The area where your station accepts reports", icon: MapIcon, to: "/dashboard/configuration/coverage", group: "Operations", capability: CAPABILITIES.configureGeography },
      { key: "verification", label: "ID Documents", description: "Which documents prove a resident lives here", icon: IdCardLanyard, to: "/dashboard/configuration/id-proof-template", group: "Operations", capability: CAPABILITIES.manageUsers },
      { key: "announcements", label: "Announcements", description: "Advisories, schedules and resident updates", icon: MegaphoneIcon, to: "/dashboard/configuration/announcements", group: "Operations", capability: CAPABILITIES.publishAnnouncements },
    ],
  },
]

const ALL_SECTIONS = GROUPS.flatMap((g) => g.sections)

const SECTION_PAGES: Record<string, React.ComponentType<{ embedded?: boolean }>> = {
  categories: OfficialCategoriesPage,
  users: OfficialUsersManagePage,
  roles: OfficialRolesPage,
  coverage: OfficialCoverageAreaPage,
  verification: OfficialIdProofWorkspacePage,
  announcements: OfficialCommunityContentPage,
  units: OfficialUnitsPage,
}

export default function OfficialConfigurationHubPage({
  initialMonitoringKey,
}: {
  initialMonitoringKey?: "system" | "audit"
}) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [groupFilter, setGroupFilter] = useState("all")
  const [offset, setOffset] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiRequest<SummaryResponse>("/config/summary/")
      .then((data) => { if (!cancelled) setSummary(data) })
      .catch(() => { if (!cancelled) setError("Live status is unavailable right now.") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const granted = summary?.capabilities
  const attentionCount = Object.values(summary?.sections ?? {}).filter((s) => s.needs_attention).length
  const visible = ALL_SECTIONS.filter((s) => granted ? granted.includes(s.capability) : true)

  const filters = [
    { key: "all", label: "All sections", count: visible.length },
    { key: "User management", label: "User management", count: visible.filter((s) => s.group === "User management").length },
    { key: "Operations", label: "Operations", count: visible.filter((s) => s.group === "Operations").length },
  ]

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return visible.filter((s) => {
      if (groupFilter !== "all" && s.group !== groupFilter) return false
      if (q && !`${s.label} ${s.description}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [visible, query, groupFilter])

  const page = filtered.slice(offset, offset + CONFIGURATION_PAGE_SIZE)

  const closeSheet = () => {
    setSheetOpen(false)
    setActiveSection(null)
  }

  const openSection = (key: string) => {
    setActiveSection(key)
    setSheetOpen(true)
  }

  const ActivePage = activeSection ? SECTION_PAGES[activeSection] : null

  return (
    <div className="min-h-full bg-white">
      <div className="mx-auto w-full max-w-[1100px] px-6 pt-6 pb-6 sm:px-10 sm:pt-8 lg:pb-20">
        <PageHeader
          title={<>Set up your <span className="text-brand-orange">Area</span></>}
          subtitle="Manage how your community routes concerns, dispatches responders and verifies residents."
          actions={
            !loading && attentionCount > 0 ? (
              <span className="inline-flex items-center gap-2 text-read font-medium text-sos">
                <AlertTriangleIcon className="size-5" strokeWidth={2} aria-hidden />
                {attentionCount}{" "}
                {attentionCount === 1 ? "section needs" : "sections need"}{" "}
                attention
              </span>
            ) : null
          }
        />
        {error ? <Note className="mt-4">{error}</Note> : null}
        {!loading && (
          <div className="mt-4">
            <ConfigurationListToolbar
              search={query}
              onSearch={(value) => { setQuery(value); setOffset(0) }}
              placeholder="Search sections"
              filters={filters}
              activeFilter={groupFilter}
              onFilter={(value) => { setGroupFilter(value); setOffset(0) }}
            />
          </div>
        )}
        {page.length === 0 ? (
          <div className="mt-8 py-16 text-center">
            <FolderOpenIcon className="mx-auto size-7 text-neutral-300" aria-hidden />
            <h2 className="mt-4 text-row font-semibold text-brand-navy">{query ? "No sections match this view" : "No configuration sections"}</h2>
            <p className="mt-2 text-read text-neutral-500">{query ? "Try a different search." : "You do not have access to any configuration section. Ask the Barangay Captain to assign you a position."}</p>
          </div>
        ) : (
          <ConfigurationTable label="Configuration sections" hideHeader>
            {page.map((section) => (
              <ConfigurationInfoRow
                key={section.key}
                icon={section.icon}
                title={section.label}
                description={section.description}
                actions={
                  <SheetIconButton label={`Open ${section.label}`} onClick={() => openSection(section.key)}>
                    <ChevronRightIcon className="size-5" strokeWidth={2} aria-hidden />
                  </SheetIconButton>
                }
              />
            ))}
          </ConfigurationTable>
        )}
        {!loading && filtered.length > 0 && (
          <ConfigurationPager key={offset} offset={offset} total={filtered.length} onChange={setOffset} noun="sections" />
        )}
        {!loading && (!granted?.length || visible.length === 0) ? (
          <p className="mt-7 text-center text-read text-neutral-500">You do not have access to any configuration section. Ask the Barangay Captain to assign you a position.</p>
        ) : null}
        <ServiceStatusSection initialOpen={initialMonitoringKey} />
      </div>
      <SheetDialog
        open={sheetOpen}
        onClose={closeSheet}
        title={<>Set up your <span className="text-brand-orange">Area</span></>}
        description="Manage how your community routes concerns, dispatches responders and verifies residents."
        size="wide"
        draggable
        bodyScrollable={false}
        className="h-[min(720px,92dvh)]"
        bodyClassName="px-5 sm:px-7"
      >
        {ActivePage ? <ActivePage embedded /> : null}
      </SheetDialog>
    </div>
  )
}
