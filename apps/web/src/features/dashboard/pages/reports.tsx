import { usePageTitle } from "@/hooks/use-page-title"

export default function ReportsPage() {
  usePageTitle("Reports")

  return (
    <div className="p-6 md:p-10">
      <h1 className="text-2xl font-bold text-foreground">Reports</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-none border border-border bg-muted/50"
          />
        ))}
      </div>
    </div>
  )
}
