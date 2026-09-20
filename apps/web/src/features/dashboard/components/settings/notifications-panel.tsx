import type { SettingKey } from "@/features/dashboard/components/settings/settings-primitives"
import type { ResidentSettings } from "@/features/auth/api"
import type { BrowserNotificationState } from "@/features/dashboard/browser-notifications"
import {
  SheetList,
  SheetOptionRow,
  SheetSectionLabel,
  SheetToggleRow,
} from "@/features/dashboard/components/sheet-dialog"
import { cn } from "@workspace/ui/lib/utils"
import { Capacitor } from "@capacitor/core"

export function NotificationsPanel({
  settings,
  savingSetting,
  onSettingChange,
  browserState,
  browserBusy,
  onEnableBrowserNotifications,
  onDisableBrowserNotifications,
  nativePushBusy,
  onDisableNativePush,
}: {
  settings: ResidentSettings | null
  savingSetting: SettingKey | null
  onSettingChange: (key: SettingKey, value: boolean) => void
  browserState: BrowserNotificationState
  browserBusy: boolean
  onEnableBrowserNotifications: () => void
  onDisableBrowserNotifications: () => void
  nativePushBusy: boolean
  onDisableNativePush: () => void
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

  const pushDisabled =
    browserBusy ||
    !browserState.supported ||
    browserState.permission === "denied" ||
    !browserState.serverConfigured

  return (
    <>
      <SheetList>
        <SheetOptionRow
          title={browserTitle}
          description={browserDescription}
          trailing={
            <button
              type="button"
              disabled={pushDisabled}
              onClick={
                browserState.subscribed
                  ? onDisableBrowserNotifications
                  : onEnableBrowserNotifications
              }
              // Same pill as the notifications pop-up, both directions.
              className={cn(
                "shrink-0 rounded-full px-4 py-1.5 text-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                browserState.subscribed
                  ? "text-emerald-700 hover:bg-emerald-50"
                  : "border border-brand-orange text-brand-orange hover:bg-brand-orange hover:text-brand-orange-ink",
              )}
            >
              {browserBusy ? "Working…" : browserState.subscribed ? "Disable" : "Enable"}
            </button>
          }
        />
      </SheetList>

      {Capacitor.getPlatform() === "android" ? (
        <SheetList>
          <SheetOptionRow
            title="Android emergency push"
            description="Disable push notifications for this signed-in account only."
            trailing={
              <button
                type="button"
                disabled={nativePushBusy}
                onClick={onDisableNativePush}
                className="shrink-0 rounded-full border border-neutral-300 px-4 py-1.5 text-[14px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {nativePushBusy ? "Working..." : "Disable"}
              </button>
            }
          />
        </SheetList>
      ) : null}

      <SheetSectionLabel>What you get notified about</SheetSectionLabel>
      <SheetList>
        <SheetToggleRow
          id="push_alerts"
          label="In-app alerts"
          description="Bell updates while you use E-Boses."
          checked={settings?.push_alerts ?? false}
          disabled={!settings}
          busy={savingSetting === "push_alerts"}
          onChange={(value) => onSettingChange("push_alerts", value)}
        />
        <SheetToggleRow
          id="report_updates"
          label="Report updates"
          description="Status changes and new comments on your reports."
          checked={settings?.report_updates ?? false}
          disabled={!settings}
          busy={savingSetting === "report_updates"}
          onChange={(value) => onSettingChange("report_updates", value)}
        />
      </SheetList>
    </>
  )
}
