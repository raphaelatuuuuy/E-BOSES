import type { BrowserNotificationState } from "@/features/dashboard/browser-notifications"

export function NotificationBrowserPushBanner({
  browserState,
  browserBusy,
  testPushBusy,
  testPushResult,
  installPrompt,
  installedStandalone,
  onTogglePush,
  onSendTest,
  onInstallApp,
}: {
  browserState: BrowserNotificationState
  browserBusy: boolean
  testPushBusy: boolean
  testPushResult: string | null
  installPrompt: Event | null
  installedStandalone: boolean
  onTogglePush: () => void
  onSendTest: () => void
  onInstallApp: () => void
}) {
  return (
    <div className="mb-2 rounded-2xl border border-[#ffd8c2] bg-[#fff7f2] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-neutral-900">Get alerts on this device</p>
          <p className="mt-1 text-[13px] leading-5 text-neutral-600">
            Receive report updates and emergency alerts even when E-Boses is closed.
          </p>
          <p className="mt-2 text-[12px] font-semibold text-neutral-700">
            Status: {browserState.subscribed ? "Notifications are on" : browserState.permission === "denied" ? "Blocked in browser settings" : !browserState.supported ? "Not supported on this device" : !browserState.serverConfigured ? "Temporarily unavailable" : "Notifications are off"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={browserBusy || !browserState.supported || browserState.permission === "denied" || !browserState.serverConfigured}
            onClick={onTogglePush}
            className="h-10 rounded-full bg-[#ff6a1a] px-4 text-[13px] font-bold text-white hover:bg-[#e85f17] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {browserBusy ? "Working…" : browserState.subscribed ? "Turn off notifications" : "Turn on notifications"}
          </button>
          {browserState.subscribed ? (
            <button
              type="button"
              disabled={testPushBusy}
              onClick={onSendTest}
              className="h-10 rounded-full border border-[#ff6a1a] bg-white px-4 text-[13px] font-bold text-[#ff6a1a] hover:bg-[#fff0e8] disabled:opacity-60"
            >
              {testPushBusy ? "Sending…" : "Send test"}
            </button>
          ) : null}
          {!installedStandalone && installPrompt ? (
            <button
              type="button"
              onClick={onInstallApp}
              className="h-10 rounded-full border border-neutral-300 bg-white px-4 text-[13px] font-bold text-neutral-800 hover:bg-neutral-50"
            >
              Install app
            </button>
          ) : null}
        </div>
      </div>
      {testPushResult ? (
        <p className="mt-3 rounded-xl border border-[#ffd8c2] bg-white px-3 py-2 text-[12px] font-semibold leading-5 text-neutral-700">
          {testPushResult}
        </p>
      ) : null}
    </div>
  )
}
