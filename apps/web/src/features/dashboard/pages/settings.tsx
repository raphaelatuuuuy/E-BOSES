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

import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"

const settingsGroups = [
  {
    title: "Notifications",
    description: "Choose which updates should reach you immediately.",
    items: [
      {
        id: "push-alerts",
        label: "Push alerts",
        description: "Emergency alerts and official barangay announcements.",
        defaultChecked: true,
      },
      {
        id: "report-updates",
        label: "Report updates",
        description: "Status changes and new comments on your reports.",
        defaultChecked: true,
      },
    ],
  },
  {
    title: "Privacy",
    description: "Control how your reports appear to the community.",
    items: [
      {
        id: "community-sharing",
        label: "Share eligible reports to the feed",
        description: "Reports still hide private contact and location details.",
        defaultChecked: false,
      },
      {
        id: "location-confirmation",
        label: "Ask before using precise location",
        description: "Confirm location access before submitting a report or SOS.",
        defaultChecked: true,
      },
    ],
  },
]

export default function SettingsPage() {
  usePageTitle("Settings")

  return (
    <div className="flex min-h-svh flex-col">
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
                        defaultChecked={item.defaultChecked}
                        aria-label={item.label}
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
