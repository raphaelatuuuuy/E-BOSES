import {
  ToggleRow,
  type SettingKey,
} from "@/features/dashboard/components/settings/settings-primitives"
import type { ResidentSettings } from "@/features/auth/api"

export function PrivacyPanel({
  settings,
  savingSetting,
  onSettingChange,
}: {
  settings: ResidentSettings | null
  savingSetting: SettingKey | null
  onSettingChange: (key: SettingKey, value: boolean) => void
}) {
  return (
    <div className="mt-4 border-t border-neutral-200">
      <ToggleRow
        id="community_sharing"
        label="Share eligible reports to the feed"
        description="Reports still hide private contact and location details."
        checked={settings?.community_sharing ?? false}
        disabled={!settings}
        busy={savingSetting === "community_sharing"}
        onChange={(value) => onSettingChange("community_sharing", value)}
      />
      <ToggleRow
        id="location_confirmation"
        label="Ask before using precise location"
        description="Confirm location access before submitting a report or SOS."
        checked={settings?.location_confirmation ?? false}
        disabled={!settings}
        busy={savingSetting === "location_confirmation"}
        onChange={(value) => onSettingChange("location_confirmation", value)}
      />
    </div>
  )
}
