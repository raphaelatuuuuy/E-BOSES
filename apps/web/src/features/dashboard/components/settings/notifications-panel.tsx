import { Button } from "@workspace/ui/components/button"
import {
  ToggleRow,
  type SettingKey,
} from "@/features/dashboard/components/settings/settings-primitives"
import type { ResidentSettings } from "@/features/auth/api"
import type { BrowserNotificationState } from "@/features/dashboard/browser-notifications"

export function NotificationsPanel({
  settings,
  savingSetting,
  onSettingChange,
  browserState,
  browserBusy,
  onEnableBrowserNotifications,
  onDisableBrowserNotifications,
}: {
  settings: ResidentSettings | null
  savingSetting: SettingKey | null
  onSettingChange: (key: SettingKey, value: boolean) => void
  browserState: BrowserNotificationState
  browserBusy: boolean
  onEnableBrowserNotifications: () => void
  onDisableBrowserNotifications: () => void
}) {
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

  return (
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
              ? onDisableBrowserNotifications
              : onEnableBrowserNotifications
          }
          className="h-10 shrink-0 rounded-full bg-brand-orange text-white hover:bg-[#e85f17]"
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
          onChange={(value) => onSettingChange("push_alerts", value)}
        />
        <ToggleRow
          id="report_updates"
          label="Report updates"
          description="Status changes and new comments on your reports."
          checked={settings?.report_updates ?? false}
          disabled={!settings}
          busy={savingSetting === "report_updates"}
          onChange={(value) => onSettingChange("report_updates", value)}
        />
      </div>
    </div>
  )
}
