import { useEffect, useState } from "react"
import { BellRingIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"
import { getResidentSettings, updateResidentSettings, type ResidentSettings } from "@/features/auth/api"
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  getBrowserNotificationState,
  type BrowserNotificationState,
} from "@/features/dashboard/browser-notifications"

const settingsGroups = [
  {
    title: "Notifications",
    description: "Choose which updates should reach you immediately.",
    items: [
      {
        id: "push_alerts",
        label: "In-app alerts",
        description: "Show notification bell updates while you use E-Boses.",
      },
      {
        id: "report_updates",
        label: "Report updates",
        description: "Status changes and new comments on your reports.",
      },
    ],
  },
  {
    title: "Privacy",
    description: "Control how your reports appear to the community.",
    items: [
      {
        id: "community_sharing",
        label: "Share eligible reports to the feed",
        description: "Reports still hide private contact and location details.",
      },
      {
        id: "location_confirmation",
        label: "Ask before using precise location",
        description: "Confirm location access before submitting a report or SOS.",
      },
    ],
  },
] as const

type SettingKey = "push_alerts" | "report_updates" | "community_sharing" | "location_confirmation"

function SettingsSkeleton() {
  return (
    <div className="flex-1 p-4 md:p-10">
      <div className="max-w-3xl">
        <Skeleton className="h-9 w-40 md:h-10" />
        <Skeleton className="mt-2 h-5 w-72" />
      </div>
      <div className="mt-6 grid max-w-3xl gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  usePageTitle("Settings")
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

  useEffect(() => {
    let cancelled = false
    async function loadSettings() {
      setLoaded(false)
      try {
        const nextSettings = await getResidentSettings()
        if (!cancelled) setSettings(nextSettings)
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
    const next = { ...settings, [key]: value }
    setSettings(next)
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
        ? "VAPID keys are missing on the backend. In-app notifications and WebSocket updates still work."
        : browserState.subscribed
          ? "This browser is subscribed for background report and SOS updates."
          : "Subscribe this browser for urgent report and SOS updates."

  if (!loaded)
    return (
      <div className="flex flex-col">
        <Topbar />
        <SettingsSkeleton />
      </div>
    )

  return (
    <div className="flex flex-col">
      <Topbar />

      <div className="flex-1 p-4 md:p-10">
        <div className="max-w-3xl">
          <h1 className="font-heading text-2xl font-bold text-foreground md:text-3xl">
            Settings
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage account preferences for alerts, reports, and privacy.
          </p>
        </div>

        <div className="mt-6 grid max-w-3xl gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Browser Push Notifications</CardTitle>
              <CardDescription>Allow urgent report and SOS updates to appear even when E-Boses is in the background.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#fff0e8] text-[#ff6a1a]">
                    <BellRingIcon className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-[#07145f]">
                      {browserTitle}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {browserDescription}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  disabled={browserBusy || !browserState.supported || browserState.permission === "denied" || !browserState.serverConfigured}
                  onClick={browserState.subscribed ? handleDisableBrowserNotifications : handleEnableBrowserNotifications}
                  className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
                >
                  {browserBusy ? "Working" : browserState.subscribed ? "Disable" : "Enable"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {settingsGroups.map((group) => (
            <Card key={group.title}>
              <CardHeader>
                <CardTitle>{group.title}</CardTitle>
                <CardDescription>{group.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  {group.items.map((item) => (
                    <Field
                      key={item.id}
                      className="flex-row items-start justify-between gap-4 rounded-lg border border-border bg-background p-4"
                    >
                      <div className="min-w-0">
                        <FieldLabel htmlFor={item.id}>{item.label}</FieldLabel>
                        <FieldDescription className="mt-1">
                          {item.description}
                        </FieldDescription>
                      </div>
                      <Checkbox
                        id={item.id}
                        checked={settings?.[item.id as SettingKey] ?? false}
                        onCheckedChange={(checked) => void handleSettingChange(item.id as SettingKey, checked === true)}
                        disabled={!settings || savingSetting === item.id}
                        aria-label={item.label}
                        aria-busy={savingSetting === item.id}
                      />
                    </Field>
                  ))}
                </FieldGroup>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
