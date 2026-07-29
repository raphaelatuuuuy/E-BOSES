import { ChevronDownIcon, MapPinIcon, XIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { Concern } from "@/features/dashboard/api"
import type { EmergencyAlert, EmergencyAssignment } from "@/features/dashboard/emergency-api"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import { ConcernConversation } from "@/features/dashboard/components/concern-conversation"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { IncidentActions } from "@/features/dashboard/components/responder/incident-actions"
import {
  dispatchState,
  dotClass,
  formatAgo,
  isSettled,
  toneClass,
  type StateTone,
} from "@/features/dashboard/lib/responder-format"

/**
 * The responder incident panel — selected dispatch, the acknowledge/en-route/
 * arrived/resolved stepper, dispatch chat, assigned concern cases, nearby
 * community alerts, and the dispatch queue. Renders identically inside the
 * desktop rail and the mobile sheet; the caller owns the outer chrome.
 *
 * Lists here are hairline-separated rows inside one bounded region rather than
 * a stack of individually bordered cards, and state is a coloured word in each
 * row's meta line rather than a pill. Both changes are the same idea: the eye
 * should land on the incident, not on the chrome around it.
 */

/** Section heading with an optional count, printed as a figure not a chip. */
function SectionHead({
  label,
  hint,
  count,
}: {
  label: string
  hint?: string
  count?: number
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-4">
      <div className="min-w-0">
        <h2 className="text-micro uppercase tracking-wide text-nav-muted">{label}</h2>
        {hint ? (
          <p className="mt-1 text-xs leading-5 text-subtle-foreground">{hint}</p>
        ) : null}
      </div>
      {count != null ? (
        <span className="shrink-0 text-sm font-bold tabular-nums text-nav-text-active">
          {count}
        </span>
      ) : null}
    </div>
  )
}

/** The one status treatment in the console: a dot, then a word. */
function State({ label, tone }: { label: string; tone: StateTone }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 shrink-0 rounded-full", dotClass(tone))} aria-hidden />
      <span className={cn("uppercase tracking-wide", toneClass(tone))}>{label}</span>
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pb-4 text-xs leading-5 text-subtle-foreground">{children}</p>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-card-line bg-card">
      {children}
    </section>
  )
}

/** Hairline-separated list body. */
function Rows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-card-line border-t border-card-line">{children}</div>
}

export function IncidentPanel({
  alerts,
  selected,
  selectedDistance,
  selectedActiveTeam,
  viewerId,
  awaitingAckCount,
  onClose,
  onChanged,
  onRefresh,
  onSelectDispatch,
  assignedConcerns,
  assignedChatId,
  onToggleAssignedChat,
  onConcernMessageSent,
  visibleConcerns,
  selectedConcernId,
  concernBusy,
  replyOpenId,
  replyDraft,
  onReplyDraftChange,
  onToggleReply,
  onLikeConcern,
  onReplyToConcern,
  concernCardRef,
}: {
  alerts: EmergencyAlert[]
  selected: EmergencyAlert | null
  selectedDistance: number | null
  selectedActiveTeam: EmergencyAssignment[]
  viewerId: number | null
  awaitingAckCount: number
  /** Dismiss control for the mobile sheet. Null in the docked desktop rail. */
  onClose: (() => void) | null
  onChanged: (next: EmergencyAlert) => void
  onRefresh: () => Promise<void>
  onSelectDispatch: (id: number) => void
  assignedConcerns: Concern[]
  assignedChatId: number | null
  onToggleAssignedChat: (id: number) => void
  onConcernMessageSent: () => Promise<void>
  visibleConcerns: Concern[]
  selectedConcernId: number | null
  concernBusy: number | null
  replyOpenId: number | null
  replyDraft: string
  onReplyDraftChange: (value: string) => void
  onToggleReply: (id: number) => void
  onLikeConcern: (concern: Concern) => void
  onReplyToConcern: (concern: Concern) => void
  concernCardRef: (id: number, node: HTMLElement | null) => void
}) {
  const selectedState = selected ? dispatchState(selected, viewerId) : null

  return (
    <div className="space-y-3">
      {onClose ? (
        <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-0 flex items-center justify-between gap-3 rounded-t-3xl bg-rail-glass/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-nav-text-active">
              {selected ? `${selected.type} dispatch` : "Dispatch"}
            </p>
            <p className="mt-0.5 text-micro uppercase tracking-wide text-nav-muted">
              {awaitingAckCount > 0
                ? `${awaitingAckCount} awaiting you`
                : `${alerts.length} assigned`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dispatch panel"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-nav-muted hover:bg-nav-raised hover:text-nav-text-active"
          >
            <ChevronDownIcon className="size-5" />
          </button>
        </div>
      ) : null}

      <Panel>
        <SectionHead
          label="Selected dispatch"
          count={alerts.length}
        />

        {!selected || !selectedState ? (
          <Empty>
            Nothing is assigned to you right now. New dispatches arrive here and open
            this panel on their own.
          </Empty>
        ) : (
          <>
            <div className="border-t border-card-line px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 text-lg font-bold capitalize leading-tight text-foreground">
                  {selected.type}
                </h3>
                {selectedDistance != null ? (
                  <span className="shrink-0 text-sm font-bold tabular-nums text-nav-text-active">
                    {selectedDistance.toFixed(1)} km
                  </span>
                ) : null}
              </div>

              <p className="mt-1 flex items-start gap-1.5 text-sm leading-6 text-muted-foreground">
                <MapPinIcon className="mt-1 size-3.5 shrink-0 text-nav-muted" />
                <span className="min-w-0">{selected.address || selected.barangay}</span>
              </p>

              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
                <State label={selectedState.label} tone={selectedState.tone} />
                <span className="text-subtle-foreground">{formatAgo(selected.created_at)}</span>
                {selectedDistance == null ? (
                  <span className="text-subtle-foreground">Distance pending GPS</span>
                ) : null}
              </p>

              {selected.note ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {selected.note}
                </p>
              ) : null}
            </div>

            <div className="border-t border-card-line p-4">
              <IncidentActions
                alert={selected}
                viewerId={viewerId}
                onChanged={onChanged}
                onRefresh={onRefresh}
              />

              <EmergencyChatPanel
                alertId={selected.id}
                open
                theme="dark"
                disabled={["resolved", "cancelled"].includes(selected.status)}
                participantHint={
                  selectedActiveTeam.length > 0
                    ? `Resident and ${selectedActiveTeam.length} responder${selectedActiveTeam.length === 1 ? "" : "s"}`
                    : "Group chat opens once an active responder is assigned"
                }
                className="mt-3 min-h-[320px]"
              />
            </div>
          </>
        )}
      </Panel>

      <Panel>
        <SectionHead
          label="Assigned concerns"
          hint="Field reports assigned to you by barangay officials."
          count={assignedConcerns.length}
        />
        {assignedConcerns.length === 0 ? (
          <Empty>No concern is assigned to you.</Empty>
        ) : (
          <Rows>
            {assignedConcerns.map((concern) => (
              <article key={concern.id} className="px-4 py-3">
                <p className="text-sm font-bold leading-tight text-foreground">{concern.title}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {concern.description}
                </p>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
                  <State
                    label={concern.status.replace(/_/g, " ")}
                    tone={isSettled(concern.status) ? "settled" : "live"}
                  />
                  <span className="text-subtle-foreground">
                    {concern.address || concern.barangay}
                  </span>
                  <span className="text-subtle-foreground tabular-nums">
                    {concern.tracking_id}
                  </span>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => onToggleAssignedChat(concern.id)}
                >
                  {assignedChatId === concern.id ? "Close report chat" : "Open report chat"}
                </Button>
                {assignedChatId === concern.id ? (
                  <div className="mt-3 space-y-3">
                    <ConcernConversation items={concern.conversation ?? []} />
                    <ReportChatPanel
                      concernId={concern.id}
                      open
                      disabled={false}
                      showHistory={false}
                      title="Message this case"
                      subtitle="Your message is added to the shared case conversation."
                      onMessageSent={onConcernMessageSent}
                    />
                  </div>
                ) : null}
              </article>
            ))}
          </Rows>
        )}
      </Panel>

      <Panel>
        <SectionHead
          label="Nearby community alerts"
          hint="Support or reply without leaving the map."
          count={visibleConcerns.length}
        />
        {visibleConcerns.length === 0 ? (
          <Empty>No community alerts nearby.</Empty>
        ) : (
          <Rows>
            {visibleConcerns.map((concern) => (
              <article
                key={concern.id}
                ref={(node) => concernCardRef(concern.id, node)}
                className={cn(
                  "px-4 py-3 transition-colors",
                  selectedConcernId === concern.id ? "bg-card-raised" : "hover:bg-card-raised",
                )}
              >
                <p className="text-sm font-bold leading-tight text-foreground">{concern.title}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {concern.description}
                </p>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-subtle-foreground">
                  <span>{concern.address || concern.barangay}</span>
                  <span className="tabular-nums">{concern.vote_count} support</span>
                  <span className="tabular-nums">{concern.comment_count} replies</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={concernBusy === concern.id}
                    onClick={() => onLikeConcern(concern)}
                  >
                    {concern.user_vote === 1 ? "Supported" : "Support"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onToggleReply(concern.id)}
                  >
                    Reply
                  </Button>
                </div>
                {replyOpenId === concern.id ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={replyDraft}
                      onChange={(event) => onReplyDraftChange(event.target.value)}
                      placeholder="Write a useful response"
                      rows={2}
                      className="w-full resize-none rounded-xl border border-card-line bg-card-raised px-3 py-2 text-sm text-foreground outline-none focus:border-brand-orange"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={concernBusy === concern.id || !replyDraft.trim()}
                      onClick={() => onReplyToConcern(concern)}
                    >
                      Post response
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </Rows>
        )}
      </Panel>

      <Panel>
        <SectionHead label="Dispatch queue" count={alerts.length} />
        {alerts.length === 0 ? (
          <Empty>No assigned incidents.</Empty>
        ) : (
          <Rows>
            {alerts.map((alert) => {
              const state = dispatchState(alert, viewerId)
              const active = selected?.id === alert.id
              return (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => onSelectDispatch(alert.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "w-full px-4 py-3 text-left transition-colors",
                    active ? "bg-card-raised" : "hover:bg-card-raised",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-bold capitalize text-foreground">
                      {alert.type}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
                      {formatAgo(alert.created_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {alert.address || alert.barangay}
                  </p>
                  <p className="mt-1.5 text-xs font-semibold">
                    <State label={state.label} tone={state.tone} />
                  </p>
                </button>
              )
            })}
          </Rows>
        )}
      </Panel>

      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-card-line bg-card px-4 py-3 text-sm font-semibold text-nav-muted hover:text-nav-text-active"
        >
          <XIcon className="size-4" />
          Close panel
        </button>
      ) : null}
    </div>
  )
}
