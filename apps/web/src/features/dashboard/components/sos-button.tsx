import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckIcon,
  InfoIcon,
  LightbulbIcon,
  CloudUploadIcon,
  Loader2Icon,
  LocateFixedIcon,
  MapPinIcon,
  PhoneIcon,
  SearchIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { lazy, Suspense } from "react"
import {
  Dialog,
  DialogBody,
  DialogFooter,
} from "@/features/dashboard/components/dialog"

const LocationPicker = lazy(() => import("@/features/dashboard/components/location-picker"))
import { createEmergency, getActiveEmergency, getEmergency, type EmergencyAlert, type EmergencyType } from "@/features/dashboard/emergency-api"
import { EmergencyTrackingSheet } from "@/features/dashboard/components/emergency-tracking-sheet"

const activeEmergencyStatuses = ["submitted", "routed", "acknowledged", "en_route", "nearby", "arrived"] as const
type SosPlacement = "inline" | "sidebar" | "compact"
type SosStep = "details" | "review"

function normalizeSosPlacement(value: string | null): SosPlacement {
  if (value === "bottom_bar") return "sidebar"
  if (value === "floating") return "inline"
  if (value === "sidebar" || value === "compact" || value === "inline") return value
  return "inline"
}

const emergencies = [
  { label: "Medical", value: "medical", img: "/contents/medical.png", desc: "Injury, illness, rescue", color: "blue" },
  { label: "Fire", value: "fire", img: "/contents/fire.png", desc: "Building, forest, vehicle", color: "orange" },
  { label: "Crime", value: "crime", img: "/contents/crime.png", desc: "Assault, theft, threat", color: "red" },
  { label: "Disaster", value: "disaster", img: "/contents/disaster.png", desc: "Flood, quake, storm", color: "purple" },
] as const

const emergencyColorMap: Record<string, { border: string; bg: string; text: string; iconBg: string }> = {
  blue: { border: "border-blue-500", bg: "bg-blue-50", text: "text-blue-700", iconBg: "bg-blue-100" },
  red: { border: "border-red-500", bg: "bg-red-50", text: "text-red-700", iconBg: "bg-red-100" },
  orange: { border: "border-orange-500", bg: "bg-orange-50", text: "text-orange-700", iconBg: "bg-orange-100" },
  purple: { border: "border-purple-500", bg: "bg-purple-50", text: "text-purple-700", iconBg: "bg-purple-100" },
}

export function SOSButton() {
  const [placement, setPlacement] = useState<SosPlacement>(() => normalizeSosPlacement(localStorage.getItem("eboses:sos-placement")))
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<SosStep>("details")
  const [emergency, setEmergency] = useState<EmergencyType | "">("")
  const [note, setNote] = useState("")
  const [address, setAddress] = useState("")
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy?: number | null } | null>(null)
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [locating, setLocating] = useState(false)
  const [checkingActive, setCheckingActive] = useState(false)
  const [pendingDispatch, setPendingDispatch] = useState(false)
  const [dispatchCountdown, setDispatchCountdown] = useState(5)
  const [trackingOpen, setTrackingOpen] = useState(false)
  const [trackingAlert, setTrackingAlert] = useState<EmergencyAlert | null>(null)

  useEffect(() => {
    async function loadActive() {
      try {
        const active = await getActiveEmergency()
        if (active) {
          setTrackingAlert(active)
          setTrackingOpen(true)
        }
      } catch {
        // Tracking is helpful but should not block dashboard use.
      }
    }
    void loadActive()
  }, [])

  useEffect(() => {
    function handlePlacement(event: Event) {
      const nextPlacement = (event as CustomEvent<{ placement?: SosPlacement }>).detail?.placement
      setPlacement(normalizeSosPlacement(nextPlacement || localStorage.getItem("eboses:sos-placement")))
    }
    window.addEventListener("eboses:sos-placement-change", handlePlacement)
    return () => window.removeEventListener("eboses:sos-placement-change", handlePlacement)
  }, [])

  const handleSosRef = useRef(handleSosButtonClick)
  handleSosRef.current = handleSosButtonClick

  useEffect(() => {
    function handleOpenEmergency(event: Event) {
      const emergencyId = (event as CustomEvent<{ emergencyId?: number }>).detail?.emergencyId
      if (!emergencyId) return
      void getEmergency(emergencyId).then((alert) => {
        setTrackingAlert(alert)
        setTrackingOpen(true)
        setOpen(false)
      }).catch(() => {
        toast.error("Could not open emergency tracking.")
      })
    }

    function handleOpenSos() {
      handleSosRef.current()
    }

    window.addEventListener("eboses:open-emergency-tracking", handleOpenEmergency)
    window.addEventListener("eboses:open-sos", handleOpenSos)
    return () => {
      window.removeEventListener("eboses:open-emergency-tracking", handleOpenEmergency)
      window.removeEventListener("eboses:open-sos", handleOpenSos)
    }
  }, [])

  function resetForm() {
    setStep("details")
    setEmergency("")
    setNote("")
    setAddress("")
    setLocation(null)
    setMediaFiles([])
    setFieldErrors({})
    setPendingDispatch(false)
    setDispatchCountdown(5)
  }

  function isActiveAlert(alert: EmergencyAlert | null) {
    return Boolean(alert && activeEmergencyStatuses.includes(alert.status as (typeof activeEmergencyStatuses)[number]))
  }

  async function handleSosButtonClick() {
    if (isActiveAlert(trackingAlert)) {
      setTrackingOpen(true)
      return
    }

    setCheckingActive(true)
    try {
      const active = await getActiveEmergency()
      if (active && isActiveAlert(active)) {
        setTrackingAlert(active)
        setTrackingOpen(true)
        return
      }
      setStep("details")
      setOpen(true)
    } catch {
      setOpen(true)
    } finally {
      setCheckingActive(false)
    }
  }

  function captureLocation() {
    if (!navigator.geolocation) {
      setFieldErrors((current) => ({ ...current, location: "Location is not supported by this browser." }))
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        setLocation({ lat: latitude, lng: longitude, accuracy })
        setAddress((current) => current || `Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)}`)
        setFieldErrors((current) => ({ ...current, location: "" }))
        setLocating(false)
      },
      () => {
        setFieldErrors((current) => ({ ...current, location: "Allow location access or enter/pin a location before sending SOS." }))
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (!emergency) errors.type = "Select the emergency type."
    if (!location) errors.location = "Confirm your location before sending SOS."
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function submitEmergency() {
    if (!location || !emergency) return
    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.append("type", emergency)
      formData.append("note", note)
      formData.append("latitude", location.lat.toFixed(7))
      formData.append("longitude", location.lng.toFixed(7))
      formData.append("address", address)
      for (const file of mediaFiles) {
        formData.append("media", file)
      }
      const alert = await createEmergency(formData)
      setTrackingAlert(alert)
      setTrackingOpen(true)
      setOpen(false)
      resetForm()
      toast.success("Emergency alert sent")
    } catch (error) {
      try {
        const active = await getActiveEmergency()
        if (active && isActiveAlert(active)) {
          setTrackingAlert(active)
          setTrackingOpen(true)
          setOpen(false)
          resetForm()
          toast.info("Your active emergency is already open.")
          return
        }
      } catch {
        // Keep the original submission error below.
      }
      toast.error("Could not send emergency alert. Try again.")
    } finally {
      setSubmitting(false)
      setPendingDispatch(false)
      setDispatchCountdown(5)
    }
  }

  function handleSubmit() {
    if (!validate()) return
    setStep("review")
  }

  function startPendingDispatch() {
    setPendingDispatch(true)
    setDispatchCountdown(5)
  }

  function cancelPendingDispatch() {
    setPendingDispatch(false)
    setDispatchCountdown(5)
    toast.info("Emergency alert cancelled before sending.")
  }

  function closeDialog() {
    if (pendingDispatch) cancelPendingDispatch()
    setOpen(false)
  }

  function goBack() {
    if (pendingDispatch) {
      cancelPendingDispatch()
      return
    }
    if (step === "review") {
      setStep("details")
      return
    }
    setOpen(false)
  }

  useEffect(() => {
    if (!pendingDispatch) return
    if (dispatchCountdown <= 0) {
      void submitEmergency()
      return
    }
    const timeout = window.setTimeout(() => setDispatchCountdown((current) => current - 1), 1000)
    return () => window.clearTimeout(timeout)
  }, [pendingDispatch, dispatchCountdown])

  return (
    <>
      <style>{`@keyframes sos-pulse { 0%,100% { box-shadow: 0 10px 24px rgba(248,69,63,0.32); } 50% { box-shadow: 0 10px 24px rgba(248,69,63,0.32), 0 0 0 14px rgba(248,69,63,0.10); } } .sos-glow { animation: sos-pulse 2s ease-in-out infinite; }`}</style>
      {/* Floating SOS quick alert */}
      <div
        className={cn(
          "fixed z-40",
          placement === "inline" && "bottom-26 right-5 md:bottom-8 md:right-8",
          placement === "sidebar" && "bottom-26 right-5 md:hidden",
          placement === "compact" && "bottom-26 right-5 md:bottom-8 md:right-8",
        )}
      >
        <button
          type="button"
          onClick={() => void handleSosButtonClick()}
          disabled={checkingActive}
          className={cn(
            "sos-glow group flex items-center bg-gradient-to-b from-[#ff625a] to-[#f23b35] text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(248,69,63,0.38)] active:translate-y-0 active:scale-[0.98] disabled:cursor-wait disabled:opacity-80",
            placement === "inline" && "gap-2 rounded-l-full rounded-br-md rounded-tr-full py-1.5 pl-1.5 pr-3 md:gap-3 md:py-3 md:pl-3 md:pr-5",
            placement === "sidebar" && "size-14 justify-center rounded-full p-0",
            placement === "compact" && "size-14 justify-center rounded-full p-0 md:size-20",
          )}
          aria-label="Open SOS quick alert"
        >
          <span className={cn("flex shrink-0 items-center justify-center rounded-full", placement === "compact" || placement === "sidebar" ? "size-12" : "size-8 md:size-11")}>
            {checkingActive ? (
              <Loader2Icon className="size-4 md:size-6 animate-spin" />
            ) : (
              <PhoneIcon className="size-5 md:size-7" fill="currentColor" />
            )}
          </span>
          <span className={cn("text-left leading-none", (placement === "compact" || placement === "sidebar") && "sr-only")}>
            <span className="block text-lg md:text-2xl font-extrabold tracking-wide">SOS</span>
            <span className="block text-[10px] font-semibold text-white/90 md:text-xs">Quick alert</span>
          </span>
        </button>
      </div>

      <Dialog open={open} onClose={closeDialog} maxW="max-w-6xl">
        <DialogBody className="bg-white px-5 py-5 md:px-7 md:py-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={goBack}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-[#2447b3] transition-colors hover:text-[#07145f]"
                  >
                    <ArrowLeftIcon className="size-4" />
                    {step === "review" && !pendingDispatch ? "Details" : "Back"}
                  </button>
                  <div className="inline-flex items-center gap-2 rounded-full bg-[#fff1ea] px-3 py-1.5 text-xs font-bold text-[#ff5003]">
                    <PhoneIcon className="size-3.5 rotate-[135deg]" fill="currentColor" />
                    EMERGENCY SOS
                  </div>
                </div>
                <h1 className="mt-5 font-heading text-3xl font-bold text-[#07145f]">Send Emergency Alert</h1>
                <p className="mt-2 text-sm font-medium text-[#324270]">
                  Send an immediate alert to our response team.<br />Help will be dispatched to your location as soon as responders are available.
                </p>
              </div>
              <img src="/contents/emergency-header.png" alt="" className="hidden w-80 shrink-0 self-center object-contain md:block" />
            </div>

          <div className="relative mx-auto grid w-full max-w-lg grid-cols-3 gap-2 py-1">
            <div className={cn("absolute left-[30%] right-[62%] top-[13px] h-0.1", step === "review" || pendingDispatch ? "bg-[#07145f]" : "bg-[#dfe7f5]")} />
            <div className={cn("absolute left-[62%] right-[30%] top-[13px] h-0.1", pendingDispatch ? "bg-[#07145f]" : "bg-[#dfe7f5]")} />
            {[
              { key: "details", label: "Details" },
              { key: "review", label: "Review" },
              { key: "submit", label: "Submit" },
            ].map((item, index) => {
              const isDone = item.key === "details" ? step === "review" || pendingDispatch : item.key === "review" ? pendingDispatch : false
              const isCurrent = item.key === "details" ? step === "details" && !pendingDispatch : item.key === "review" ? step === "review" && !pendingDispatch : pendingDispatch
              return (
                <div key={item.key} className="relative z-10 flex flex-col items-center text-center">
                  <div
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full border text-[11px] font-extrabold",
                      isDone && "border-[#07145f] bg-[#07145f] text-white",
                      isCurrent && !isDone && "border-[#ff6a1a] bg-[#ff6a1a] text-white",
                      !isDone && !isCurrent && "border-[#cbd8ee] bg-white text-[#68739c]",
                    )}
                  >
                    {isDone ? <CheckIcon className="size-4" /> : index + 1}
                  </div>
                  <p className="mt-2 text-[11px] font-extrabold text-[#07145f]">{item.label}</p>
                </div>
              )
            })}
          </div>

          {pendingDispatch ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <div className="w-full max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center shadow-sm">
                <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-red-600 text-4xl font-black text-white shadow-[0_0_0_12px_rgba(220,38,38,0.10)]">
                  {dispatchCountdown}
                </div>
                <h2 className="mt-6 text-2xl font-black text-[#07145f]">Sending alert in {dispatchCountdown}s</h2>
                <p className="mt-2 text-sm leading-6 text-red-800">
                  Cancel now if this was triggered by mistake. Once sent, barangay responders will receive your location and emergency details.
                </p>
                <p className="mt-4 rounded-xl bg-white px-4 py-3 text-xs font-bold text-[#07145f]">
                  For life-threatening emergencies, call 911 immediately.
                </p>
              </div>
            </div>
          ) : step === "review" ? (
            <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
                    <PhoneIcon className="size-5 rotate-[135deg]" fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-red-600">Review emergency details</p>
                    <h2 className="mt-1 text-xl font-black text-[#07145f]">{emergencies.find((item) => item.value === emergency)?.label ?? "Emergency"} alert</h2>
                    <p className="mt-1 text-sm leading-6 text-[#43507f]">Check the details before sending. A short cancel window appears next.</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-[#f8fafc] p-4">
                    <p className="text-xs font-bold uppercase text-[#68739c]">Emergency type</p>
                    <p className="mt-1 text-sm font-black text-[#07145f]">{emergencies.find((item) => item.value === emergency)?.label ?? "Not selected"}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-[#f8fafc] p-4">
                    <p className="text-xs font-bold uppercase text-[#68739c]">Evidence</p>
                    <p className="mt-1 text-sm font-black text-[#07145f]">{mediaFiles.length ? `${mediaFiles.length} file${mediaFiles.length > 1 ? "s" : ""} attached` : "No files attached"}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-[#f8fafc] p-4">
                  <p className="text-xs font-bold uppercase text-[#68739c]">Location</p>
                  <div className="mt-2 flex items-start gap-2">
                    <MapPinIcon className="mt-0.5 size-4 shrink-0 text-[#ff6a1a]" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#07145f]">{address || "Pinned location"}</p>
                      {location ? <p className="mt-1 text-xs text-[#68739c]">{location.lat.toFixed(5)}, {location.lng.toFixed(5)}</p> : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-[#f8fafc] p-4">
                  <p className="text-xs font-bold uppercase text-[#68739c]">Note</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#07145f]">{note.trim() || "No note added. Responders will use your emergency type and pinned location."}</p>
                </div>
              </section>

              <aside className="space-y-3">
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
                  <div className="flex items-start gap-3">
                    <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-red-600" />
                    <div>
                      <p className="text-sm font-black text-red-800">Emergency privacy notice</p>
                      <p className="mt-2 text-xs leading-5 text-red-800">Your exact location, note, and attached evidence are shared only with authorized barangay responders and officials.</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <p className="text-sm font-black text-amber-900">Before sending</p>
                  <ul className="mt-3 space-y-2 text-xs leading-5 text-amber-900">
                    <li>Make sure the pin is near the actual emergency.</li>
                    <li>Only attach media if it is safe to do so.</li>
                    <li>For life-threatening emergencies, call 911 immediately.</li>
                  </ul>
                </div>
              </aside>
            </div>
          ) : (

          <div className="grid gap-7 xl:grid-cols-[minmax(360px,0.95fr)_minmax(460px,1.15fr)]">
            <section className="space-y-7">
              <div>
              <h2 className="text-base font-bold text-[#07145f]">1. What's the emergency?</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {emergencies.map((e) => {
                  const selected = emergency === e.value
                  const colors = emergencyColorMap[e.color]
                  return (
                    <button
                      key={e.label}
                      type="button"
                      disabled={pendingDispatch || submitting}
                      onClick={() => {
                        setEmergency(e.value)
                        setFieldErrors((current) => ({ ...current, type: "" }))
                      }}
                      aria-pressed={selected}
                      aria-invalid={Boolean(fieldErrors.type)}
                      className={cn(
                        "group flex min-h-[130px] flex-col items-center justify-center gap-3 rounded-xl border bg-white p-4 text-center transition-colors",
                        selected
                          ? cn(colors.border, colors.bg, colors.text, "shadow-[0_0_0_1px_rgba(255,106,26,0.25)]")
                          : fieldErrors.type
                            ? "border-destructive text-destructive"
                            : "border-slate-200 text-[#07145f] hover:border-[#ff6a1a]/60",
                      )}
                    >
                      <div className={cn("flex size-12 items-center justify-center rounded-full transition-colors", selected ? colors.iconBg : "bg-[#eef3ff]")}>
                        <img src={e.img} alt="" className="h-14 w-14 object-contain" />
                      </div>
                      <span className="text-sm font-bold">{e.label}</span>
                      <span className="text-xs leading-5 text-[#43507f]">{e.desc}</span>
                    </button>
                  )
                })}
              </div>
              {fieldErrors.type ? <p className="mt-2 text-xs text-destructive">{fieldErrors.type}</p> : null}
            </div>

            <div>
              <h2 className="text-base font-bold text-[#07145f]">2. Emergency details</h2>
              <label htmlFor="sos-note" className="mt-4 block text-sm font-bold text-[#07145f]">Note</label>
              <textarea
                id="sos-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={pendingDispatch || submitting}
                placeholder="Describe what happened, who needs help, and any visible risks nearby."
                className="mt-2 min-h-[180px] w-full resize-none rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-[#07145f] outline-none transition-colors placeholder:text-[#8b96b8] focus:border-[#ff6a1a] focus:ring-2 focus:ring-[#ff6a1a]/15"
              />
              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-[#68739c]">
                <LightbulbIcon className="size-3.5 text-[#2447b3]" />
                Keep it short if urgent. Location and emergency type are the required details.
              </p>
            </div>
          </section>

          <section className="space-y-6">
            <div>
              <h2 className="flex items-center justify-between text-base font-bold text-[#07145f]">
                <span className="flex items-center gap-2">
                  3. Add photos or documents
                  <div className="relative group">
                    <InfoIcon className="size-4 text-[#68739c] cursor-help" />
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block w-56 rounded-lg bg-[#07145f] p-3 text-xs leading-5 text-white shadow-lg z-10">
                      <p className="font-bold mb-1">File tips</p>
                      <ul className="list-disc space-y-1 pl-4">
                        <li>Clear photos help us understand the issue.</li>
                        <li>Include documents if available.</li>
                        <li>Avoid personal or sensitive information.</li>
                      </ul>
                    </div>
                  </div>
                </span>
                <span className="text-xs font-semibold text-[#68739c]">Help Responders</span>
              </h2>
              <label htmlFor="sos-media" className="mt-4 flex min-h-[168px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#9eb7e6] bg-white p-5 text-center transition-colors hover:border-[#ff6a1a] hover:bg-[#fff8f3]">
                <CloudUploadIcon className="size-11 text-[#07145f]" strokeWidth={2} />
                <p className="mt-3 text-sm font-semibold text-[#43507f]">Upload emergency evidence</p>
                <p className="mt-1 text-xs text-[#8b96b8]">Optional, only if safe to attach</p>
                <span className="mt-1 text-sm font-semibold text-[#43507f]">
                  {mediaFiles.length ? `${mediaFiles.length} selected` : "Browse files"}
                </span>
                <p className="mt-3 text-xs text-[#8b96b8]">JPG or PNG up to 2 files</p>
                <input
                  id="sos-media"
                  type="file"
                  accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                  multiple
                  className="sr-only"
                  onChange={(event) => setMediaFiles(Array.from(event.target.files ?? []).slice(0, 2))}
                  disabled={pendingDispatch || submitting}
                />
              </label>
            </div>

            <div>
              <h2 className="text-base font-bold text-[#07145f]">4. Where are you?</h2>
              <div className="mt-4 flex items-center gap-2">
                <div className="relative flex-1">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#68739c] pointer-events-none" />
                  <input
                    type="text"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    disabled={pendingDispatch || submitting}
                    placeholder="Search location"
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm outline-none transition-colors placeholder:text-[#8b96b8] focus:border-[#ff6a1a] focus:ring-2 focus:ring-[#ff6a1a]/15"
                  />
                </div>
                <button
                  type="button"
                  onClick={captureLocation}
                  disabled={locating || pendingDispatch || submitting}
                  className="flex h-11 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-[#43507f] transition-colors hover:bg-[#fff8f3] hover:border-[#ff6a1a] hover:text-[#ff6a1a] disabled:opacity-60"
                >
                  <LocateFixedIcon className="size-4" />
                  {locating ? "..." : "Locate me"}
                </button>
              </div>
              <div className={cn("mt-4 overflow-hidden rounded-xl border border-border", fieldErrors.location && "ring-1 ring-destructive")}>
                <Suspense fallback={<div className="flex min-h-[300px] items-center justify-center rounded-xl text-sm text-[#68739c]">Loading map...</div>}>
                  <LocationPicker
                    address={address}
                    onAddressChange={(value) => {
                      setAddress(value)
                      if (fieldErrors.location) setFieldErrors((prev) => ({ ...prev, location: "" }))
                    }}
                    onPin={(lat, lng) => {
                      setLocation({ lat, lng })
                      setAddress(`Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`)
                      if (fieldErrors.location) setFieldErrors((prev) => ({ ...prev, location: "" }))
                    }}
                  />
                </Suspense>
              </div>
              {fieldErrors.location ? <p className="mt-2 text-xs text-destructive">{fieldErrors.location}</p> : null}
              <div className="mt-4 flex items-center justify-start gap-1.5 text-xs text-[#68739c] md:justify-center">
                <InfoIcon className="size-3.5 shrink-0 text-[#2447b3]" />
                <span>You can adjust the pin or click on the map to refine the exact location.</span>
              </div>
            </div>
          </section>

          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 md:col-span-2">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <p className="text-xs leading-relaxed text-amber-800">
              False or misleading alerts are logged and may lead to account suspension or legal consequences.
            </p>
          </div>
          </div>
          )}
        </DialogBody>

        <DialogFooter className="bg-white">
          <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={pendingDispatch ? cancelPendingDispatch : goBack}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-6 text-sm font-bold text-[#2447b3] transition-colors hover:bg-[#eef3ff] active:scale-[0.98]"
            >
              {pendingDispatch ? "Cancel alert" : step === "review" ? "Back to details" : "Cancel"}
            </button>
            <button
              type="button"
              disabled={submitting || pendingDispatch}
              onClick={step === "details" ? () => void handleSubmit() : startPendingDispatch}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#ff6a1a] px-6 text-sm font-bold text-white transition-colors hover:bg-[#e85f17] active:scale-[0.98] disabled:opacity-70"
            >
              {submitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
              {submitting ? "Sending" : pendingDispatch ? `Sending in ${dispatchCountdown}s` : step === "details" ? "Next: Review" : "Send SOS"}
              <img src="/contents/sos-icon-btn.png" alt="" className="ml-1.5 h-7 w-auto shrink-0" />
            </button>
          </div>
        </DialogFooter>
      </Dialog>

      <EmergencyTrackingSheet
        open={trackingOpen}
        onOpenChange={setTrackingOpen}
        initialAlert={trackingAlert}
        onAlertChange={setTrackingAlert}
      />
    </>
  )
}
