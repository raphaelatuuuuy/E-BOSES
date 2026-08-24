import type { SettingKey } from "@/features/dashboard/components/settings/settings-primitives"
import type { ResidentSettings } from "@/features/auth/api"
import { SheetList, SheetToggleRow } from "@/features/dashboard/components/sheet-dialog"
import { DataExportRow } from "@/features/dashboard/components/settings/data-export-row"

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
    <SheetList>
      <SheetToggleRow
        id="community_sharing"
        label="Share reports to the feed"
        description="Contact details and exact location stay private."
        checked={settings?.community_sharing ?? false}
        disabled={!settings}
        busy={savingSetting === "community_sharing"}
        onChange={(value) => onSettingChange("community_sharing", value)}
      />
      <SheetToggleRow
        id="location_sharing_enabled"
        label="Share recent location for SMS help"
        description="Uses a location saved in the last 15 minutes. Turning this off deletes it."
        checked={settings?.location_sharing_enabled ?? false}
        disabled={!settings}
        busy={savingSetting === "location_sharing_enabled"}
        onChange={(value) => onSettingChange("location_sharing_enabled", value)}
      />
      <SheetToggleRow
        id="location_confirmation"
        label="Confirm precise location"
        description="Ask before using GPS on a report or SOS."
        checked={settings?.location_confirmation ?? false}
        disabled={!settings}
        busy={savingSetting === "location_confirmation"}
        onChange={(value) => onSettingChange("location_confirmation", value)}
      />
      <DataExportRow />
    </SheetList>
  )
}
