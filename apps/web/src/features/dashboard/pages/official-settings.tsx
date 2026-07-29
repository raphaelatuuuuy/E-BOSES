import { useEffect, useState } from "react"
import { LockIcon, LogOutIcon, MailIcon, UserIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  getBrowserNotificationState,
  type BrowserNotificationState,
} from "@/features/dashboard/browser-notifications"
import {
  FieldShell,
  SettingsSkeleton,
} from "@/features/dashboard/components/settings/settings-primitives"

/**
 * Official-facing settings — simplified version of the resident settings hub
 * built from the shared primitives (FieldShell / SettingsSkeleton). No
 * privacy panel, no reverify flows, no feed-sharing toggles: officials just
 * get account display + change-password + browser push + sign-out.
 */
export default function OfficialSettingsPage() {
  usePageTitle("Settings")
  const navigate = useNavigate()
  const { user, signOut } = useAuthSession()
  const [loaded, setLoaded] = useState(false)
  const [browserState, setBrowserState] = useState<BrowserNotificationState>({
    supported: true,
    permission: "default",
    serverConfigured: false,
    subscribed: false,
  })
  const [browserBusy, setBrowserBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getBrowserNotificationState()
      .then((state) => {
        if (!cancelled) setBrowserState(state)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function refreshBrowserState() {
    setBrowserState(await getBrowserNotificationState())
  }

  async function handleEnableBrowserNotifications() {
    setBrowserBusy(true)
    try {
      await enableBrowserNotifications()
      await refreshBrowserState()
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
          ? "This browser is subscribed for background emergency and concern updates."
          : "Subscribe this browser for urgent emergency and concern updates."

  if (!loaded) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        <SettingsSkeleton />
      </div>
    )
  }

  const fullName = user?.full_name || `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "—"

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <div className="min-w-0 flex-1 px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-2 md:px-6 md:pb-12 md:pt-4 lg:px-8">
        <div className="w-full max-w-lg md:max-w-xl">
          <header className="mb-2 flex h-12 items-center md:pl-1">
            <h1 className="text-[17px] font-semibold tracking-tight text-neutral-900">Settings</h1>
          </header>

          <div className="mt-3 space-y-4">
            <section className="rounded-2xl border border-neutral-200 bg-white p-4">
              <h2 className="text-[17px] font-bold text-neutral-900">Your account</h2>
              <div className="mt-4">
                <FieldShell label="Full name">
                  <div className="flex items-center gap-3 rounded-xl border border-neutral-200 px-3.5 py-3">
                    <UserIcon className="size-4 shrink-0 text-neutral-500" strokeWidth={1.75} />
                    <span className="truncate text-[15px] font-medium text-neutral-900">{fullName}</span>
                  </div>
                </FieldShell>
                <FieldShell label="Email">
                  <div className="flex items-center gap-3 rounded-xl border border-neutral-200 px-3.5 py-3">
                    <MailIcon className="size-4 shrink-0 text-neutral-500" strokeWidth={1.75} />
                    <span className="truncate text-[15px] font-medium text-neutral-900">{user?.email || "—"}</span>
                  </div>
                </FieldShell>
                <button
                  type="button"
                  onClick={() => navigate("/dashboard/settings/change-password")}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-neutral-300 bg-white px-4 text-[14px] font-semibold text-neutral-700 transition-colors hover:border-brand-orange hover:bg-brand-orange hover:text-white"
                >
                  <LockIcon className="size-4" strokeWidth={1.75} />
                  Change password
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-4">
              <h2 className="text-[17px] font-bold text-neutral-900">Notifications</h2>
              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
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
                  onClick={() =>
                    void (browserState.subscribed
                      ? handleDisableBrowserNotifications()
                      : handleEnableBrowserNotifications())
                  }
                  className="h-10 shrink-0 rounded-full bg-brand-orange text-white hover:bg-brand-orange-strong"
                >
                  {browserBusy ? "Working" : browserState.subscribed ? "Disable" : "Enable"}
                </Button>
              </div>
            </section>

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
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
