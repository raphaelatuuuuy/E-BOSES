import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"
import { GreetingCard } from "@/features/dashboard/components/greeting-card"

export default function HomePage() {
  usePageTitle("Home")

  return (
    <div className="flex min-h-svh flex-col">
      <Topbar />
      <GreetingCard />
      <div className="flex-1 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-none border border-border bg-muted/50"
            />
          ))}
        </div>
      </div>
    </div>
  )
}
