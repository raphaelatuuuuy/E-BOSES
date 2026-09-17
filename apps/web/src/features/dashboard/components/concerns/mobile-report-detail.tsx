import { useState, type ReactNode } from "react"
import {
  CircleCheck,
  InfoIcon,
  ClockIcon,
  MapPinIcon,
  MessageSquareIcon,
  PhoneIcon,
  PlayIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import {
  ReportDescriptionCard,
  ReportAssignmentFooter,
  ReportReporterCard,
} from "@/features/dashboard/components/concerns/report-detail-content"

import type { Concern, PublicUser } from "@/features/dashboard/api"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { useAuthSession } from "@/features/auth/auth-session"
import { useReporterPhone } from "@/features/dashboard/lib/use-reporter-phone"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import { ReportLocationMap } from "@/features/dashboard/components/report-location-map"
import { ConcernTimeline } from "@/features/dashboard/components/concerns/concern-timeline"
import { buildConcernTimelineEntries } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import type { ConcernTimelineEntry } from "@/features/dashboard/components/concerns/concern-timeline-lib"
import { ReportPhotoPreview } from "@/features/dashboard/components/concerns/resolved-photo"
import {
  avatarTone,
  ConcernCommentsList,
  concernReporterName,
  ConcernEngagementFooter,
  initialsOf,
  useConcernComments,
} from "@/features/dashboard/components/concerns/concern-queue-item"
import { unitShortTag } from "@/features/dashboard/components/concerns/concern-display"
import { streetOnly, streetSegment } from "@/features/dashboard/lib/location-text"
import { formatResolvedOn } from "@/features/dashboard/lib/responder-format"
import { MediaLightbox } from "@/features/dashboard/components/authenticated-media"
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
import { isEmergencyActive } from "@/features/dashboard/lib/status-vocabulary"
import { emergencyDescription } from "@/features/dashboard/lib/emergency-description"

type MobileTab = "info" | "chat" | "updates"

function residentSummaryLine(value: string) {
  const clean = value.trim()
  if (!clean) return "The resident submitted this emergency."
  if (/^(the resident|the report|this report|a report)\b/i.test(clean)) {
    const sentence = `${clean.charAt(0).toUpperCase()}${clean.slice(1)}`
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
  }
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
          simpleCounter
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
            <div className="space-y-1.5">
              {audience === "official" ? (
                <ReportReporterCard
                  report={report}
                  onChat={!isGuestReport ? () => setTab("chat") : undefined}
                />
              ) : (
                <ReportAssignmentFooter
                  report={report}
                  onChat={!isGuestReport ? () => setTab("chat") : undefined}
                />
              )}
              <p className="text-center text-[11px] leading-4 text-neutral-400">
                {audience === "official"
                  ? report.is_anonymous === true || report.reporter?.id === 0
                    ? "This report was sent anonymously."
                    : "Contact the resident in case of follow-ups."
                  : "Status updates and messages from the barangay will appear here."}
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

const OWN_HANDLING_STATUSES = new Set([
  "assigned",
  "acknowledged",
  "en_route",
  "nearby",
  "arrived",
  "assisting",
])

const OWN_HANDLING_HEADLINES: Record<string, string> = {
  assigned: "You are assigned to this emergency.",
  acknowledged: "You are preparing to respond.",
  en_route: "You are on the way to the resident.",
  nearby: "You are near the location.",
  arrived: "You are on scene.",
  assisting: "You are assisting at the location.",
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
  const [mapFull, setMapFull] = useState(false)
  const [proofPreview, setProofPreview] = useState<{
    items: MediaPreviewItem[]
    index: number
  } | null>(null)
  const [resolutionOpen, setResolutionOpen] = useState(false)
  const timeline = buildEmergencyTimeline(alert)
  const statusIntakeIds = new Set(
    (alert.status_events ?? [])
      .filter((event) => event.event_key.startsWith("received_"))
      .map((event) => String(event.id))
  )
  const statusItems: ConcernTimelineEntry[] = timeline
    .filter(
      (item) =>
        !statusIntakeIds.has(item.id) && item.badge !== "Emergency received"
    )
    .map((item) => ({
      id: item.id,
      badge: item.badge,
      time: item.time,
      content: item.content ?? null,
      state: item.state as ConcernTimelineEntry["state"],
      accent: item.accent as ConcernTimelineEntry["accent"],
      icon: item.icon as ConcernTimelineEntry["icon"],
      actor: item.actor,
      actorUser: item.actorUser,
    }))
  const reporterName =
    alert.reporter_display?.trim() ||
    alert.reporter?.full_name?.trim() ||
    "Resident"
  const reporterInitial = (alert.reporter?.initials || reporterName)
    .charAt(0)
    .toUpperCase()
  const location = streetSegment(
    alert.display_location ||
      alert.resolved_location ||
      alert.reported_area ||
      alert.address ||
      alert.barangay
  )
  const description = emergencyDescription(alert)
  const residentSummary = residentSummaryLine(
    alert.display_description?.trim() || description
  )
  const settled = !isEmergencyActive(alert.status)
  const resolved = alert.status === "resolved"
  const ownAssignment =
    (alert.assignments ?? []).find(
      (assignment) =>
        assignment.responder?.id === viewerId &&
        OWN_HANDLING_STATUSES.has(assignment.status)
    ) ??
    (alert.current_assignment?.responder?.id === viewerId
      ? alert.current_assignment
      : null)
  const sheetTitle = resolved
    ? "Responder has resolved the issue"
    : settled
      ? "Emergency alert"
    : ownAssignment
      ? (OWN_HANDLING_HEADLINES[ownAssignment.status] ??
        "You are responding to this emergency.")
      : alert.current_assignment?.responder
        ? "Responder is handling it."
        : "Live alert"
  const { phone: reporterContactPhone, busy: reporterCallBusy, call: callReporterContact } =
    useReporterPhone(alert, { autoReveal: true })
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

  return (
    <>
      {proofPreview ? (
        <MediaLightbox
          items={proofPreview.items}
          index={proofPreview.index}
          simpleCounter
          onClose={() => setProofPreview(null)}
        />
      ) : null}

      <SheetDialog
        open
        onClose={onBack}
        size="wide"
        showClose={false}
        className={cn(
          "h-auto max-h-[min(760px,72dvh)] sm:max-h-[min(760px,82vh)]",
          mapFull && "hidden"
        )}
        bodyClassName={
          tab === "chat"
            ? "flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5"
            : "flex min-h-0 flex-col overflow-y-auto px-5"
        }
        title={tab === "chat" ? "Chat" : sheetTitle}
        titleClassName={
          tab === "chat"
            ? undefined
            : "text-center text-[18px] font-medium leading-snug"
        }
        headerTop={
          tab === "chat" ? undefined : location || alert.barangay ? (
            <span className="inline-flex max-w-full items-center gap-1.5">
              <MapPinIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {location || alert.barangay}
              </span>
            </span>
          ) : undefined
        }
        onBack={tab === "chat" ? () => setTab("info") : undefined}
        backdropScrim={false}
        backdropInteractive
        backdrop={<IncidentMap alert={alert} viewerId={viewerId} onBack={onBack} onFullscreenChange={setMapFull} />}
        footer={
          tab === "info" ? (
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
          ) : audience === "official" ||
            responderActions.hasOwnAssignment ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] leading-none font-bold",
                    avatarTone
                  )}
                >
                  {reporterInitial}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-neutral-900">
                    {reporterName}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-neutral-600">
                    {reporterContactPhone ||
                      alert.reporter_phone?.trim() ||
                      "Phone unavailable"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void callReporterContact()}
                  disabled={reporterCallBusy}
                  aria-label={`Call ${reporterName}`}
                  title={`Call ${reporterName}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1 text-[13px] font-normal text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
                >
                  <PhoneIcon className="size-4" aria-hidden="true" />
                  <span>{reporterCallBusy ? "Calling…" : "Call"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab("chat")}
                  aria-label="Chat with resident"
                  title="Chat with resident"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1 text-[13px] font-normal text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <MessageSquareIcon className="size-4" aria-hidden="true" />
                  <span>Chat</span>
                </button>
              </div>
              <p className="text-center text-[11px] text-neutral-400">
                In case of follow-ups, contact the resident.
              </p>
              {!resolved ? (
              <button
                type="button"
                onClick={() => setResolutionOpen(true)}
                className="flex h-12 w-full items-center justify-center rounded-full bg-brand-orange px-5 text-[15px] font-semibold text-white transition-colors hover:bg-brand-orange-strong focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Resolve incident
              </button>
              ) : null}
            </div>
          ) : undefined
        ) : undefined
        }
      >
        {tab === "info" ? (
          <div className="space-y-5">
            <div
              className={cn(
                "flex items-start gap-2 rounded-2xl px-3.5 py-3 text-[15px] leading-relaxed",
                !settled
                  ? "bg-severity-critical-surface text-sos"
                  : resolved
                    ? "bg-emerald-50 text-emerald-900"
                    : "bg-neutral-100 text-neutral-700"
              )}
            >
              {!settled ? (
                <TriangleAlertIcon
                  className="mt-[2px] size-5 shrink-0 text-sos"
                  strokeWidth={1.9}
                  aria-hidden
                />
              ) : resolved ? (
                <CircleCheck
                  className="mt-[2px] size-5 shrink-0 text-emerald-600"
                  strokeWidth={2.2}
                  aria-hidden
                />
              ) : (
                <TriangleAlertIcon
                  className="mt-[2px] size-5 shrink-0 text-neutral-600"
                  strokeWidth={1.9}
                  aria-hidden
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words whitespace-pre-wrap">
                  {residentSummary}
                </p>
                {resolved && alert.resolved_at ? (
                  <p className="mt-2 text-[12px] font-normal">
                    This issue was resolved on{" "}
                    {formatResolvedOn(alert.resolved_at)}.
                  </p>
                ) : null}
                {alert.media?.length ||
                (alert.resolution_evidence ?? []).length ? (
                  <div className="mt-3 space-y-3 pt-1">
                    {alert.media?.length ? (
                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold opacity-70">
                          Submitted photos
                        </p>
                        {(() => {
                          const items = alert.media ?? []
                          const imageIndex = items.findIndex((item) =>
                            item.mime_type?.startsWith("image/")
                          )
                          const displayIndex =
                            imageIndex >= 0 ? imageIndex : 0
                          const display = items[displayIndex]
                          if (!display) return null
                          const previewItems = [
                            ...items.map((item) => ({
                              ...toMediaPreviewItem(
                                item.preview_url,
                                item.original_filename,
                                item.mime_type
                              ),
                              badge: "Reported issue",
                            })),
                            ...(alert.resolution_evidence ?? []).map((item) => ({
                              ...toMediaPreviewItem(
                                item.raw_url || item.preview_url,
                                item.original_filename,
                                item.mime_type
                              ),
                              badge: "Resolved case",
                            })),
                          ]
                          if (!display.mime_type?.startsWith("image/")) {
                            return (
                              <button
                                type="button"
                                onClick={() =>
                                  setProofPreview({
                                    items: previewItems,
                                    index: displayIndex,
                                  })
                                }
                                className="flex h-24 w-full items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white text-[12px] font-semibold text-neutral-700"
                              >
                                <PlayIcon className="size-4" />
                                Video evidence
                              </button>
                            )
                          }
                          return (
                            <ReportPhotoPreview
                              originalSrc={display.preview_url}
                              alt={display.original_filename}
                              onOpen={() =>
                                setProofPreview({
                                  items: previewItems,
                                  index: displayIndex,
                                })
                              }
                            />
                          )
                        })()}
                      </div>
                    ) : null}
                    {(alert.resolution_evidence ?? []).length ? (
                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold opacity-70">
                          Resolved photos
                        </p>
                        {(() => {
                          const submitted = alert.media ?? []
                          const items = alert.resolution_evidence ?? []
                          const imageIndex = items.findIndex((item) =>
                            item.mime_type?.startsWith("image/")
                          )
                          const displayIndex =
                            imageIndex >= 0 ? imageIndex : 0
                          const display = items[displayIndex]
                          if (!display) return null
                          const previewItems = [
                            ...submitted.map((item) => ({
                              ...toMediaPreviewItem(
                                item.preview_url,
                                item.original_filename,
                                item.mime_type
                              ),
                              badge: "Reported issue",
                            })),
                            ...items.map((item) => ({
                              ...toMediaPreviewItem(
                                item.raw_url || item.preview_url,
                                item.original_filename,
                                item.mime_type
                              ),
                              badge: "Resolved case",
                            })),
                          ]
                          const openIndex = submitted.length + displayIndex
                          if (!display.mime_type?.startsWith("image/")) {
                            return (
                              <button
                                type="button"
                                onClick={() =>
                                  setProofPreview({
                                    items: previewItems,
                                    index: openIndex,
                                  })
                                }
                                className="flex h-24 w-full items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white text-[12px] font-semibold text-neutral-700"
                              >
                                <PlayIcon className="size-4" />
                                Video evidence
                              </button>
                            )
                          }
                          return (
                            <ReportPhotoPreview
                              resolutionSrc={
                                display.preview_url || display.raw_url
                              }
                              alt={display.original_filename}
                              onOpen={() =>
                                setProofPreview({
                                  items: previewItems,
                                  index: openIndex,
                                })
                              }
                            />
                          )
                        })()}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <section>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-[17px] font-bold tracking-tight text-neutral-900">
                  Status
                </p>
                <p className="text-[12px] font-normal text-neutral-500">
                  Track the process
                </p>
              </div>
              <ConcernTimeline
                key={`mobile-emergency-info-timeline-${alert.id}`}
                items={statusItems}
                collapsibleHistory
                large
                trackingId={alert.tracking_id || alert.public_id}
              />
            </section>

            {settled || alert.current_assignment?.responder ? null : (
              <p className="rounded-[14px] bg-status-closed-surface px-3 py-2 text-[12px] leading-relaxed text-status-closed-ink ring-1 ring-neutral-200">
                Automatically routing to the nearest available responder.
              </p>
            )}

          </div>
        ) : tab === "chat" ? (
          responderOwnsChat ? (
            <div className="flex min-h-[40dvh] flex-1 flex-col">
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
