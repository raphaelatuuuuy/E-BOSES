import { useEffect, useState } from "react"
import { BellIcon, ChevronLeftIcon, LockIcon, UserIcon } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { usePageTitle } from "@/hooks/use-page-title"
import {
  HubRow,
  SettingsSkeleton,
  type SettingKey,
} from "@/features/dashboard/components/settings/settings-primitives"
import { AccountPanel } from "@/features/dashboard/components/settings/account-panel"
import { PrivacyPanel } from "@/features/dashboard/components/settings/privacy-panel"
import { NotificationsPanel } from "@/features/dashboard/components/settings/notifications-panel"
import { useAuthSession } from "@/features/auth/auth-session"
import {
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
import { AccountLifecycleFlow } from "@/features/dashboard/components/account-lifecycle-flow"
import {
  AddressConfirmFlow,
  parseStoredAddress,
} from "@/features/dashboard/components/address-confirm-flow"

export type { SettingKey }

type SettingsPanel = "hub" | "account" | "privacy" | "notifications"

function parsePanel(value: string | null): SettingsPanel {
  if (value === "account" || value === "privacy" || value === "notifications") return value
  return "hub"
}

function localPhFromE164(e164: string) {
  const d = e164.replace(/\D/g, "")
  if (d.startsWith("63") && d.length >= 12) return d.slice(2, 12)
  if (d.startsWith("0") && d.length >= 11) return d.slice(1, 11)
  if (d.length === 10 && d.startsWith("9")) return d
  return d.slice(0, 10)
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

  // Profiles card: "Champaca Street, Marikina Heights, Marikina City" (street only + place)
  const displayAddress = (() => {
    const raw = address.trim()
    if (!raw || raw.toLowerCase() === "pending") return ""
    const { street } = parseStoredAddress(raw)
    const streetLine = street.trim() || raw.split(",")[0]?.trim() || raw
    if (!streetLine) return ""
    return `${streetLine}, Marikina Heights, Marikina City`
  })()

  const pendingDeletion = accountRequests.find(
    (request) => request.type === "deletion" && ["submitted", "reviewed"].includes(request.status),
  )

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

          {panel === "account" ? (
            <AccountPanel
              navigate={navigate}
              firstName={firstName}
              onFirstNameChange={setFirstName}
              middleName={middleName}
              onMiddleNameChange={setMiddleName}
              lastName={lastName}
              onLastNameChange={setLastName}
              originalName={{
                firstName: user?.firstName ?? "",
                middleName: user?.middleName ?? "",
                lastName: user?.lastName ?? "",
              }}
              emailDraft={emailDraft}
              onEmailDraftChange={setEmailDraft}
              originalEmail={user?.email ?? ""}
              phoneLocal={phoneLocal}
              onPhoneLocalChange={setPhoneLocal}
              originalPhoneE164={user?.phone_number ?? ""}
              displayAddress={displayAddress}
              onOpenAddressFlow={() => setAddressFlowOpen(true)}
              pendingDeletion={pendingDeletion}
              onOpenLifecycle={() => setLifecycleOpen(true)}
              onSignOut={() => {
                void signOut().finally(() => navigate("/"))
              }}
            />
          ) : null}

          {panel === "privacy" ? (
            <PrivacyPanel
              settings={settings}
              savingSetting={savingSetting}
              onSettingChange={(key, value) => void handleSettingChange(key, value)}
            />
          ) : null}

          {panel === "notifications" ? (
            <NotificationsPanel
              settings={settings}
              savingSetting={savingSetting}
              onSettingChange={(key, value) => void handleSettingChange(key, value)}
              browserState={browserState}
              browserBusy={browserBusy}
              onEnableBrowserNotifications={() => void handleEnableBrowserNotifications()}
              onDisableBrowserNotifications={() => void handleDisableBrowserNotifications()}
            />
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
