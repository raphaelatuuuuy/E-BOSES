import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  InfoIcon,
  ClockIcon,
  CheckIcon,
  MapPinIcon,
  MessageSquareIcon,
  PencilLineIcon,
  Share2Icon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { Concern, PublicUser } from "@/features/dashboard/api"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { useAuthSession } from "@/features/auth/auth-session"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import { ReportLocationMap } from "@/features/dashboard/components/report-location-map"
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import { buildConcernTimelineEntries } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import {
  avatarTone,
  ConcernCommentsList,
  concernReporterName,
  ConcernEngagementFooter,
  initialsOf,
  useConcernComments,
} from "@/features/dashboard/components/concerns/concern-queue-item"
import { EmergencyEngagementFooter } from "@/features/dashboard/components/concerns/emergency-queue-item"
import { unitShortTag } from "@/features/dashboard/components/concerns/concern-display"
import {
  canPublishConcern,
  canShareConcern,
  shareConcernReport,
} from "@/features/dashboard/lib/share-report"
import { streetOnly } from "@/features/dashboard/lib/location-text"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import {
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { SheetDialog } from "@/features/dashboard/components/sheet-dialog"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { IncidentMap } from "@/features/dashboard/components/emergencies/incident-board"
import { EmergencyTimelineCard } from "@/features/dashboard/components/emergencies/emergency-timeline-card"
import { buildEmergencyTimeline } from "@/features/dashboard/components/emergencies/emergency-timeline-lib"
import { EmergencyResolutionSheet } from "@/features/dashboard/components/responder/emergency-resolution-sheet"
import { useIncidentActions } from "@/features/dashboard/components/responder/use-incident-actions"
import { EmergencyCommunityComments } from "@/features/dashboard/components/emergencies/community-comments"
import { EmergencyResolutionBanner } from "@/features/dashboard/components/emergencies/emergency-resolution-banner"
import { isEmergencyActive } from "@/features/dashboard/lib/status-vocabulary"
import { emergencyDescription } from "@/features/dashboard/lib/emergency-description"
import {
  emergencyResponderAssignments,
  historicalRouteSummary,
} from "@/features/dashboard/components/emergencies/lib"

type MobileTab = "info" | "chat" | "updates"

/** Info tab content — flat layout, no cards. */
function InfoTabContent({
  report,
  fullName,
  initials,
  unit,
  unitTag,
  unitRole,
  audience,
  street,
  setProofPreview,
}: {
  report: Concern
  fullName: string
  initials: string
  unit:
    | NonNullable<Concern["assigned_department"]>
    | NonNullable<Concern["community_incident"]>["assigned_unit"]
    | null
  unitTag: string
  unitRole: string
  audience: "resident" | "official"
  street: string | null
  setProofPreview: (v: { items: MediaPreviewItem[]; index: number }) => void
}) {
  const showAssignedUnit = audience === "resident" && Boolean(unit)
  const identityName = showAssignedUnit ? unit?.name : fullName
  const identityLabel = showAssignedUnit ? unitRole : "Resident"
  const [showComments, setShowComments] = useState(false)
  const {
    comments,
    loading: commentsLoading,
    load: loadComments,
  } = useConcernComments(report.public_id)

  return (
    <div className="space-y-5">
      {/* Report identity */}
      <div>
        <p className="mb-2 text-[10px] font-bold tracking-[0.06em] text-neutral-600 uppercase">
          {audience === "official" ? "Reported by" : "Assigned to"}
        </p>
        <div className="flex flex-col items-center text-center">
          <span
            className={cn(
              "flex size-14 items-center justify-center rounded-full px-1 text-center leading-none",
              avatarTone,
              showAssignedUnit
                ? "text-[13px] font-bold"
                : "text-[18px] font-bold"
            )}
          >
            {showAssignedUnit ? unitTag : initials}
          </span>
          <p className="mt-2 text-[17px] leading-tight font-bold text-neutral-900">
            {identityName || "Resident"}
          </p>
          <p className="text-[12px] text-neutral-500">{identityLabel}</p>
        </div>
      </div>

      {/* Description */}
      {report.description ? (
        <div>
          <p className="mb-1 text-[10px] font-bold tracking-[0.06em] text-neutral-600 uppercase">
            Description
          </p>
          <p className="text-[14px] leading-relaxed text-neutral-800">
            {report.description}
          </p>
        </div>
      ) : null}

      {/* Location */}
      {street ? (
        <div className="flex items-center gap-2 text-[13px] text-neutral-500">
          <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {street}
        </div>
      ) : null}

      {/* Media grid */}
      {(report.media ?? []).length > 0 ? (
        <div>
          <p className="mb-2 text-[10px] font-bold tracking-[0.06em] text-neutral-600 uppercase">
            Media
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(report.media ?? []).map((media, index) =>
              media.mime_type?.startsWith("image/") ? (
                <button
                  key={media.id}
                  type="button"
                  onClick={() => {
                    const items = (report.media ?? []).map((m) =>
                      toMediaPreviewItem(
                        mediaDisplaySource(m),
                        m.original_filename ?? `Media ${index + 1}`,
                        m.mime_type
                      )
                    )
                    setProofPreview({ items, index })
                  }}
                  className="overflow-hidden rounded-xl border border-neutral-300 bg-white transition-colors hover:border-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <AuthenticatedMediaImage
                    src={mediaDisplaySource(media)}
                    alt={media.original_filename ?? `Media ${index + 1}`}
                    className="h-24 w-full object-cover"
                  />
                </button>
              ) : null
            )}
          </div>
        </div>
      ) : null}

      <ConcernEngagementFooter
        concern={report}
        commentsOpen={showComments}
        onCommentsClick={() => {
          const next = !showComments
          setShowComments(next)
          if (next) void loadComments()
        }}
      />
      {showComments ? (
        <ConcernCommentsList comments={comments} loading={commentsLoading} />
      ) : null}
    </div>
  )
}

export function MobileReportDetailPage({
  report,
  onBack,
  onRefresh,
  viewer,
  headerAction,
  canDecideAppeals = false,
  audience = "resident",
  onPublish,
}: {
  report: Concern
  onBack: () => void
  onRefresh: () => Promise<void>
  viewer?: PublicUser | null
  headerAction?: ReactNode
  canDecideAppeals?: boolean
  audience?: "resident" | "official"
  onPublish?: (report: Concern) => Promise<Concern>
}) {
  const { user } = useAuthSession()
  const [tab, setTab] = useState<MobileTab>("info")
  const [proofPreview, setProofPreview] = useState<{
    items: MediaPreviewItem[]
    index: number
  } | null>(null)
  const [shared, setShared] = useState(false)

  const fullName = concernReporterName(report)
  const initials = (report.reporter?.initials || initialsOf(fullName)).charAt(0)
  const unit =
    report.validation_status === "accepted"
      ? (report.assigned_department ??
        report.community_incident?.assigned_unit ??
        null)
      : null
  const unitTag = unitShortTag(unit)
  const unitRole =
    unit?.description?.trim() ||
    report.category_ref?.description?.trim() ||
    "Assigned response unit"
  const showAssignedUnit = audience === "resident" && Boolean(unit)
  const identityName = showAssignedUnit ? unit?.name : fullName
  const identityLabel = showAssignedUnit ? unitRole : "Resident"
  const closedCase = ["rejected", "appealed", "resolved"].includes(
    report.status
  )
  const isOwnReport = user?.id === report.reporter?.id
  const canFileAppeal = Boolean(
    isOwnReport &&
    report.status === "rejected" &&
    !(report.appeals ?? []).some((appeal) => appeal.status === "submitted")
  )
  const publishing = canPublishConcern(report)

  async function handleShare() {
    try {
      const shareableReport =
        publishing && onPublish ? await onPublish(report) : report
      const didShare = await shareConcernReport(shareableReport)
      if (didShare) {
        setShared(true)
        window.setTimeout(() => setShared(false), 1800)
      }
    } catch {
      toast.error("Could not share this report publicly.")
    }
  }

  const canShareAction =
    canShareConcern(report) || (publishing && Boolean(onPublish))

  const timeline = buildConcernTimelineEntries(
    report,
    (items, index) => setProofPreview({ items, index }),
    viewer
  )

  const street = streetOnly(
    report.community_incident?.address || report.address
  )

  const tabOptions: { key: MobileTab; icon: ReactNode }[] = [
    {
      key: "chat",
      icon: <MessageSquareIcon className="size-4" aria-hidden="true" />,
    },
    {
      key: "updates",
      icon: <ClockIcon className="size-4" aria-hidden="true" />,
    },
  ]

  return (
    <>
      {proofPreview ? (
        <MediaLightbox
          items={proofPreview.items}
          index={proofPreview.index}
          onClose={() => setProofPreview(null)}
        />
      ) : null}

      <SheetDialog
        open
        onClose={onBack}
        size="wide"
        className="max-h-[min(800px,92vh)] sm:max-h-[min(800px,92vh)]"
        bodyClassName="flex flex-col px-5"
        /* Custom header: title + description + actions slot */
        title="Report details"
        actions={
          <div className="flex items-center gap-1">
            {headerAction}
            {/* Info icon — switches to info tab */}
            <button
              type="button"
              onClick={() => setTab("info")}
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none",
                tab === "info"
                  ? "text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-800"
              )}
              aria-label="View report info"
            >
              <InfoIcon className="size-5" aria-hidden="true" />
            </button>

            {/* Pill toggle: Chat / Updates */}
            <div className="flex items-center gap-0.5 rounded-full bg-neutral-100 p-0.5">
              {tabOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setTab(opt.key)}
                  className={cn(
                    "flex items-center justify-center rounded-full p-2 transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none",
                    tab === opt.key
                      ? "bg-white text-neutral-900 shadow-sm"
                      : "text-neutral-500 hover:text-neutral-800"
                  )}
                >
                  {opt.icon}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {/* Tab content */}
        {tab === "info" ? (
          <InfoTabContent
            report={report}
            fullName={fullName}
            initials={initials}
            unit={unit}
            unitTag={unitTag}
            unitRole={unitRole}
            audience={audience}
            street={street}
            setProofPreview={(v) => setProofPreview(v)}
          />
        ) : tab === "chat" ? (
          <div className="-mx-1 flex min-h-0 flex-1 flex-col">
            {/* Share to public — pinned to the left corner of the chat container */}
            {audience === "resident" && canShareAction ? (
              <div className="flex px-1 pt-1">
                <button
                  type="button"
                  onClick={() => void handleShare()}
                  title={publishing ? "Share to public" : "Share report"}
                  aria-label={publishing ? "Share to public" : "Share report"}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  {shared ? (
                    <CheckIcon className="size-4.5" aria-hidden="true" />
                  ) : (
                    <Share2Icon className="size-4.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            ) : null}
            {/* Chat header — the same identity block shown in report info */}
            <div className="flex flex-col items-center px-1 pt-2 pb-4 text-center">
              <span
                className={cn(
                  "flex size-14 items-center justify-center rounded-full px-1 text-center leading-none",
                  avatarTone,
                  showAssignedUnit
                    ? "text-[13px] font-bold"
                    : "text-[18px] font-bold"
                )}
              >
                {showAssignedUnit ? unitTag : initials}
              </span>
              <p className="mt-2 text-[17px] leading-tight font-bold text-neutral-900">
                {identityName || "Resident"}
              </p>
              <p className="text-[12px] text-neutral-500">{identityLabel}</p>
            </div>
            <ReportChatPanel
              key={`mobile-chat-${report.id}`}
              concernId={report.id}
              open
              showHistory
              plain
              disabled={closedCase}
              emptyMessage="Message the barangay team about this report — questions, extra photos, or access details stay here."
              appeals={report.appeals ?? []}
              canFileAppeal={canFileAppeal}
              canDecideAppeals={canDecideAppeals}
              onAppealsChanged={onRefresh}
              onMessageSent={onRefresh}
              className="h-full min-h-0 flex-1"
            />
          </div>
        ) : (
          /* Updates tab */
          <div className="space-y-5">
            <div>
              <div className="flex items-center gap-2.5 pb-3">
                <ClockIcon
                  className="size-4 text-neutral-600"
                  aria-hidden="true"
                />
                <h3 className="text-[15px] font-semibold text-neutral-900">
                  Updates
                </h3>
              </div>
              <ConcernTimeline
                key={report.id}
                items={timeline}
                collapsibleHistory
              />
            </div>

            <div>
              <div className="flex items-center gap-2.5 pb-3">
                <MapPinIcon
                  className="size-4 text-neutral-600"
                  aria-hidden="true"
                />
                <h3 className="text-[15px] font-semibold text-neutral-900">
                  Location
                </h3>
                {street ? (
                  <span className="min-w-0 truncate text-[12px] font-medium text-neutral-500">
                    {street}
                  </span>
                ) : null}
              </div>
              <ReportLocationMap
                latitude={report.latitude}
                longitude={report.longitude}
                streetAddress={
                  report.community_incident?.address || report.address
                }
                category={report.category}
                iconKey={report.category_ref?.icon_key}
                heightClassName="h-48"
                className="overflow-hidden rounded-[16px] border border-neutral-100"
              />
            </div>
          </div>
        )}
      </SheetDialog>
    </>
  )
}

/**
 * Emergency version of the same report-details sheet. It intentionally uses
 * the exact SheetDialog header, tab switcher, spacing, and pinned footer as
 * MobileReportDetailPage; only the record data and operational actions differ.
 */
export function MobileEmergencyReportDetailPage({
  alert,
  onBack,
  onRefresh,
  audience = "responder",
  viewerId = null,
  onChanged,
}: {
  alert: EmergencyAlert
  onBack: () => void
  onRefresh: () => Promise<void>
  audience?: "official" | "responder"
  viewerId?: number | null
  onChanged: (next: EmergencyAlert) => void
}) {
  const [tab, setTab] = useState<MobileTab>("info")
  const [proofPreview, setProofPreview] = useState<{
    items: MediaPreviewItem[]
    index: number
  } | null>(null)
  const [resolutionOpen, setResolutionOpen] = useState(false)
  const [communityCommentsOpen, setCommunityCommentsOpen] = useState(false)
  const timeline = buildEmergencyTimeline(alert)
  const reporterName =
    alert.reporter_display?.trim() ||
    alert.reporter?.full_name?.trim() ||
    "Resident"
  const reporterInitial = (alert.reporter?.initials || reporterName)
    .charAt(0)
    .toUpperCase()
  const location = streetOnly(
    alert.display_location ||
      alert.resolved_location ||
      alert.reported_area ||
      alert.address ||
      alert.barangay
  )
  const description = emergencyDescription(alert)
  const settled = !isEmergencyActive(alert.status)
  const historicalResponders = emergencyResponderAssignments(alert)
  const responderActions = useIncidentActions({
    alert,
    viewerId,
    onChanged,
    onRefresh,
    onResolveRequested: () => setResolutionOpen(true),
  })
  const terminal = [
    "cancelled",
    "resolved",
    "closed",
    "false_alarm",
    "invalid",
  ].includes(alert.status)
  const responderOwnsChat =
    audience !== "responder" || responderActions.hasOwnAssignment

  const tabOptions: { key: MobileTab; icon: ReactNode }[] = [
    {
      key: "chat",
      icon: <MessageSquareIcon className="size-4" aria-hidden="true" />,
    },
    {
      key: "updates",
      icon: <ClockIcon className="size-4" aria-hidden="true" />,
    },
  ]

  return (
    <>
      {proofPreview ? (
        <MediaLightbox
          items={proofPreview.items}
          index={proofPreview.index}
          onClose={() => setProofPreview(null)}
        />
      ) : null}

      <SheetDialog
        open
        onClose={onBack}
        size="wide"
        className="max-h-[min(800px,92vh)] sm:max-h-[min(800px,92vh)]"
        bodyClassName="flex flex-col px-5"
        title="Report details"
        actions={
          <div className="flex items-center gap-1">
            {!terminal &&
            (audience === "official" || responderActions.hasOwnAssignment) ? (
              <button
                type="button"
                onClick={() => setResolutionOpen(true)}
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                aria-label="Update the status"
                title="Update the status"
              >
                <PencilLineIcon className="size-4" aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setTab("info")}
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none",
                tab === "info"
                  ? "text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-800"
              )}
              aria-label="View report info"
            >
              <InfoIcon className="size-5" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-0.5 rounded-full bg-neutral-100 p-0.5">
              {tabOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setTab(opt.key)}
                  className={cn(
                    "flex items-center justify-center rounded-full p-2 transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none",
                    tab === opt.key
                      ? "bg-white text-neutral-900 shadow-sm"
                      : "text-neutral-500 hover:text-neutral-800"
                  )}
                  aria-label={opt.key === "chat" ? "Open chat" : "Open updates"}
                >
                  {opt.icon}
                </button>
              ))}
            </div>
          </div>
        }
        footer={
          audience === "responder" &&
          !responderActions.hasOwnAssignment &&
          !terminal ? (
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="flex h-12 w-full items-center justify-center rounded-full bg-brand-orange px-5 text-[15px] font-semibold text-white transition-colors hover:bg-brand-orange-strong focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Respond to incident
            </button>
          ) : undefined
        }
      >
        {tab === "info" ? (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-[10px] font-bold tracking-[0.06em] text-neutral-600 uppercase">
                Reported by
              </p>
              <div className="flex flex-col items-center text-center">
                <span
                  className={cn(
                    "flex size-14 items-center justify-center rounded-full px-1 text-center text-[18px] leading-none font-bold",
                    avatarTone
                  )}
                >
                  {reporterInitial}
                </span>
                <p className="mt-2 text-[17px] leading-tight font-bold text-neutral-900">
                  {reporterName}
                </p>
                <p className="text-[12px] text-neutral-500">Resident</p>
              </div>
            </div>

            <p className="text-[14px] leading-relaxed text-neutral-800">
              {description}
            </p>

            {location ? (
              <div className="flex items-center gap-2 text-[13px] text-neutral-500">
                <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
                {location}
              </div>
            ) : null}

            {settled && historicalResponders.length ? (
              <div className="space-y-1.5 rounded-[14px] bg-neutral-50 px-3 py-2.5 text-[12px] leading-relaxed text-neutral-600 ring-1 ring-neutral-200">
                <p className="font-semibold text-neutral-800">Responded</p>
                {historicalResponders.map((assignment) => (
                  <p key={`mobile-past-response-${assignment.id}`}>
                    {assignment.responder.full_name || "Responder"} responded.
                    Route taken: {historicalRouteSummary(assignment.route)}.
                  </p>
                ))}
              </div>
            ) : alert.current_assignment?.responder ? null : (
              <p className="rounded-[14px] bg-neutral-50 px-3 py-2 text-[12px] leading-relaxed text-neutral-600 ring-1 ring-neutral-200">
                Automatically routing to the nearest available responder.
              </p>
            )}

            <div>
              <p className="mb-2 text-[10px] font-bold tracking-[0.06em] text-neutral-600 uppercase">
                Media
              </p>
              {alert.media?.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {alert.media.slice(0, 5).map((media, index) => (
                    <button
                      key={media.id}
                      type="button"
                      onClick={() =>
                        setProofPreview({
                          items: alert.media!.map((item) =>
                            toMediaPreviewItem(
                              item.preview_url,
                              item.original_filename,
                              item.mime_type
                            )
                          ),
                          index,
                        })
                      }
                      className="overflow-hidden rounded-xl border border-neutral-300 bg-white transition-colors hover:border-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                    >
                      <AuthenticatedMediaImage
                        src={media.preview_url}
                        alt={media.original_filename}
                        className="h-24 w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-neutral-500">
                  No media attached.
                </p>
              )}
            </div>

            <EmergencyEngagementFooter
              alert={alert}
              commentsOpen={communityCommentsOpen}
              onCommentsClick={() => setCommunityCommentsOpen((open) => !open)}
            />
            {alert.is_public && communityCommentsOpen ? (
              <>
                <EmergencyResolutionBanner alert={alert} />
                <EmergencyCommunityComments alertId={alert.id} />
              </>
            ) : null}
          </div>
        ) : tab === "chat" ? (
          responderOwnsChat ? (
            <div className="-mx-1 flex min-h-0 flex-1 flex-col">
              <div className="flex flex-col items-center px-1 pt-2 pb-4 text-center">
                <span
                  className={cn(
                    "flex size-14 items-center justify-center rounded-full px-1 text-center text-[18px] leading-none font-bold",
                    avatarTone
                  )}
                >
                  {reporterInitial}
                </span>
                <p className="mt-2 text-[17px] leading-tight font-bold text-neutral-900">
                  {reporterName}
                </p>
                <p className="text-[12px] text-neutral-500">Resident</p>
              </div>
              <EmergencyChatPanel
                key={`mobile-emergency-chat-${alert.id}`}
                alertId={alert.id}
                open
                theme="light"
                variant="modern"
                bare
                disabled={terminal}
                className="h-full min-h-0 flex-1"
              />
            </div>
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
              <p className="text-[15px] font-semibold text-neutral-900">
                Respond to incident
              </p>
              <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-neutral-500">
                This alert is assigned to another responder. Automatic routing
                will update this sheet when the assignment changes.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-5">
            <div>
              <div className="flex items-center gap-2.5 pb-3">
                <ClockIcon
                  className="size-4 text-neutral-600"
                  aria-hidden="true"
                />
                <h3 className="text-[15px] font-semibold text-neutral-900">
                  Updates
                </h3>
              </div>
              <EmergencyTimelineCard
                key={`mobile-emergency-timeline-${alert.id}`}
                items={timeline}
                collapsibleHistory
                emptyLabel="No timeline events have been recorded for this emergency yet."
              />
            </div>

            <div>
              <div className="flex items-center gap-2.5 pb-3">
                <MapPinIcon
                  className="size-4 text-neutral-600"
                  aria-hidden="true"
                />
                <h3 className="text-[15px] font-semibold text-neutral-900">
                  Location
                </h3>
                {location ? (
                  <span className="min-w-0 truncate text-[12px] font-medium text-neutral-500">
                    {location}
                  </span>
                ) : null}
              </div>
              <div className="h-48 overflow-hidden rounded-[16px] border border-neutral-100">
                <IncidentMap alert={alert} viewerId={viewerId} />
              </div>
            </div>
          </div>
        )}
      </SheetDialog>

      {audience === "responder" || audience === "official" ? (
        <EmergencyResolutionSheet
          alert={alert}
          open={resolutionOpen}
          onClose={() => setResolutionOpen(false)}
          onResolved={(next) => {
            onChanged(next)
            void onRefresh()
          }}
        />
      ) : null}
    </>
  )
}
