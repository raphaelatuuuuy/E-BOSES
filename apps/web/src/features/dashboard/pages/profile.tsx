import { usePageTitle } from "@/hooks/use-page-title"

export default function ProfilePage() {
  usePageTitle("Profile")

  return (
    <div className="p-6 md:p-10">
      <h1 className="text-2xl font-bold text-foreground">Profile</h1>
      <div className="mt-6 max-w-md space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-none border border-border bg-muted/50"
          />
        ))}
      </div>
    </div>
  )
}
