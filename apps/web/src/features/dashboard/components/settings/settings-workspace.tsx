"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  BellIcon,
  ChevronLeftIcon,
  FileTextIcon,
  LockIcon,
  UserIcon,
  XIcon,
} from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import {
  HubRow,
  SettingsSkeleton,
  type SettingKey,
} from "@/features/dashboard/components/settings/settings-primitives"
import {
  AccountPanel,
  type AccountFlow,
} from "@/features/dashboard/components/settings/account-panel"
import { PrivacyPanel } from "@/features/dashboard/components/settings/privacy-panel"
import { NotificationsPanel } from "@/features/dashboard/components/settings/notifications-panel"
import { ChangePasswordFlow } from "@/features/dashboard/components/settings/flows/change-password-flow"
import { ReverifyEmailFlow } from "@/features/dashboard/components/settings/flows/reverify-email-flow"
import { ReverifyPhoneFlow } from "@/features/dashboard/components/settings/flows/reverify-phone-flow"
import { ReverifyNameFlow } from "@/features/dashboard/components/settings/flows/reverify-name-flow"
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
import { AddressConfirmFlow } from "@/features/dashboard/components/address-confirm-flow"
import {
  SheetDialog,
  SheetList,
  SheetOptionRow,
  SheetPrimaryButton,
} from "@/features/dashboard/components/sheet-dialog"
import { parseStoredAddress } from "@/features/dashboard/lib/address-parse"

export type { SettingKey }

type SettingsPanel = "hub" | "account" | "privacy" | "notifications"

function parsePanel(value: string | null): SettingsPanel {
  if (value === "account" || value === "privacy" || value === "notifications") return value
  return "hub"
}

function flowTitle(flow: AccountFlow): string {
  if (flow === "change-password") return "Change password"
  if (flow === "reverify-name") return "Change name"
  if (flow === "reverify-email") return "Verify email"
  return "Verify mobile number"
}

export function SettingsWorkspace({
  variant = "page",
  onExit,
}: {
  variant?: "page" | "popup" | "sheet"
  /** Pop-up only: paths out of the workspace when the Hub back arrow is hit. */
  onExit?: () => void
}) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, signOut, refreshUser } = useAuthSession()
  // A pop-up always opens at the hub, even when the route underneath it
  // happens to carry `?panel=…`.
  const [panel, setPanelState] = useState<SettingsPanel>(() =>
    variant === "sheet" ? "hub" : parsePanel(searchParams.get("panel")),
  )
  const [flow, setFlow] = useState<AccountFlow | null>(null)
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
  const [address, setAddress] = useState("")
  const [addressFlowOpen, setAddressFlowOpen] = useState(false)
  const [lifecycleOpen, setLifecycleOpen] = useState(false)

  const flowBackRef = useRef<() => void>(() => undefined)
  const registerFlowBack = useCallback((fn: () => void) => {
    flowBackRef.current = fn
  }, [])
  const leaveFlow = () => {
    setFlow(null)
    setPanelState("account")
  }

  /**
   * The pop-up owns its panel outright. Writing `?panel=…` from a dialog also
   * drives the settings *route* sitting underneath it, so drilling into
   * Account swapped the page behind the dialog and left the old full page
   * showing. Only the page and popup variants sync to the URL.
   */
  const syncsPanelToUrl = variant !== "sheet"

  function setPanel(next: SettingsPanel) {
    setPanelState(next)
    if (!syncsPanelToUrl) return
    const onSettingsRoute =
      typeof window !== "undefined" && window.location.pathname.startsWith("/dashboard/settings")
    if (!onSettingsRoute) return
    if (next === "hub") {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ panel: next }, { replace: true })
    }
  }

  useEffect(() => {
    if (!syncsPanelToUrl) return
    const timer = window.setTimeout(() => {
      setPanelState(parsePanel(searchParams.get("panel")))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [searchParams, syncsPanelToUrl])

  useEffect(() => {
    if (!user) return
    const timer = window.setTimeout(() => {
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

  const panelTitle =
    panel === "hub"
      ? "Settings"
      : panel === "account"
        ? "Account settings"
        : panel === "privacy"
          ? "Privacy settings"
          : "Notification settings"

  const dialogLayout = variant === "sheet" || variant === "page"
  const closeDialog = onExit ?? (() => navigate("/dashboard/home", { replace: true }))

  if (!loaded) {
    if (dialogLayout) {
      return (
        <SheetDialog open onClose={closeDialog} title={panelTitle}>
          <SettingsSkeleton />
        </SheetDialog>
      )
    }
    return (
      <div className="scrollbar-hide flex h-full min-h-0 w-full flex-col overflow-y-auto bg-white">
        <SettingsSkeleton />
      </div>
    )
  }

  const accountFlows = (
    <>
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
            void refreshUser().finally(() => {
              navigate("/account-inactive", { replace: true })
            })
          }}
        />
      ) : null}
    </>
  )

  const accountPanel = (
    <AccountPanel
      onOpenFlow={setFlow}
      fullName={
        [user?.firstName, user?.middleName, user?.lastName].filter(Boolean).join(" ").trim()
      }
      email={user?.email ?? ""}
      phoneE164={user?.phone_number ?? ""}
      displayAddress={displayAddress}
      onOpenAddressFlow={() => setAddressFlowOpen(true)}
      pendingDeletion={pendingDeletion}
      onOpenLifecycle={() => setLifecycleOpen(true)}
    />
  )

  const flowBody = (() => {
    if (flow === "change-password") {
      return (
        <ChangePasswordFlow
          registerBack={registerFlowBack}
          onDone={leaveFlow}
          onExit={leaveFlow}
        />
      )
    }
    if (flow === "reverify-email") {
      return (
        <ReverifyEmailFlow
          registerBack={registerFlowBack}
          onDone={leaveFlow}
          onExit={leaveFlow}
        />
      )
    }
    if (flow === "reverify-phone") {
      return (
        <ReverifyPhoneFlow
          registerBack={registerFlowBack}
          onDone={leaveFlow}
          onExit={leaveFlow}
        />
      )
    }
    if (flow === "reverify-name") {
      return (
        <ReverifyNameFlow
          registerBack={registerFlowBack}
          onDone={leaveFlow}
          onExit={leaveFlow}
        />
      )
    }
    return null
  })()

  const headerTitle = flow ? flowTitle(flow) : panelTitle

  if (dialogLayout) {
    return (
      <>
        <SheetDialog
          open
          onClose={closeDialog}
          onBack={
            flow
              ? () => flowBackRef.current()
              : panel !== "hub"
                ? () => setPanel("hub")
                : undefined
          }
          title={headerTitle}
        >
          {flow ? (
            flowBody
          ) : (
            <>
              {panel === "hub" ? (
                <>
                  <SheetList>
                    <SheetOptionRow
                      title="Account"
                      description="Name, email, phone and address"
                      leading={<UserIcon className="size-5" strokeWidth={1.75} />}
                      onClick={() => setPanel("account")}
                      showChevron
                    />
                    <SheetOptionRow
                      title="Privacy"
                      description="What neighbours can see"
                      leading={<LockIcon className="size-5" strokeWidth={1.75} />}
                      onClick={() => setPanel("privacy")}
                      showChevron
                    />
                    <SheetOptionRow
                      title="Notifications"
                      description="Alerts and report updates"
                      leading={<BellIcon className="size-5" strokeWidth={1.75} />}
                      onClick={() => setPanel("notifications")}
                      showChevron
                    />
                    <SheetOptionRow
                      title="Privacy policy"
                      description="How your data is used and protected"
                      leading={<FileTextIcon className="size-5" strokeWidth={1.75} />}
                      onClick={() => window.open("/privacy", "_blank", "noopener")}
                      showChevron
                    />
                  </SheetList>

                  <div className="mt-6">
                    <SheetPrimaryButton
                      onClick={() => {
                        void signOut().finally(() => navigate("/"))
                      }}
                    >
                      Sign out
                    </SheetPrimaryButton>
                  </div>
                </>
              ) : null}

              {panel === "account" ? accountPanel : null}

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
            </>
          )}
        </SheetDialog>
        {accountFlows}
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      {/* Fixed header — back arrow (hub → exit, sub-panel → back to hub), the
          panel title, and an explicit X on pop-up surfaces so settings can
          always be dismissed, even from a sub-panel. */}
      <header className="relative z-10 flex h-14 shrink-0 items-center justify-center border-b border-neutral-100 px-12">
        <button
          type="button"
          onClick={() => {
            if (flow) {
              flowBackRef.current()
            } else if (panel === "hub") {
              if (variant === "popup" && onExit) {
                onExit()
              } else {
                navigate(-1)
              }
            } else {
              setPanel("hub")
            }
          }}
          className="absolute left-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-neutral-800 transition-colors hover:bg-neutral-100"
          aria-label="Back"
        >
          <ChevronLeftIcon className="size-6" strokeWidth={2.25} />
        </button>
        <h1 className="text-center text-[17px] font-semibold tracking-tight text-neutral-900">
          {headerTitle}
        </h1>
        {variant === "popup" && onExit ? (
          <button
            type="button"
            onClick={onExit}
            className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-neutral-800 transition-colors hover:bg-neutral-100"
            aria-label="Close settings"
          >
            <XIcon className="size-5" strokeWidth={2.25} />
          </button>
        ) : null}
      </header>

      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          className={
            variant === "popup"
              ? "min-w-0 px-4 pb-10 pt-4 md:px-6 md:pt-5"
              : "min-w-0 px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-12 md:pt-5 lg:px-8"
          }
        >
          <div className="w-full max-w-lg md:max-w-xl">

          {flow ? (
            flowBody
          ) : (
            <>
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
                <HubRow
                  icon={FileTextIcon}
                  label="Privacy policy"
                  description="How your data is used and protected"
                  onClick={() => window.open("/privacy", "_blank", "noopener")}
                />
              </div>

              <div className="mt-8">
                <SheetPrimaryButton
                  onClick={() => {
                    void signOut().finally(() => navigate("/"))
                  }}
                >
                  Sign out
                </SheetPrimaryButton>
              </div>
            </>
          ) : null}

          {panel === "account" ? accountPanel : null}

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
            </>
          )}
          </div>
        </div>
      </div>

      {accountFlows}
    </div>
  )
}