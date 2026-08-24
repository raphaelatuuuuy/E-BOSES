import {
  ArrowUpIcon,
  Ban,
  CircleCheck,
  Info,
  Loader2Icon,
  TriangleAlert,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { SmsSimulationResult, SmsSimulationScenario } from "./api"
import { RoutePreviewMap } from "./route-preview-map"
import { emergencyTitle, locationSourceLabel, responderMessage, routeScopeLabel, routeStateLabel } from "./dispatch-copy"

const PRESETS = [
  { value: "HELP MEDICAL", label: "Fresh account location", sender: "registered", scenario: "fresh" },
  { value: "HELP FIRE", label: "Stale account location", sender: "registered", scenario: "stale" },
  { value: "HELP CRIME", label: "Home community only", sender: "registered", scenario: "context" },
  { value: "HELP FIRE in Barangay Concepcion Uno", label: "Another community", sender: "registered", scenario: "default" },
  { value: "HELP MEDICAL LOC:14.6507,121.1133", label: "Unknown with GPS", sender: "unknown", scenario: "default" },
  { value: "HELP FIRE near Champaca Street", label: "Unknown with street", sender: "unknown", scenario: "default" },
  { value: "HELP CRIME near Champaca Street", label: "Number needs review", sender: "needs_review", scenario: "default" },
  { value: "HELP FIRE near M. L. Quezon Street", label: "Street in two areas", sender: "unknown", scenario: "default" },
] as const

const BRANCH_TONE: Record<string, { icon: typeof CircleCheck; className: string }> = {
  emergency: { icon: TriangleAlert, className: "text-amber-500" },
  emergency_help: { icon: TriangleAlert, className: "text-amber-500" },
  duplicate: { icon: Info, className: "text-blue-500" },
  guide: { icon: CircleCheck, className: "text-green-600" },
  status: { icon: CircleCheck, className: "text-green-600" },
  safe: { icon: CircleCheck, className: "text-green-600" },
  cancel: { icon: CircleCheck, className: "text-green-600" },
  help_needs_category: { icon: TriangleAlert, className: "text-amber-500" },
  not_authorised: { icon: Ban, className: "text-red-500" },
  otp_dropped: { icon: Ban, className: "text-red-500" },
  unknown: { icon: TriangleAlert, className: "text-amber-500" },
  past_incident: { icon: CircleCheck, className: "text-green-600" },
}

function branchTitle(branch: string) {
  const titles: Record<string, string> = {
    emergency: "Emergency created and routed",
    emergency_help: "HELP shortcut, straight to dispatch",
    duplicate: "Treated as a follow-up to the open report",
    guide: "Command list sent",
    status: "Status update sent",
    safe: "Resident marked safe",
    cancel: "Cancellation requested",
    help_needs_category: "HELP arrived without a category",
    not_authorised: "Command refused for this sender",
    otp_dropped: "Dropped by the OTP firewall",
    unknown: "Unknown message, guided back",
    past_incident: "Past incident, no emergency dispatch",
  }
  return titles[branch] ?? branch.replace(/_/g, " ")
}

function formatEta(seconds: number | null) {
  if (seconds == null) return "Not available"
  const minutes = Math.round(seconds / 60)
  return minutes < 1 ? "< 1 min" : `${minutes} min`
}

function formatDistance(meters: number | null) {
  if (meters == null) return "Not available"
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

export function SenderPill({
  sender,
  setSender,
}: {
  sender: "registered" | "unknown" | "needs_review"
  setSender: (v: "registered" | "unknown" | "needs_review") => void
}) {
  return (
    <div className="mr-1 flex shrink-0 items-center gap-0.5 rounded-full bg-neutral-100 p-0.5">
      {([
        ["registered", "Registered"],
        ["unknown", "Unknown"],
        ["needs_review", "Needs review"],
      ] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setSender(key)}
          className={cn(
            "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors",
            sender === key ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-400 hover:text-neutral-700",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/* ─── Main workspace ─── */

export type SmsWorkspaceProps = {
  message: string
  setMessage: (v: string) => void
  sender: "registered" | "unknown" | "needs_review"
  setSender: (v: "registered" | "unknown" | "needs_review") => void
  setScenario: (v: SmsSimulationScenario) => void
  result: SmsSimulationResult | null
  busy: boolean
}

export function SmsTestWorkspace({
  message,
  setMessage,
  sender,
  setSender,
  setScenario,
  result,
}: SmsWorkspaceProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Try an example</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                setMessage(p.value)
                setSender(p.sender)
                setScenario(p.scenario)
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                message === p.value
                  ? "border-brand-navy bg-brand-navy text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-neutral-400">
          Tap an example or type your own below, then open the chat preview to see the reply.
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-neutral-100 pt-4">
        <SenderPill sender={sender} setSender={setSender} />
        {result?.reply ? (
          <span className="text-[12px] tabular-nums text-neutral-400">
            {result.reply.characters} chars · {result.reply.segments} seg{result.reply.segments === 1 ? "" : "s"}
            {!result.reply.gsm7 ? <span className="ml-1.5 font-semibold text-amber-600">non-GSM</span> : null}
          </span>
        ) : null}
      </div>

    </div>
  )
}

/* ─── Chat conversation (messages only; input is pinned by the parent sheet) ─── */

function BubblePlain({ side, children }: { side: "start" | "end"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "w-fit max-w-[85%] rounded-2xl border border-neutral-200 bg-white px-3.5 py-2 text-[13px] leading-5 whitespace-pre-wrap text-neutral-900",
        side === "start" ? "rounded-bl-md" : "rounded-br-md",
      )}
    >
      {children}
    </div>
  )
}

export function SmsChatPanel({
  message,
  result,
  busy,
}: {
  message: string
  result: SmsSimulationResult | null
  busy: boolean
}) {
  const empty = !message.trim() && !result

  return (
    <div className="flex min-h-full flex-col">
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <p className="text-[14px] font-semibold text-neutral-900">No conversation yet</p>
          <p className="mt-1 max-w-[280px] text-[12px] leading-relaxed text-neutral-400">
            Send a sample text to see exactly how the hotline or system would answer a resident.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {message.trim() ? (
            <div className="flex flex-col items-end gap-1">
              <BubblePlain side="end">{message.trim()}</BubblePlain>
              <p className="px-0.5 text-[10px] font-medium leading-4 text-neutral-400">You · now</p>
            </div>
          ) : null}

          {busy ? (
            <div className="flex flex-col items-start gap-1">
              <div className="flex w-fit items-center rounded-2xl rounded-bl-md border border-neutral-200 bg-white px-3.5 py-2.5">
                <span className="inline-flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="size-1.5 animate-pulse rounded-full bg-neutral-300"
                      style={{ animationDelay: `${i * 200}ms` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          ) : result?.reply?.text ? (
            <div className="flex flex-col items-start gap-1">
              <BubblePlain side="start">{result.reply.text}</BubblePlain>
              <p className="px-2 text-[10px] font-medium leading-4 text-neutral-400">Hotline · now</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function SmsChatInput({
  message,
  setMessage,
  busy,
  onSend,
}: {
  message: string
  setMessage: (v: string) => void
  busy: boolean
  onSend: () => void
}) {
  const hasText = message.trim().length > 0

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-neutral-300">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 480))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder="Type a message…"
          className="h-10 min-w-0 flex-1 bg-transparent text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400"
        />
        <button
          type="button"
          disabled={!hasText || busy}
          onClick={onSend}
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full transition-all duration-150",
            hasText && !busy ? "bg-neutral-900 text-white hover:bg-neutral-800" : "bg-neutral-100 text-neutral-300",
          )}
          aria-label="Send message"
        >
          {busy ? <Loader2Icon className="size-4 animate-spin" /> : <ArrowUpIcon className="size-4" strokeWidth={2.4} />}
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-neutral-400">Simulation only. No message is sent or filed.</p>
    </div>
  )
}

/* ─── Command guide (? dialog) ─── */

function GuideRow({ code, children }: { code: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-neutral-100 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <p className="font-mono text-[12px] font-semibold text-neutral-900">{code}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-500">{children}</p>
    </div>
  )
}

export function SmsCommandGuide() {
  return (
    <div className="space-y-6">
      <section>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Report an emergency</p>
        <GuideRow code="HELP &lt;TYPE&gt; [place]">{"Skips every other check and opens an alert straight away. Types: fire, medical, crime, disaster."}</GuideRow>
        <GuideRow code="LOC:14.6507,121.1133">Add this line with GPS coordinates to attach a pin when the phone has no data connection.</GuideRow>
        <GuideRow code="Any clear description">A text like “sunog sa kanto” needs no keyword. The parser reads category words and urgency phrases.</GuideRow>
      </section>

      <section>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Resident commands</p>
        <GuideRow code="STATUS">Reads back the current state of your open report.</GuideRow>
        <GuideRow code="SAFE">Marks you safe on your open report; it stays visible until a responder confirms on scene.</GuideRow>
        <GuideRow code="CANCEL [reason]">Requests cancellation of your open report; an official confirms before it closes.</GuideRow>
        <GuideRow code="GUIDE">Sends the full command list to the handset.</GuideRow>
      </section>

      <section>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Who is texting</p>
        <GuideRow code="Registered">A number matched to an account gets greeted by name and richer replies.</GuideRow>
        <GuideRow code="Unknown">An unrecognised number still gets help. The reply asks them to register so follow-ups reach them.</GuideRow>
        <GuideRow code="One active report per sender">While a report is open, further texts become follow-ups instead of new alerts.</GuideRow>
        <GuideRow code="Verification codes">Code-shaped texts are redacted and dropped before anything else reads them.</GuideRow>
      </section>
    </div>
  )
}

/* ─── Results breakdown ─── */

export function SmsBreakdown({ result }: { result: SmsSimulationResult }) {
  const tone = BRANCH_TONE[result.branch] ?? { icon: Info, className: "text-neutral-400" }
  const ToneIcon = tone.icon
  const parsed = result.parsed

  return (
    <div className="space-y-3 border-t border-neutral-100 pt-4">
      <div className="flex items-start gap-2.5">
        <ToneIcon className={cn("mt-0.5 size-4 shrink-0", tone.className)} strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold leading-snug text-neutral-900">{branchTitle(result.branch)}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-500">{result.branch_reason}</p>
        </div>
      </div>

      <div className="rounded-xl bg-neutral-50 px-3.5 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Sender</p>
        <p className="mt-0.5 text-[13px] font-medium text-neutral-900">{result.sender.label}</p>
        <p className="text-[12px] text-neutral-500">
          {result.sender.masked_number}
          {result.sender.resident_name ? ` · ${result.sender.resident_name}` : ""}
        </p>
      </div>

      {parsed ? (
        <div className="rounded-xl bg-neutral-50 px-3.5 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Parsed</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <ParsedChip label={parsed.category_label || "No category"} strong={Boolean(parsed.category_label)} />
            {parsed.matched_alias && parsed.matched_alias !== parsed.category_label ? (
              <ParsedChip label={`alias: ${parsed.matched_alias}`} />
            ) : null}
            {parsed.needs_confirmation ? <ParsedChip label="Guessed" warn /> : null}
            {parsed.urgency_signal ? <ParsedChip label="Urgency" /> : null}
            <ParsedChip label={parsed.incident_timing === "ongoing" ? "Happening now" : `Timing: ${parsed.incident_timing.replaceAll("_", " ")}`} warn={parsed.incident_timing === "unclear"} />
            <ParsedChip
              label={
                parsed.coordinate_status === "ok"
                  ? `GPS ${parsed.latitude}, ${parsed.longitude}`
                  : parsed.coordinate_status === "invalid"
                    ? "Invalid GPS"
                    : "No GPS"
              }
              warn={parsed.coordinate_status === "invalid"}
            />
            {parsed.reported_area ? <ParsedChip label={parsed.reported_area} /> : null}
            {parsed.unresolved_fields.map((field) => (
              <ParsedChip key={field} label={`${field} missing`} warn />
            ))}
          </div>
          {parsed.triage_summary ? (
            <p className="mt-2 text-[12px] font-medium text-neutral-700">{parsed.triage_summary}</p>
          ) : null}
          {parsed.note ? (
            <p className="mt-1.5 text-[12px] italic leading-relaxed text-neutral-500">"{parsed.note}"</p>
          ) : null}
        </div>
      ) : null}

      {result.location ? (
        <div className="rounded-xl bg-neutral-50 px-3.5 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Location</p>
          <p className="mt-0.5 text-[13px] font-medium text-neutral-900">
            {result.location.community?.name ?? "Community not confirmed"}
          </p>
          <p className="text-[12px] text-neutral-500">
            {locationSourceLabel(result.location.source)}
          </p>
          {result.location.age_seconds != null ? (
            <p className="text-[12px] text-neutral-500">Saved {Math.round(result.location.age_seconds / 60)} min ago</p>
          ) : null}
          {result.location.candidate_communities.length ? (
            <p className="mt-1 text-[12px] text-amber-700">
              Possible communities: {result.location.candidate_communities.map((item) => item.name).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {result.duplicate ? (
        <div className="rounded-xl bg-neutral-50 px-3.5 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Duplicate</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-neutral-700">{result.duplicate.detail}</p>
        </div>
      ) : null}

      {result.routing ? (
        <div className="space-y-3 rounded-xl bg-neutral-50 px-3.5 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Routing</p>
          <p className="mt-0.5 text-[14px] font-semibold text-neutral-900">
            {parsed?.category_code ? emergencyTitle(parsed.category_code) : branchTitle(result.branch)}
          </p>
          <p className="text-[12px] leading-relaxed text-neutral-500">
            {responderMessage(parsed?.category_code ?? "emergency", result.routing.route, Boolean(result.routing.responder?.found))}
          </p>
          <div className="grid gap-1 text-[12px] text-neutral-500 sm:grid-cols-2">
            <span>{routeScopeLabel(result.routing.scope, result.routing.responding_community)}</span>
            <span>{routeStateLabel(result.routing.route)}</span>
            <span>{result.routing.department?.name ?? "No department configured"}</span>
          </div>
          {result.routing.responder?.found ? (
            <div className="mt-2 flex gap-4 text-[12px]">
              <div>
                <span className="text-neutral-400">Distance </span>
                <span className="font-semibold text-neutral-900">{formatDistance(result.routing.responder.distance_meters)}</span>
              </div>
              <div>
                <span className="text-neutral-400">ETA </span>
                <span className="font-semibold text-neutral-900">{formatEta(result.routing.responder.eta_seconds)}</span>
              </div>
              <div className="min-w-0">
                <span className="text-neutral-400">Responder </span>
                <span className="truncate font-semibold text-neutral-900">{result.routing.responder.full_name}</span>
              </div>
            </div>
          ) : null}
          {result.location ? (
            <RoutePreviewMap
              location={result.location}
              routing={{
                scope: result.routing.scope,
                responder: result.routing.responder,
                route: result.routing.route,
              }}
            />
          ) : null}
          {result.routing.manual_dispatch ? (
            <p className="text-[12px] font-semibold text-amber-700">
              No qualified responder is available. The emergency remains active and goes to manual dispatch.
            </p>
          ) : null}
        </div>
      ) : null}

      {result.ai_assist && Object.keys(result.ai_assist.applied).length > 0 ? (
        <div className="rounded-xl bg-neutral-50 px-3.5 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">AI assist</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-600">{result.ai_assist.reason}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {Object.entries(result.ai_assist.applied).map(([slot, fix]) => (
              <span key={slot} className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                {slot} → {fix.value}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ParsedChip({ label, warn, strong }: { label: string; warn?: boolean; strong?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        warn ? "bg-amber-50 text-amber-700" : strong ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600",
      )}
    >
      {label}
    </span>
  )
}
