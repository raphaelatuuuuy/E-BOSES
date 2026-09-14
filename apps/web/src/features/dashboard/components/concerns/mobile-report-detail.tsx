import { useState, type ReactNode } from "react"
import {
  InfoIcon,
  ClockIcon,
  MapPinIcon,
  MessageSquareIcon,
  PhoneIcon,
  PencilLineIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import {
  ReportDescriptionCard,
  ReportAssignmentFooter,
} from "@/features/dashboard/components/concerns/report-detail-content"

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
import { streetOnly } from "@/features/dashboard/lib/location-text"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import {
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

function residentSummaryLine(value: string) {
  const clean = value.trim()
  if (!clean) return "The resident submitted this emergency."
  if (/^the resident\b/i.test(clean)) return clean
  const softened = /^[A-Z]/.test(clean)
    ? `${clean.slice(0, 1).toLowerCase()}${clean.slice(1)}`
    : clean
  return `The resident reports ${softened.replace(/[.!?]+$/, "")}.`
}

/** Info tab content — flat layout, no cards. */
function InfoTabContent({
  report,
  street,
  setProofPreview,
}: {
  report: Concern
  street: string | null
  setProofPreview: (v: { items: MediaPreviewItem[]; index: number }) => void
}) {
  const [showComments, setShowComments] = useState(false)
  const {
    comments,
    loading: commentsLoading,
    load: loadComments,
  } = useConcernComments(report.public_id)

  return (
    <div className="space-y-5">
      <ReportDescriptionCard
        report={report}
        onMediaPreview={(items, index) => setProofPreview({ items, index })}
      />

      {/* Location */}
      {street ? (
        <div className="flex items-center gap-2 text-[13px] text-neutral-500">
          <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {street}
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
}: {
  report: Concern
  onBack: () => void
  onRefresh: () => Promise<void>
  viewer?: PublicUser | null
  headerAction?: ReactNode
  canDecideAppeals?: boolean
  audience?: "resident" | "official"
}) {
  const { user } = useAuthSession()
  const [tab, setTab] = useState<MobileTab>("info")
  const [proofPreview, setProofPreview] = useState<{
    items: MediaPreviewItem[]
    index: number
  } | null>(null)

  const fullName = concernReporterName(report)
  const isGuestReport =
    Boolean(report.is_anonymous) ||
    fullName.trim().toLowerCase() === "community reporter"
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
  const showAssignedUnit =
    audience === "resident" && Boolean(unit) && !isGuestReport
  const identityName = showAssignedUnit
    ? `${unit?.name ?? "Assigned unit"}${unit?.short_name ? ` (${unit.short_name})` : ""}`
    : fullName
  const identityLabel = isGuestReport
    ? "Anonymous"
    : showAssignedUnit
      ? unitRole
      : "Resident"
  const closedCase = ["rejected", "appealed", "resolved"].includes(
    report.status
  )
  const isOwnReport = user?.id === report.reporter?.id
  const canFileAppeal = Boolean(
    isOwnReport &&
    report.status === "rejected" &&
    !(report.appeals ?? []).some((appeal) => appeal.status === "submitted")
  )
  const timeline = buildConcernTimelineEntries(
    report,
    (items, index) => setProofPreview({ items, index }),
    viewer
  )

  const street = streetOnly(
    report.community_incident?.address || report.address
  )
  const assignedUnitName =
    report.assigned_department?.name?.trim() ||
    report.community_incident?.assigned_unit?.name?.trim() ||
    ""
  const visibleTab = isGuestReport && tab === "chat" ? "info" : tab

  const tabOptions: { key: MobileTab; icon: ReactNode }[] = [
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
        showClose={false}
        size="wide"
        className="h-[min(800px,72dvh)] max-h-[min(800px,72dvh)] sm:h-[min(800px,82vh)] sm:max-h-[min(800px,82vh)]"
        bodyClassName="min-h-0 flex flex-col overflow-y-auto px-5"
        backdropScrim={false}
        backdropInteractive
        backdrop={
          <ReportLocationMap
            latitude={report.latitude}
            longitude={report.longitude}
            streetAddress={
              report.community_incident?.address || report.address
            }
            category={report.category}
            iconKey={report.category_ref?.icon_key}
            status={report.status}
            severity={report.severity}
            heightClassName="h-full"
            focusAboveSheet
            onBack={visibleTab === "chat" ? () => setTab("info") : onBack}
            className="h-full w-full rounded-none"
          />
        }
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
                visibleTab === "info"
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
                    visibleTab === opt.key
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
        footer={
          visibleTab === "info" ? (
            <div className="space-y-3">
              <ReportAssignmentFooter
                report={report}
                onChat={!isGuestReport ? () => setTab("chat") : undefined}
              />
              <p className="text-center text-[11px] leading-4 text-neutral-400">
                Status updates and messages from the barangay will appear here.
              </p>
            </div>
          ) : undefined
        }
      >
        {/* Tab content */}
        {visibleTab === "info" ? (
          <InfoTabContent
            report={report}
            street={street}
            setProofPreview={(v) => setProofPreview(v)}
          />
        ) : visibleTab === "chat" ? (
          <div className="-mx-1 flex min-h-0 flex-1 flex-col">
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
              emptyMessage="Ask for updates, questions, extra photos, or access details here."
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
          <div className="space-y-4">
            <section className="rounded-[20px] border border-neutral-200 bg-white p-4">
              <div className="flex items-center gap-2.5">
                <ClockIcon
                  className="size-4 text-neutral-600"
                  aria-hidden="true"
                />
                <h3 className="text-[15px] font-semibold text-neutral-900">
                  Updates
                </h3>
              </div>
              <p className="mt-1 text-[12px] leading-5 text-neutral-500">
                Every status change and update on this report.
              </p>
              {assignedUnitName ? (
                <p className="mt-1 text-[12px] leading-5 text-neutral-500">
                  Assigned to {assignedUnitName}.
                </p>
              ) : null}
              <ConcernTimeline
                key={report.id}
                items={timeline}
                collapsibleHistory
              />
            </section>

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
  const residentDescription = alert.note?.trim() || description
  const residentSummary = residentSummaryLine(
    alert.display_description?.trim() || description
  )
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
  const canCallReporter = Boolean(alert.reporter_phone?.trim()) &&
    viewerId !== alert.reporter?.id

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
        backdropScrim={false}
        backdropInteractive
        backdrop={<IncidentMap alert={alert} viewerId={viewerId} />}
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
                <div className="flex items-center gap-2">
                  <p className="text-[12px] text-neutral-500">Resident</p>
                  {canCallReporter ? (
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = `tel:${alert.reporter_phone}`
                      }}
                      aria-label={`Call ${reporterName}`}
                      title={`Call ${reporterName}`}
                      className="inline-flex size-7 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:outline-none"
                    >
                      <PhoneIcon className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div
              className={cn(
                "flex items-start gap-2 rounded-2xl px-3.5 py-3 text-[15px] leading-relaxed",
                settled
                  ? "bg-neutral-100 text-neutral-700"
                  : "bg-blue-50 text-blue-900"
              )}
            >
              <InfoIcon
                className={cn(
                  "mt-[2px] size-5 shrink-0",
                  settled ? "text-neutral-600" : "text-blue-900"
                )}
                strokeWidth={2.2}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words whitespace-pre-wrap">
                  {alert.current_assignment?.responder
                    ? "A responder has been assigned to your location."
                    : residentSummary}
                </p>
                {residentDescription ? (
                  <p
                    className={cn(
                      "mt-2 border-t pt-2 text-[13px] leading-relaxed",
                      settled
                        ? "border-neutral-200 text-neutral-700"
                        : "border-blue-200 text-blue-900"
                    )}
                  >
                    {residentDescription}
                  </p>
                ) : null}
                {alert.media?.length ? (
                  <div
                    className={cn(
                      "mt-3 border-t pt-3",
                      settled ? "border-neutral-200" : "border-blue-200"
                    )}
                  >
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
                          className="overflow-hidden rounded-xl border border-blue-100 bg-white transition-colors hover:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                        >
                          <AuthenticatedMediaImage
                            src={media.preview_url}
                            alt={media.original_filename}
                            className="h-24 w-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {location ? (
              <div className="flex items-center gap-2 text-[13px] text-neutral-500">
                <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
                {location}
              </div>
            ) : null}

            {settled && historicalResponders.length ? (
              <div className="space-y-1.5 rounded-[14px] bg-status-closed-surface px-3 py-2.5 text-[12px] leading-relaxed text-status-closed-ink ring-1 ring-neutral-200">
                <p className="font-semibold">Responded</p>
                {historicalResponders.map((assignment) => (
                  <p key={`mobile-past-response-${assignment.id}`}>
                    {assignment.responder.full_name || "Responder"} responded.
                    Route taken: {historicalRouteSummary(assignment.route)}.
                  </p>
                ))}
              </div>
            ) : alert.current_assignment?.responder ? null : (
              <p className="rounded-[14px] bg-status-closed-surface px-3 py-2 text-[12px] leading-relaxed text-status-closed-ink ring-1 ring-neutral-200">
                Automatically routing to the nearest available responder.
              </p>
            )}

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
