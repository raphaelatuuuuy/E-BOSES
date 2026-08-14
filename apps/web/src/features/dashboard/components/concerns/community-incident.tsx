import { useState } from "react"
import { EyeOffIcon, GlobeIcon, LockIcon } from "lucide-react"


import type { CommunityIncident, CommunityIncidentPhoto, Concern } from "@/features/dashboard/api"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import { concernCategoryLabel } from "@/features/dashboard/components/concerns/concern-display"
import { toStatusView } from "@/features/dashboard/components/record/status"
import { StateMarker } from "@/components/ui/state-marker"
import {
  PRIORITY_BAND_LABEL,
  priorityBand,
  priorityExplanation,
} from "@/features/dashboard/components/record/severity"
import { concernSeverityOf } from "@/features/dashboard/components/record/concern-adapter"
import { derivePriority } from "@/features/dashboard/components/record/severity"
import { Band, Fact, Surface } from "@/features/dashboard/components/workspace/band"

const INITIAL_REPORTS = 3
const INITIAL_PHOTOS = 6

function formatMoment(value: string | null | undefined) {
  if (!value) return "—"
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function VisibilityFact({ incident }: { incident: CommunityIncident }) {
  const isPublic = incident.visibility === "community"
  const pending = isPublic && Boolean(incident.publication_block_reason)
  const Icon = isPublic ? GlobeIcon : LockIcon
  return (
    <Fact
      label="Visibility"
      value={
        <span className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5 text-subtle-foreground" />
          {pending ? "Pending publication" : isPublic ? "Public" : "Private"}
        </span>
      }
      hint={pending ? incident.publication_block_reason.replace(/_/g, " ") : undefined}
    />
  )
}

function PhotoTile({ photo, onOpen }: { photo: CommunityIncidentPhoto; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative overflow-hidden rounded-control border border-card-line bg-canvas"
      title={`${photo.reporter_name} · ${photo.report_tracking_id}`}
    >
      {photo.mime_type.startsWith("image/") ? (
        <AuthenticatedMediaImage
          src={photo.preview_url}
          alt={photo.original_filename}
          className="h-36 w-full object-cover"
        />
      ) : (
        <span className="flex h-36 items-center justify-center text-label text-muted-foreground">File</span>
      )}
      {photo.relevance_state === "unrelated" ? (
        <span className="absolute bottom-1.5 left-1.5 rounded-pill bg-severity-critical-surface px-1.5 py-0.5 text-[10px] font-semibold text-severity-critical-ink">
          Unrelated
        </span>
      ) : null}
    </button>
  )
}

export function CommunityIncidentDetails({
  report,
  locationSlot,
  updatesSlot,
  onOpenPhoto,
  onOpenProof,
  onViewAllPhotos,
}: {
  report: Concern
  locationSlot: React.ReactNode
  updatesSlot: React.ReactNode
  onOpenPhoto: (photos: CommunityIncidentPhoto[], index: number) => void
  onOpenProof: (items: { src: string; filename: string; kind: "image" }[], index: number) => void
  onViewAllPhotos: () => void
}) {
  const incident = report.community_incident
  const [showAllReports, setShowAllReports] = useState(false)
  const [now] = useState(() => Date.now())
  if (!incident) return null

  const status = toStatusView(incident.status)
  const reports = showAllReports ? incident.reports : incident.reports.slice(0, INITIAL_REPORTS)
  const photos = incident.photos.slice(0, INITIAL_PHOTOS)
  const protectedCount = incident.photos.filter((photo) => photo.privacy_state === "protected").length
  const resolutionEvidence = report.resolution_evidence ?? []
  const { severity } = concernSeverityOf(report)
  const hoursWaiting = (now - new Date(report.updated_at).getTime()) / 3_600_000
  const priorityInput = {
    severity,
    urgentAttention: report.ai_assessment?.urgent_attention ?? false,
    hoursSinceStatusChange: hoursWaiting,
    linkedReports: incident.resident_count,
    voteCount: report.vote_count,
  }
  const band = priorityBand(
    derivePriority({ severity, hoursSinceStatusChange: hoursWaiting, voteCount: report.vote_count }),
  )

  return (
    <Surface>
      <Band>
        <div className="flex items-start gap-3">
          {}
          <span className="flex size-9 shrink-0 flex-col items-center justify-center rounded-control bg-brand-orange-soft leading-none">
            <span className="text-sm font-bold text-brand-orange">{incident.report_count}</span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-micro text-subtle-foreground">
              Community concern · {incident.report_count} {incident.report_count === 1 ? "report" : "reports"}
            </p>
            <h2 className="mt-0.5 text-heading text-foreground">{incident.title}</h2>
          </div>
        </div>

        {}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-4">
          <Fact
            label="Status"
            value={<StateMarker tone={status.group} label={status.label} />}
          />
          <Fact label="Category" value={concernCategoryLabel(report)} />
          <Fact
            label="Assigned unit"
            value={
              incident.assigned_unit
                ? incident.assigned_unit.short_name || incident.assigned_unit.name
                : "Routing review required"
            }
          />
          <Fact
            label="Reports linked"
            value={`${incident.resident_count} ${incident.resident_count === 1 ? "resident" : "residents"}`}
          />
          <Fact label="Priority" value={PRIORITY_BAND_LABEL[band]} />
          <VisibilityFact incident={incident} />
          <Fact label="First reported" value={formatMoment(incident.first_reported_at)} />
          <Fact label="Latest report" value={formatMoment(incident.latest_reported_at)} />
        </div>
      </Band>

      <Band label="Why this priority">
        <p className="text-body leading-6 text-muted-foreground">
          {priorityExplanation(band, priorityInput)}
        </p>
      </Band>

      <Band label="Summary">
        <p className="text-body leading-6 text-foreground">
          {incident.summary || report.description}
        </p>
      </Band>

      <Band
        label="Resident reports"
        action={<span className="text-micro text-subtle-foreground">{incident.report_count} total</span>}
      >
        <ul className="divide-y divide-card-line">
          {reports.map((entry) => (
            <li key={entry.id} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-semibold text-foreground">{entry.reporter_name}</p>
                <p className="text-micro text-subtle-foreground">{formatMoment(entry.submitted_at)}</p>
              </div>
              <p className="mt-1.5 text-body leading-6 text-muted-foreground">
                &ldquo;{entry.description}&rdquo;
              </p>
              {entry.photo_count > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const own = incident.photos.filter((photo) => photo.report_id === entry.id)
                    if (own.length) onOpenPhoto(own, 0)
                  }}
                  className="mt-2 text-label text-brand-orange transition-colors duration-[--duration-micro] hover:text-brand-orange-strong"
                >
                  Show {entry.photo_count} {entry.photo_count === 1 ? "photo" : "photos"}
                </button>
              ) : entry.withheld_photo_count ? (
                <p className="mt-2 text-label text-subtle-foreground">
                  {entry.withheld_photo_count === 1 ? "1 photo is" : `${entry.withheld_photo_count} photos are`}{" "}
                  being checked for privacy
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        {incident.reports.length > INITIAL_REPORTS ? (
          <button
            type="button"
            onClick={() => setShowAllReports((value) => !value)}
            className="mt-3 text-label text-brand-orange transition-colors duration-[--duration-micro] hover:text-brand-orange-strong"
          >
            {showAllReports ? "Show fewer reports" : `View all ${incident.reports.length} reports`}
          </button>
        ) : null}
      </Band>

      <Band
        label="Photos"
        action={
          <span className="text-micro text-subtle-foreground">
            {incident.photo_count} community {incident.photo_count === 1 ? "photo" : "photos"}
          </span>
        }
      >
        {photos.length ? (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {photos.map((photo, index) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  onOpen={() => onOpenPhoto(incident.photos, index)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={onViewAllPhotos}
              className="mt-3 text-label text-brand-orange transition-colors duration-[--duration-micro] hover:text-brand-orange-strong"
            >
              View all photos
            </button>
          </>
        ) : (
          <p className="text-body text-muted-foreground">No photos linked to this incident.</p>
        )}
      </Band>

      {resolutionEvidence.length ? (
        <Band
          label="Proof of resolution"
          action={
            <span className="text-micro text-subtle-foreground">
              {resolutionEvidence.length} {resolutionEvidence.length === 1 ? "photo" : "photos"}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            {resolutionEvidence.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  onOpenProof(
                    resolutionEvidence.map((entry) => ({
                      src: entry.preview_url || entry.raw_url,
                      filename: entry.original_filename,
                      kind: "image" as const,
                    })),
                    resolutionEvidence.indexOf(item),
                  )
                }
                className="overflow-hidden rounded-control border border-card-line bg-canvas text-left"
                title={item.note}
              >
                <AuthenticatedMediaImage
                  src={item.preview_url || item.raw_url}
                  alt={item.original_filename}
                  className="h-36 w-full object-cover"
                />
              </button>
            ))}
          </div>
          {resolutionEvidence[0]?.note ? (
            <p className="mt-2.5 text-body leading-6 text-muted-foreground">
              {resolutionEvidence[0].note}
            </p>
          ) : null}
        </Band>
      ) : null}

      {incident.observed.length ? (
        <Band label="Observed in community photos">
          <div className="flex flex-wrap gap-1.5">
            {incident.observed.map((item) => (
              <span
                key={item}
                className="rounded-pill bg-card-raised px-2.5 py-0.5 text-[12px] font-medium capitalize text-muted-foreground"
              >
                {item}
              </span>
            ))}
          </div>
        </Band>
      ) : null}

      {}
      {protectedCount ? (
        <Band label="Privacy protection">
          <div className="flex items-start gap-2">
            <EyeOffIcon className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
            <p className="text-body leading-6 text-foreground">
              {protectedCount} of {incident.photo_count} photos have a protected copy. Residents see
              the blurred version; you see the original.
            </p>
          </div>
        </Band>
      ) : null}

      <Band label="Location">{locationSlot}</Band>

      <Band label="Updates">
        <p className="mb-3 text-[12px] text-muted-foreground">
          Every status change and message the resident was shown.
        </p>
        {updatesSlot}
      </Band>
    </Surface>
  )
}
