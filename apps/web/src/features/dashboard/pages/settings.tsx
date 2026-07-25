import { useEffect, useState } from "react"
import {
  BellIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  Loader2Icon,
  LockIcon,
  LogOutIcon,
  PencilIcon,
  UserIcon,
} from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  createAccountRequest,
  getAccountDataExport,
  getResidentSettings,
  listAccountRequests,
  updateResidentSettings,
  type AccountRequest,
  type ResidentSettings,
} from "@/features/auth/api"
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  getBrowserNotificationState,
  type BrowserNotificationState,
} from "@/features/dashboard/browser-notifications"
import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { AccountLifecycleFlow } from "@/features/dashboard/components/account-lifecycle-flow"
import {
  AddressConfirmFlow,
  parseStoredAddress,
} from "@/features/dashboard/components/address-confirm-flow"
import { cn } from "@workspace/ui/lib/utils"

const outlineBtn =
  "inline-flex h-10 items-center rounded-full border border-neutral-300 bg-white px-4 text-[14px] font-semibold text-neutral-700 transition-colors hover:border-[#ff8133] hover:bg-[#ff8133] hover:text-white"

export type SettingKey = "push_alerts" | "report_updates" | "community_sharing" | "location_confirmation"
type SettingsPanel = "hub" | "account" | "privacy" | "notifications"

function parsePanel(value: string | null): SettingsPanel {
  if (value === "account" || value === "privacy" || value === "notifications") return value
  return "hub"
}

/** PH mobile E.164: +639XXXXXXXXX */
function isValidPhMobileE164(value: string) {
  return /^\+639\d{9}$/.test(value)
}

/** Local 10-digit national number (9XXXXXXXXX) → +63… */
function e164FromLocalPh(local: string) {
  const d = local.replace(/\D/g, "")
  if (d.length === 10 && d.startsWith("9")) return `+63${d}`
  if (d.startsWith("63") && d.length === 12) return `+${d}`
  if (d.startsWith("0") && d.length === 11) return `+63${d.slice(1)}`
  return ""
}

function localPhFromE164(e164: string) {
  const d = e164.replace(/\D/g, "")
  if (d.startsWith("63") && d.length >= 12) return d.slice(2, 12)
  if (d.startsWith("0") && d.length >= 11) return d.slice(1, 11)
  if (d.length === 10 && d.startsWith("9")) return d
  return d.slice(0, 10)
}

function starPoints(cx: number, cy: number, outer: number, inner: number) {
  const pts: string[] = []
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push(`${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`)
  }
  return pts.join(" ")
}

function PhilippinesFlag({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 36 24"
      className={className}
      aria-hidden="true"
    >
      <rect width="36" height="12" y="0" fill="#0038A8" />
      <rect width="36" height="12" y="12" fill="#CE1126" />
      <path d="M0 0 L18 12 L0 24 Z" fill="#FFFFFF" />
      <circle cx="6.5" cy="12" r="2.15" fill="#FCD116" />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i * 45 * Math.PI) / 180
        return (
          <line
            key={i}
            x1={6.5 + Math.cos(a) * 2.5}
            y1={12 + Math.sin(a) * 2.5}
            x2={6.5 + Math.cos(a) * 3.7}
            y2={12 + Math.sin(a) * 3.7}
            stroke="#FCD116"
            strokeWidth="0.7"
            strokeLinecap="round"
          />
        )
      })}
      {[
        [3.2, 4.2],
        [3.2, 19.8],
        [12.2, 12],
      ].map(([cx, cy], i) => (
        <polygon key={`star-${i}`} fill="#FCD116" points={starPoints(cx, cy, 1.05, 0.45)} />
      ))}
    </svg>
  )
}

function SettingsSkeleton() {
  return (
    <div className="min-w-0 flex-1 bg-white px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4 md:px-8 md:pb-12 md:pt-6">
      <div className="mx-auto max-w-lg">
        <Skeleton className="mx-auto h-6 w-28 bg-neutral-100" />
        <div className="mt-8 space-y-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-14 w-full rounded-none border-b border-neutral-100 bg-neutral-100"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function HubRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[56px] w-full items-center gap-3.5 border-b border-neutral-200 px-1 py-3.5 text-left transition-colors hover:bg-neutral-50"
    >
      <Icon className="size-5 shrink-0 text-neutral-800" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 text-[16px] font-normal text-neutral-900">{label}</span>
      <ChevronRightIcon className="size-5 shrink-0 text-neutral-400" strokeWidth={2} />
    </button>
  )
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  busy,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  busy?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-200 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[15px] font-medium text-neutral-900">
          {label}
        </label>
        <p className="mt-1 text-[13px] leading-5 text-neutral-500">{description}</p>
      </div>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled || busy}
        aria-busy={busy}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5"
      />
    </div>
  )
}

function FieldShell({
  label,
  children,
  hint,
}: {
  label?: string
  children: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <div className="mb-4">
      {label ? (
        <p className="mb-2 text-[13px] font-semibold text-neutral-700">{label}</p>
      ) : null}
      {children}
      {hint}
    </div>
  )
}

export default function SettingsPage() {
  usePageTitle("Settings")
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, signOut, refreshUser } = useAuthSession()
  const [panel, setPanelState] = useState<SettingsPanel>(() =>
    parsePanel(searchParams.get("panel")),
  )
  const [loaded, setLoaded] = useState(false)
  const [settings, setSettings] = useState<ResidentSettings | null>(null)
  const [savingSetting, setSavingSetting] = useState<SettingKey | null>(null)
  const [browserState, setBrowserState] = useState<BrowserNotificationState>({
    supported: true,
    permission: "default",
    serverConfigured: false,
    subscribed: false,
  })
  const [browserBusy, setBrowserBusy] = useState(false)
  const [accountRequests, setAccountRequests] = useState<AccountRequest[]>([])
  const [savingRequest, setSavingRequest] = useState<AccountRequest["type"] | null>(null)
  const [downloadingExport, setDownloadingExport] = useState(false)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [middleName, setMiddleName] = useState("")
  /** Local PH mobile digits only (9XXXXXXXXX), displayed beside +63 */
  const [phoneLocal, setPhoneLocal] = useState("")
  const [emailDraft, setEmailDraft] = useState("")
  const [address, setAddress] = useState("")
  const [addressFlowOpen, setAddressFlowOpen] = useState(false)
  const [lifecycleOpen, setLifecycleOpen] = useState(false)

  function setPanel(next: SettingsPanel) {
    setPanelState(next)
    if (next === "hub") {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ panel: next }, { replace: true })
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPanelState(parsePanel(searchParams.get("panel")))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [searchParams])

  useEffect(() => {
    if (!user) return
    const timer = window.setTimeout(() => {
      setFirstName(user.firstName ?? "")
      setLastName(user.lastName ?? "")
      setMiddleName(user.middleName ?? "")
      setPhoneLocal(localPhFromE164(user.phone_number ?? ""))
      setEmailDraft(user.email ?? "")
      const nextAddress = (user.address ?? "").trim()
      setAddress(
        !nextAddress || nextAddress.toLowerCase() === "pending" ? "" : nextAddress,
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [user])

  useEffect(() => {
    let cancelled = false
    async function loadSettings() {
      setLoaded(false)
      try {
        const [nextSettings, nextRequests] = await Promise.all([
          getResidentSettings(),
          listAccountRequests(),
        ])
        if (!cancelled) {
          setSettings(nextSettings)
          setAccountRequests(nextRequests)
        }
      } catch {
        if (!cancelled) toast.error("Could not load settings.")
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    void loadSettings()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void refreshBrowserState()
  }, [])

  async function refreshBrowserState() {
    setBrowserState(await getBrowserNotificationState())
  }

  async function handleSettingChange(key: SettingKey, value: boolean) {
    if (!settings) return
    const previous = settings
    setSettings({ ...settings, [key]: value })
    setSavingSetting(key)
    try {
      setSettings(await updateResidentSettings({ [key]: value }))
      if (key === "push_alerts") {
        window.dispatchEvent(new Event("eboses:notifications-refresh"))
      }
    } catch {
      setSettings(previous)
      toast.error("Could not save setting. Try again.")
    } finally {
      setSavingSetting(null)
    }
  }

  async function handleEnableBrowserNotifications() {
    setBrowserBusy(true)
    try {
      await enableBrowserNotifications()
      await refreshBrowserState()
      if (settings && !settings.push_alerts) {
        setSettings(await updateResidentSettings({ push_alerts: true }))
      }
      toast.success("Browser notifications enabled")
    } catch (error) {
      await refreshBrowserState()
      toast.error(error instanceof Error ? error.message : "Could not enable browser notifications.")
    } finally {
      setBrowserBusy(false)
    }
  }

  async function handleDisableBrowserNotifications() {
    setBrowserBusy(true)
    try {
      await disableBrowserNotifications()
      await refreshBrowserState()
      toast.success("Browser notifications disabled")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disable browser notifications.")
    } finally {
      setBrowserBusy(false)
    }
  }

  async function handleAccountRequest(type: AccountRequest["type"]) {
    const existing = accountRequests.find(
      (request) => request.type === type && ["submitted", "reviewed"].includes(request.status),
    )
    if (existing) {
      toast.info("Request already submitted", {
        description: `Status: ${existing.status.replace("_", " ")}`,
      })
      return
    }
    setSavingRequest(type)
    try {
      const created = await createAccountRequest({
        type,
        note:
          type === "deletion"
            ? "Resident requested account deletion from Settings."
            : "Resident requested an account data export from Settings.",
      })
      setAccountRequests((current) => [created, ...current])
      toast.success(type === "deletion" ? "Deletion request submitted" : "Data export requested")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit the request.")
    } finally {
      setSavingRequest(null)
    }
  }

  async function handleDownloadExport(requestId: number) {
    setDownloadingExport(true)
    try {
      const payload = await getAccountDataExport(requestId)
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `e-boses-data-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success("Your information was downloaded")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download your information.")
    } finally {
      setDownloadingExport(false)
    }
  }

  const phoneE164 = e164FromLocalPh(phoneLocal)
  const phoneValid = isValidPhMobileE164(phoneE164)
  const phoneDirty =
    phoneE164 !== (user?.phone_number ?? "").trim() && phoneLocal.replace(/\D/g, "").length > 0
  const emailDirty =
    emailDraft.trim().toLowerCase() !== (user?.email ?? "").trim().toLowerCase()
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDraft.trim())
  const nameDirty =
    firstName.trim() !== (user?.firstName ?? "").trim() ||
    lastName.trim() !== (user?.lastName ?? "").trim() ||
    middleName.trim() !== (user?.middleName ?? "").trim()

  // Profiles card: "Champaca Street, Marikina Heights, Marikina City" (street only + place)
  const displayAddress = (() => {
    const raw = address.trim()
    if (!raw || raw.toLowerCase() === "pending") return ""
    const { street } = parseStoredAddress(raw)
    const streetLine = street.trim() || raw.split(",")[0]?.trim() || raw
    if (!streetLine) return ""
    return `${streetLine}, Marikina Heights, Marikina City`
  })()

  const browserTitle = !browserState.supported
    ? "Not supported on this browser"
    : browserState.permission === "denied"
      ? "Browser notifications are blocked"
      : !browserState.serverConfigured
        ? "Server push is not configured"
        : browserState.subscribed
          ? "Browser notifications are enabled"
          : "Enable browser notifications"

  const browserDescription = !browserState.supported
    ? "Use in-app notifications from the bell while signed in."
    : browserState.permission === "denied"
      ? "Allow notifications in your browser site settings before enabling this."
      : !browserState.serverConfigured
        ? "VAPID keys are missing on the backend. In-app notifications still work."
        : browserState.subscribed
          ? "This browser is subscribed for background report and SOS updates."
          : "Subscribe this browser for urgent report and SOS updates."

  const pendingExport = accountRequests.find(
    (request) =>
      request.type === "data_export" && ["submitted", "reviewed"].includes(request.status),
  )
  const completedExport = accountRequests.find(
    (request) => request.type === "data_export" && request.status === "completed",
  )
  const pendingDeletion = accountRequests.find(
    (request) => request.type === "deletion" && ["submitted", "reviewed"].includes(request.status),
  )

  const fullName =
    `${firstName} ${lastName}`.trim() ||
    user?.full_name ||
    "Resident"
  // Root cause of "Pending": DB default on User.barangay is "Pending" until set.
  // Capstone area is Marikina Heights — never show placeholder values in UI.
  const rawBarangay = (user?.barangay || "").trim()
  const barangay =
    !rawBarangay || rawBarangay.toLowerCase() === "pending"
      ? "Marikina Heights"
      : rawBarangay
  const letter = (user?.firstName?.[0] || fullName[0] || "?").toUpperCase()

  if (!loaded) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        <SettingsSkeleton />
      </div>
    )
  }

  const panelTitle =
    panel === "hub"
      ? "Settings"
      : panel === "account"
        ? "Account settings"
        : panel === "privacy"
          ? "Privacy settings"
          : "Notification settings"

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      {/* Desktop: content sits in the main column beside the sidebar (left-aligned) */}
      <div className="min-w-0 flex-1 px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-2 md:px-6 md:pb-12 md:pt-4 lg:px-8">
        <div className="w-full max-w-lg md:max-w-xl">
          <header className="relative mb-2 flex h-12 items-center justify-center md:justify-start md:pl-10">
            <button
              type="button"
              onClick={() => {
                if (panel === "hub") navigate(-1)
                else setPanel("hub")
              }}
              className="absolute left-0 flex size-10 items-center justify-center rounded-full text-neutral-800 hover:bg-neutral-100"
              aria-label="Back"
            >
              <ChevronLeftIcon className="size-6" strokeWidth={2.25} />
            </button>
            <h1 className="text-[17px] font-semibold tracking-tight text-neutral-900">
              {panelTitle}
            </h1>
          </header>

          {/* ── Hub ── */}
          {panel === "hub" ? (
            <>
              <div className="mt-2">
                <HubRow
                  icon={UserIcon}
                  label="Account settings"
                  onClick={() => setPanel("account")}
                />
                <HubRow
                  icon={LockIcon}
                  label="Privacy settings"
                  onClick={() => setPanel("privacy")}
                />
                <HubRow
                  icon={BellIcon}
                  label="Notification settings"
                  onClick={() => setPanel("notifications")}
                />
              </div>

              <div className="mt-8 space-y-1 px-1">
                <a
                  href="/privacy"
                  className="block py-2.5 text-[15px] font-normal text-neutral-600 no-underline transition-colors hover:text-neutral-900"
                >
                  Privacy policy
                </a>
                <button
                  type="button"
                  onClick={() => {
                    void signOut().finally(() => navigate("/"))
                  }}
                  className="block w-full py-2.5 text-left text-[15px] font-normal text-neutral-600 transition-colors hover:text-neutral-900"
                >
                  Log out
                </button>
              </div>
            </>
          ) : null}

          {/* ── Account settings (Nextdoor-style white) ── */}
          {panel === "account" ? (
            <div className="mt-3 space-y-4">
              {/* Your account */}
              <section className="rounded-2xl border border-neutral-200 bg-white p-4">
                <h2 className="text-[17px] font-bold text-neutral-900">Your account</h2>

                <div className="mt-4">
                  <FieldShell label="Full name">
                    <div className="space-y-3">
                      <FloatingLabelInput
                        id="account-first-name"
                        label="First name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        autoComplete="given-name"
                      />
                      <FloatingLabelInput
                        id="account-middle-name"
                        label="Middle name (optional)"
                        value={middleName}
                        onChange={(e) => setMiddleName(e.target.value)}
                        autoComplete="additional-name"
                      />
                      <FloatingLabelInput
                        id="account-last-name"
                        label="Last name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        autoComplete="family-name"
                      />
                      {nameDirty ? (
                        <button
                          type="button"
                          onClick={() =>
                            navigate("/dashboard/settings/reverify/name", {
                              state: {
                                firstName: firstName.trim(),
                                middleName: middleName.trim(),
                                lastName: lastName.trim(),
                              },
                            })
                          }
                          className={outlineBtn}
                        >
                          Change name
                        </button>
                      ) : null}
                    </div>
                  </FieldShell>

                  <FieldShell label="Email">
                    <div className="space-y-3">
                      <FloatingLabelInput
                        id="account-email"
                        type="email"
                        label="Email address"
                        value={emailDraft}
                        onChange={(e) => setEmailDraft(e.target.value)}
                        autoComplete="email"
                      />
                      {emailDirty && emailLooksValid ? (
                        <button
                          type="button"
                          onClick={() =>
                            navigate("/dashboard/settings/reverify/email", {
                              state: { email: emailDraft.trim() },
                            })
                          }
                          className={outlineBtn}
                        >
                          Change email
                        </button>
                      ) : null}
                      {emailDirty && !emailLooksValid ? (
                        <p className="text-[12px] text-red-600">Enter a valid email address.</p>
                      ) : null}
                    </div>
                  </FieldShell>

                  <FieldShell label="Password">
                    <button
                      type="button"
                      onClick={() => navigate("/dashboard/settings/change-password")}
                      className={outlineBtn}
                    >
                      Change password
                    </button>
                  </FieldShell>

                  <FieldShell label="Mobile number">
                    <div className="space-y-3">
                      <div className="flex items-stretch gap-2.5">
                        <div
                          className={cn(
                            "flex h-[60px] shrink-0 items-center gap-2 rounded-[12px] border-2 bg-white px-3.5",
                            phoneLocal && !phoneValid ? "border-destructive" : "border-input",
                          )}
                          aria-label="Philippines country code +63"
                        >
                          <PhilippinesFlag className="h-5 w-[1.875rem] shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" />
                          <span className="text-base font-medium tabular-nums text-neutral-800">
                            +63
                          </span>
                        </div>
                        <div className="relative min-w-0 flex-1">
                          <input
                            id="account-phone"
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel-national"
                            value={phoneLocal}
                            placeholder=""
                            aria-invalid={phoneLocal && !phoneValid ? true : undefined}
                            onChange={(e) => {
                              let d = e.target.value.replace(/\D/g, "")
                              if (d.startsWith("63")) d = d.slice(2)
                              if (d.startsWith("0")) d = d.slice(1)
                              setPhoneLocal(d.slice(0, 10))
                            }}
                            className={cn(
                              "peer box-border h-[60px] w-full rounded-[12px] bg-white pl-[0.7rem] pr-4 pt-[1.75rem] pb-2.5 text-base leading-5 text-neutral-800 outline-none transition-[border-width,border-color]",
                              "border-2 border-input focus-visible:border-[3px] focus-visible:border-primary",
                              "aria-invalid:border-destructive",
                            )}
                          />
                          <label
                            htmlFor="account-phone"
                            className={cn(
                              "pointer-events-none absolute z-[1] overflow-hidden text-ellipsis whitespace-nowrap text-neutral-800 transition-all duration-150 ease-out",
                              "left-[calc(0.7rem+2px)] right-[calc(1rem+2px)] peer-focus-visible:left-[calc(0.7rem+3px)] peer-focus-visible:right-[calc(1rem+3px)]",
                              phoneLocal
                                ? "top-2.5 translate-y-0 text-[11px] font-medium leading-[14px]"
                                : "top-1/2 -translate-y-1/2 text-[18px] font-normal leading-5 peer-focus-visible:top-2.5 peer-focus-visible:translate-y-0 peer-focus-visible:text-[11px] peer-focus-visible:font-medium peer-focus-visible:leading-[14px]",
                              phoneLocal && !phoneValid && "text-destructive",
                            )}
                          >
                            Mobile number
                          </label>
                        </div>
                      </div>
                      {phoneLocal && !phoneValid ? (
                        <p className="text-[12px] text-red-600">
                          Enter a valid PH mobile number (10 digits starting with 9).
                        </p>
                      ) : null}
                      {phoneDirty && phoneValid ? (
                        <button
                          type="button"
                          onClick={() =>
                            navigate("/dashboard/settings/reverify/phone", {
                              state: { phone: phoneE164 },
                            })
                          }
                          className={outlineBtn}
                        >
                          Change number
                        </button>
                      ) : null}
                    </div>
                  </FieldShell>
                </div>
              </section>

              {/* Profiles card — Nextdoor layout, white */}
              <section className="rounded-2xl border border-neutral-200 bg-white px-4 py-4">
                <h2 className="text-[16px] font-bold leading-none text-neutral-900">Profiles</h2>

                <div className="mt-4 flex items-start gap-3">
                  {/* Letter avatar only */}
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#c5d0e6] text-[16px] font-bold text-[#2c3a5a]">
                    {letter}
                  </span>

                  <div className="min-w-0 flex-1 pt-0.5">
                    {/* Name + place (stacked like Nextdoor) */}
                    <p className="text-[15px] font-semibold leading-snug text-neutral-900">
                      {fullName}
                    </p>
                    <p className="mt-0.5 text-[13px] font-normal leading-snug text-neutral-500">
                      {barangay}
                    </p>

                    {/* Address + pencil immediately beside the text (not stretched to the edge) */}
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setAddressFlowOpen(true)}
                        className="max-w-[min(100%,20rem)] min-w-0 text-left"
                      >
                        <p className="text-[14px] font-normal leading-[1.35] text-neutral-800">
                          {displayAddress || (
                            <span className="text-neutral-400">Add street address</span>
                          )}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddressFlowOpen(true)}
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
                        aria-label={displayAddress ? "Confirm or edit address" : "Add street address"}
                      >
                        <PencilIcon className="size-5" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              {/* Download your information */}
              <section className="rounded-2xl border border-neutral-200 bg-white p-4">
                <h2 className="text-[17px] font-bold text-neutral-900">Download your information</h2>
                <p className="mt-2 text-[14px] leading-5 text-neutral-600">
                  You can download a copy of your information on E-Boses. This includes:
                </p>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[14px] leading-5 text-neutral-600">
                  <li>Posts, replies, and other content you&apos;ve created</li>
                  <li>Account information, like email preferences and profile details</li>
                  <li>
                    Information about your activity, like the device types and app versions
                    you&apos;ve used
                  </li>
                </ul>

                <button
                  type="button"
                  disabled={Boolean(pendingExport) || savingRequest === "data_export" || downloadingExport}
                  onClick={() => completedExport && !pendingExport ? void handleDownloadExport(completedExport.id) : void handleAccountRequest("data_export")}
                  className={cn(
                    "mt-4 flex h-11 w-full items-center justify-center rounded-full border text-[14px] font-semibold transition-colors",
                    pendingExport
                      ? "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400"
                      : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50",
                  )}
                >
                  {savingRequest === "data_export" || downloadingExport ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : pendingExport ? (
                    "Request submitted"
                  ) : completedExport ? (
                    <><DownloadIcon className="mr-2 size-4" />Download JSON export</>
                  ) : (
                    "Request my information"
                  )}
                </button>

                {pendingExport ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-neutral-100 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-neutral-700">
                      <DownloadIcon className="size-4 shrink-0" />
                      <span>
                        Your request is{" "}
                        {pendingExport.status.replace("_", " ")}
                      </span>
                    </div>
                  </div>
                ) : null}
                {completedExport && !pendingExport ? (
                  <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[13px] font-semibold text-emerald-800">Your approved export is ready. Downloading it is recorded in your account audit history.</p>
                    <button type="button" disabled={savingRequest === "data_export"} onClick={() => void handleAccountRequest("data_export")} className="shrink-0 text-[12px] font-bold text-emerald-800 underline underline-offset-2">Request updated copy</button>
                  </div>
                ) : null}
              </section>

              {/* Log out / deactivate */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    void signOut().finally(() => navigate("/"))
                  }}
                  className="inline-flex items-center gap-2 text-[14px] font-semibold text-neutral-800"
                >
                  <LogOutIcon className="size-4" strokeWidth={1.75} />
                  Log out
                </button>
                <button
                  type="button"
                  disabled={Boolean(pendingDeletion)}
                  onClick={() => setLifecycleOpen(true)}
                  className="text-[14px] font-semibold text-neutral-600 hover:text-red-700 disabled:opacity-50"
                >
                  {pendingDeletion ? "Deletion requested" : "Deactivate your account"}
                </button>
              </div>
            </div>
          ) : null}

          {/* ── Privacy ── */}
          {panel === "privacy" ? (
            <div className="mt-4 border-t border-neutral-200">
              <ToggleRow
                id="community_sharing"
                label="Share eligible reports to the feed"
                description="Reports still hide private contact and location details."
                checked={settings?.community_sharing ?? false}
                disabled={!settings}
                busy={savingSetting === "community_sharing"}
                onChange={(value) => void handleSettingChange("community_sharing", value)}
              />
              <ToggleRow
                id="location_confirmation"
                label="Ask before using precise location"
                description="Confirm location access before submitting a report or SOS."
                checked={settings?.location_confirmation ?? false}
                disabled={!settings}
                busy={savingSetting === "location_confirmation"}
                onChange={(value) => void handleSettingChange("location_confirmation", value)}
              />
            </div>
          ) : null}

          {/* ── Notifications ── */}
          {panel === "notifications" ? (
            <div className="mt-4">
              <div className="mb-4 flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-neutral-900">{browserTitle}</p>
                  <p className="mt-1 text-[13px] leading-5 text-neutral-500">{browserDescription}</p>
                </div>
                <Button
                  type="button"
                  disabled={
                    browserBusy ||
                    !browserState.supported ||
                    browserState.permission === "denied" ||
                    !browserState.serverConfigured
                  }
                  onClick={
                    browserState.subscribed
                      ? handleDisableBrowserNotifications
                      : handleEnableBrowserNotifications
                  }
                  className="h-10 shrink-0 rounded-full bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
                >
                  {browserBusy ? "Working" : browserState.subscribed ? "Disable" : "Enable"}
                </Button>
              </div>

              <div className="border-t border-neutral-200">
                <ToggleRow
                  id="push_alerts"
                  label="In-app alerts"
                  description="Show notification bell updates while you use E-Boses."
                  checked={settings?.push_alerts ?? false}
                  disabled={!settings}
                  busy={savingSetting === "push_alerts"}
                  onChange={(value) => void handleSettingChange("push_alerts", value)}
                />
                <ToggleRow
                  id="report_updates"
                  label="Report updates"
                  description="Status changes and new comments on your reports."
                  checked={settings?.report_updates ?? false}
                  disabled={!settings}
                  busy={savingSetting === "report_updates"}
                  onChange={(value) => void handleSettingChange("report_updates", value)}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {addressFlowOpen ? (
        <AddressConfirmFlow
          initialAddress={displayAddress}
          onClose={() => setAddressFlowOpen(false)}
          onSaved={(nextAddress) => {
            setAddress(nextAddress)
            void refreshUser()
            toast.success("Address updated")
          }}
        />
      ) : null}

      {lifecycleOpen ? (
        <AccountLifecycleFlow
          onClose={() => {
            setLifecycleOpen(false)
            void listAccountRequests()
              .then(setAccountRequests)
              .catch(() => undefined)
          }}
          onDeactivated={() => {
            setLifecycleOpen(false)
            // Session stays signed in as suspended so Reactivate works without re-login.
            void refreshUser().finally(() => {
              navigate("/account-inactive", { replace: true })
            })
          }}
        />
      ) : null}
    </div>
  )
}
