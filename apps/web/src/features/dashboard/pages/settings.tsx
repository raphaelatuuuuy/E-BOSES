import { usePageTitle } from "@/hooks/use-page-title"

export default function SettingsPage() {
  usePageTitle("Settings")

  return (
    <div className="p-6 md:p-10">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      <div className="mt-6 max-w-lg space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-none border border-border bg-muted/50"
          />
        ))}
      </div>
    </div>
  )
}
