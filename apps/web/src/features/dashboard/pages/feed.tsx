import { usePageTitle } from "@/hooks/use-page-title"

export default function FeedPage() {
  usePageTitle("Feed")

  return (
    <div className="p-6 md:p-10">
      <h1 className="text-2xl font-bold text-foreground">Feed</h1>
      <div className="mt-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-none border border-border bg-muted/50"
          />
        ))}
      </div>
    </div>
  )
}
