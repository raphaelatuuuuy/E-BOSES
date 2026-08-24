import { useEffect, useMemo, useRef, useState } from "react"
import { CircleCheck, SirenIcon, UploadCloudIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { SheetDialog, SheetPrimaryButton } from "@/features/dashboard/components/sheet-dialog"
import { describeApiError } from "@/features/dashboard/lib/api-errors"

import { testEmergencySimulation, type EmergencySimulationResult } from "./api"
import { SectionLabel, displayValue } from "./shared"
import { LocationPinMap, type LocationPin } from "./location-pin-map"
import { RoutePreviewMap } from "./route-preview-map"
import { emergencyTitle, locationSourceLabel, responderMessage, routeScopeLabel, routeStateLabel } from "./dispatch-copy"

function formatEta(seconds: number | null) {
  if (seconds == null) return "Unknown"
  const minutes = Math.round(seconds / 60)
  return minutes < 1 ? "Under a minute" : `${minutes} min`
}

function formatDistance(meters: number | null) {
  if (meters == null) return "Unknown"
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

export function EmergencyTestWorkspace() {
  const [description, setDescription] = useState("")
  const [pin, setPin] = useState<LocationPin | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file])
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<EmergencySimulationResult | null>(null)

  const canCheck = description.trim().length >= 10 && pin != null

  async function runTest(confirmedOngoing?: boolean) {
    if (!description.trim() || !pin) return
    setBusy(true)
    try {
      setResult(
        await testEmergencySimulation({
          files: file ? [file] : [],
          description: description.trim(),
          latitude: pin.lat,
          longitude: pin.lng,
          confirmed_ongoing: confirmedOngoing ?? null,
        }),
      )
    } catch (error) {
      toast.error(describeApiError(error, "The sample emergency could not be checked."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Description</label>
        <textarea
          value={description}
          onChange={(event) => {
            setDescription(event.target.value)
            setResult(null)
          }}
          maxLength={255}
          placeholder="Describe the emergency as a resident would report it."
          className="h-28 w-full resize-none rounded-[14px] border-[1.5px] border-neutral-300 bg-white p-4 text-[15px] font-medium text-neutral-900 outline-none transition-colors focus:border-neutral-500"
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files?.[0]
          if (picked) {
            setFile(picked)
            setResult(null)
          }
          event.target.value = ""
        }}
      />

      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Sample photo (optional)</label>
        {preview ? (
          <div className="group relative w-32">
            <img
              src={preview}
              alt="Sample emergency photo"
              className="aspect-square w-full rounded-xl border border-neutral-200 object-cover"
            />
            <button
              type="button"
              onClick={() => {
                setFile(null)
                setResult(null)
              }}
              aria-label="Remove photo"
              className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-neutral-800/50 text-neutral-200 transition-colors hover:bg-neutral-800/70"
            >
              <XIcon className="size-4" strokeWidth={2.5} aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex aspect-[3/1] w-full flex-col items-center justify-center gap-1.5 rounded-xl bg-neutral-100 text-center transition-colors hover:bg-neutral-200"
          >
            <UploadCloudIcon className="size-8 text-neutral-400" strokeWidth={1.5} aria-hidden />
            <span className="text-[13px] font-medium text-neutral-500">Add a sample photo</span>
          </button>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Pinned location</label>
        <LocationPinMap pin={pin} onPinChange={setPin} />
      </div>

      <SheetPrimaryButton
        type="button"
        onClick={() => void runTest()}
        disabled={!canCheck || busy}
        className="bg-brand-navy text-white hover:bg-brand-navy/85 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:hover:bg-neutral-200"
      >
        {busy ? "Checking…" : "Check this sample"}
      </SheetPrimaryButton>

      {result ? (
        <SheetDialog
          open
          onClose={() => setResult(null)}
          title={"path" in result && result.path === "emergency" ? emergencyTitle(result.matched_emergency_type) : "Emergency check result"}
          description="This is a test result. No emergency was filed."
          size="wide"
          bodyClassName="pb-5"
        >
        <div className="space-y-5">
          {!("path" in result) || result.path === undefined ? (
            result.requires_confirmation ? (
              <>
                <div className="flex items-start gap-3">
                  <SirenIcon className="mt-0.5 size-5 shrink-0 text-sos" strokeWidth={2} aria-hidden />
                  <div>
                    <p className="text-[16px] font-bold leading-snug text-neutral-900">
                      {emergencyTitle(result.matched_emergency_type)}
                    </p>
                    <p className="mt-1 text-[14px] leading-relaxed text-neutral-500">{result.emergency_routing_reason}</p>
                    {result.likely_unit ? (
                      <p className="mt-1 text-[13px] font-medium text-neutral-500">
                        Would likely go to <span className="font-semibold text-neutral-900">{result.likely_unit.name}</span>, the
                        unit configured to handle this emergency type.
                      </p>
                    ) : null}
                  </div>
                </div>
                <EmergencyPhotoPreview result={result} />
                <div>
                  <p className="mb-2 text-[14px] font-semibold text-neutral-900">Is this an ongoing emergency?</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void runTest(true)}
                      className="flex-1 rounded-full bg-brand-navy py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      Yes, ongoing
                    </button>
                    <button
                      type="button"
                      onClick={() => void runTest(false)}
                      className="flex-1 rounded-full border border-neutral-300 py-2.5 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-100"
                    >
                      No, not ongoing
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <SectionLabel>What was found</SectionLabel>
                <p className="mt-1.5 text-sm font-medium leading-relaxed text-neutral-900">
                  {displayValue(result.review.recommended_action || "accept")}
                  {result.review.explanation ? `. ${result.review.explanation}` : ""}
                </p>
                <EmergencyPhotoPreview result={result} />
              </div>
            )
          ) : result.path === "concern" ? (
            <>
              <div className="flex items-start gap-3">
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-green-600" strokeWidth={2} aria-hidden />
                <p className="text-[14px] font-medium leading-relaxed text-neutral-900">
                  {result.review.incident_timing_reason || "This is not a current emergency."} It would continue as a concern and would not start emergency dispatch.
                </p>
              </div>
              <EmergencyPhotoPreview result={result} />
            </>
          ) : result.path === "emergency" ? (
            <>
              <div className="flex items-start gap-3">
                <SirenIcon className="mt-0.5 size-5 shrink-0 text-sos" strokeWidth={2} aria-hidden />
                <div>
                  <p className="text-[16px] font-bold leading-snug text-neutral-900">
                    {emergencyTitle(result.matched_emergency_type)}
                  </p>
                  <p className="mt-1 text-[14px] leading-relaxed text-neutral-500">
                    {responderMessage(result.matched_emergency_type, result.routing.route, result.routing.responder_preview.found)}
                  </p>
                </div>
              </div>
              <EmergencyPhotoPreview result={result} />
              <div className="grid gap-1 border-y border-neutral-200 py-3 text-[13px] text-neutral-600 sm:grid-cols-3 sm:gap-4">
                <span className="font-semibold text-neutral-900">{result.location.community?.name ?? "Community not confirmed"}</span>
                <span>{locationSourceLabel(result.location.source)}</span>
                <span>{routeScopeLabel(result.routing.scope, result.routing.responding_community)}</span>
              </div>
              <RoutePreviewMap
                location={result.location}
                routing={{
                  scope: result.routing.scope,
                  responder: result.routing.responder_preview.found
                    ? result.routing.responder_preview.responder
                    : null,
                  route: result.routing.route,
                }}
              />
              {result.routing.responder_preview.found ? (
                <dl className="grid grid-cols-2 gap-3 rounded-[14px] border border-neutral-200 p-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Distance</dt>
                    <dd className="mt-0.5 text-[14px] font-semibold text-neutral-900">
                      {formatDistance(result.routing.responder_preview.distance_meters)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">ETA</dt>
                    <dd className="mt-0.5 text-[14px] font-semibold text-neutral-900">
                      {formatEta(result.routing.responder_preview.eta_seconds)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Responder</dt>
                    <dd className="mt-0.5 text-[14px] font-semibold text-neutral-900">
                      {result.routing.responder_preview.responder.full_name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Unit</dt>
                    <dd className="mt-0.5 text-[14px] font-semibold text-neutral-900">
                      {result.routing.department?.name ?? "Manual dispatch"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Route</dt>
                    <dd className="mt-0.5 text-[14px] font-semibold text-neutral-900">
                      {routeStateLabel(result.routing.route)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Summary</dt>
                    <dd className="mt-0.5 text-[14px] font-semibold text-neutral-900">
                      {result.routing.route.summary || "No route summary"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className={cn("rounded-[14px] border border-neutral-200 p-4 text-[13px] font-medium text-neutral-500")}>
                  No qualified responder is available. The emergency remains active and goes to manual dispatch.
                </p>
              )}
            </>
          ) : null}
        </div>
        </SheetDialog>
      ) : null}
    </div>
  )
}

function EmergencyPhotoPreview({ result }: { result: EmergencySimulationResult }) {
  const protectedImage = result.privacy?.protected_image
  if (!protectedImage) return null
  return (
    <figure>
      <img
        src={protectedImage}
        alt="The sample photo with sensitive areas blurred"
        className="max-h-40 w-full rounded-[14px] border border-green-200 object-contain"
      />
      <figcaption className="mt-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">
        What residents would see
      </figcaption>
    </figure>
  )
}
