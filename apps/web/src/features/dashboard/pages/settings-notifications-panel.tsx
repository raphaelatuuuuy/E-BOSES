import { Button } from "@workspace/ui/components/button"

import type { ResidentSettings } from "@/features/auth/api"
import type { BrowserNotificationState } from "@/features/dashboard/browser-notifications"
import type { SettingKey } from "./settings"
import { SettingsToggleRow } from "./settings-toggle-row"

export function SettingsNotificationsPanel({
  settings,
  savingSetting,
  browserState,
  browserBusy,
  browserTitle,
  browserDescription,
  onSettingChange,
  onEnableBrowser,
  onDisableBrowser,
}: {
  settings: ResidentSettings | null
  savingSetting: SettingKey | null
  browserState: BrowserNotificationState
  browserBusy: boolean
  browserTitle: string
  browserDescription: string
  onSettingChange: (key: SettingKey, value: boolean) => void
  onEnableBrowser: () => void
  onDisableBrowser: () => void
}) {
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
              ? onDisableBrowser
              : onEnableBrowser
          }
          className="h-10 shrink-0 rounded-full bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
        >
          {browserBusy ? "Working" : browserState.subscribed ? "Disable" : "Enable"}
        </Button>
      </div>

      <div className="border-t border-neutral-200">
        <SettingsToggleRow
          id="push_alerts"
          label="In-app alerts"
          description="Show notification bell updates while you use E-Boses."
          checked={settings?.push_alerts ?? false}
          disabled={!settings}
          busy={savingSetting === "push_alerts"}
          onChange={(value) => void onSettingChange("push_alerts", value)}
        />
        <SettingsToggleRow
          id="report_updates"
          label="Report updates"
          description="Status changes and new comments on your reports."
          checked={settings?.report_updates ?? false}
          disabled={!settings}
          busy={savingSetting === "report_updates"}
          onChange={(value) => void onSettingChange("report_updates", value)}
        />
      </div>
    </div>
  )
}