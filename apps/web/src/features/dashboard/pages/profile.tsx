import { useEffect, useState, type ElementType } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  BellIcon,
  ChevronRightIcon,
  FileTextIcon,
  HelpCircleIcon,
  LogOutIcon,
  MegaphoneIcon,
  PhoneIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
  VerifiedIcon,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"
import { useAuthSession } from "@/features/auth/auth-session"
import { getDashboardSummary, type DashboardSummary } from "@/features/dashboard/api"

const accountItems = [
  {
    label: "Personal Information",
    desc: "Name, email, phone, address",
    icon: UserIcon,
  },
  {
    label: "Notifications",
    desc: "Push alerts, email preferences",
    icon: BellIcon,
  },
]

const barangayItems = [
  {
    label: "Announcements",
    desc: "Latest news from your barangay",
    icon: MegaphoneIcon,
  },
  {
    label: "Hotlines & Contacts",
    desc: "Emergency and local hotlines",
    icon: PhoneIcon,
  },
  {
    label: "Officials Directory",
    desc: "Barangay officials and contacts",
    icon: UsersIcon,
  },
]

const legalItems = [
  {
    label: "Terms of Conditions",
    desc: "Rules and guidelines for using E-Boses",
    icon: FileTextIcon,
  },
  {
    label: "Data Privacy Notice",
    desc: "How we collect, use, and protect your data",
    icon: ShieldCheckIcon,
  },
  {
    label: "Community Guidelines",
    desc: "Standards for respectful community engagement",
    icon: HelpCircleIcon,
  },
]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ProfileSectionProps {
  title: string
  description: string
  items: Array<{
    label: string
    desc: string
    icon: ElementType
  }>
}

function ProfileSection({ title, description, items }: ProfileSectionProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="px-4 sm:px-5 md:px-6">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-sm leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 sm:px-5 md:px-6">
        {items.map((item) => {
          const Icon = item.icon

          return (
            <button
              key={item.label}
              type="button"
              onClick={() =>
                toast("Coming soon", {
                  description: `${item.label} will be available in an upcoming update.`,
                })
              }
              className="flex min-h-16 w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.10)] sm:items-center sm:p-4"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium leading-snug text-foreground">
                  {item.label}
                </p>
                <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
                  {item.desc}
                </p>
              </div>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/40" />
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}

function ProfileSkeleton() {
  return (
    <div className="flex-1 p-4 sm:p-6 md:p-10">
      {/* Cover skeleton (full bleed via negative margins) */}
      <Skeleton className="-mx-4 h-32 w-[calc(100%+2rem)] rounded-none sm:-mx-6 sm:w-[calc(100%+3rem)] md:-mx-10 md:h-40 md:w-[calc(100%+5rem)]" />
      {/* Avatar + info skeleton */}
      <div className="-mt-12 flex flex-col items-center gap-3 pb-6 text-center sm:flex-row sm:items-end sm:gap-4 sm:text-left md:-mt-16 md:gap-5">
        <Skeleton className="size-20 shrink-0 rounded-full md:size-24" />
        <div className="flex-1 space-y-2 pb-1 md:pb-2">
          <Skeleton className="mx-auto h-6 w-48 sm:mx-0 md:h-7" />
          <Skeleton className="mx-auto h-4 w-32 sm:mx-0" />
          <Skeleton className="mx-auto h-3.5 w-52 max-w-full sm:mx-0" />
        </div>
      </div>

      {/* Grid skeleton */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-4 sm:gap-6 lg:col-span-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
        <div className="flex flex-col gap-4 sm:gap-6 lg:col-span-2">
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProfilePage() {
  usePageTitle("Profile")
  const { user, loading, signOut } = useAuthSession()
  const navigate = useNavigate()

  const [loaded, setLoaded] = useState(false)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    if (loading) return
    let cancelled = false

    async function loadProfile() {
      setLoaded(false)
      setLoadError("")
      try {
        const nextSummary = await getDashboardSummary()
        if (!cancelled) setSummary(nextSummary)
      } catch {
        if (!cancelled) setLoadError("Could not load report summary.")
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }

    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [loading])

  const fullName = user?.full_name || `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "Resident"
  const initials = fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?"
  const barangay = user?.barangay || "Marikina Heights"
  const memberSince = user?.member_since || (user?.date_joined
    ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(user.date_joined))
    : "Recently")

  if (!loaded)
    return (
      <div className="flex min-h-svh flex-col">
        <Topbar />
        <ProfileSkeleton />
      </div>
    )

  return (
    <div className="flex min-h-svh flex-col">
      <Topbar />

      <div className="flex-1 overflow-x-hidden p-4 sm:p-6 md:p-10">
        {/* ── Cover (full bleed via negative margins) ── */}
        <div className="-mx-4 h-32 w-[calc(100%+2rem)] bg-gradient-to-r from-muted/80 via-muted/60 to-muted/80 sm:-mx-6 sm:w-[calc(100%+3rem)] md:-mx-10 md:h-40 md:w-[calc(100%+5rem)]" />

        {/* ── Profile content ── */}
        <div>
          <div className="-mt-12 flex flex-col items-center gap-3 pb-6 text-center sm:flex-row sm:items-end sm:gap-4 sm:text-left md:-mt-16 md:gap-5">
            {/* Avatar */}
            <div className="flex size-20 shrink-0 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground ring-4 ring-background md:size-24 md:text-3xl">
              {initials}
            </div>

              {/* Name + role + meta */}
              <div className="min-w-0 max-w-full pb-1 md:pb-2">
                <h1 className="break-words text-xl font-bold leading-tight text-foreground md:text-2xl">
                  {fullName}
              </h1>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start">
                <span className="text-xs font-medium text-primary">
                  {user?.role?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) ?? "Resident"}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <VerifiedIcon className="size-3 text-primary" />
                  Verified
                </span>
              </div>
              <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                {barangay} &middot; Member since {memberSince}
              </p>
              {loadError ? (
                <p className="mt-1 text-xs text-destructive">{loadError}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs sm:justify-start">
                <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                  {summary?.reports_submitted ?? 0} submitted
                </span>
                <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                  {summary?.reports_resolved ?? 0} resolved
                </span>
                <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                  {summary?.reports_active ?? 0} active
                </span>
              </div>
            </div>
          </div>

          {/* ── Content grid ── */}
          <div className="grid gap-4 pb-10 sm:gap-6 lg:grid-cols-5">
            {/* Left column */}
            <section className="flex min-w-0 flex-col gap-4 sm:gap-6 lg:col-span-3">
              <ProfileSection
                title="Account"
                description="Manage your personal profile and alert preferences."
                items={accountItems}
              />

              <ProfileSection
                title="Barangay"
                description="Find public information and local contacts."
                items={barangayItems}
              />
            </section>

            {/* Right column */}
            <aside className="flex min-w-0 flex-col gap-4 sm:gap-6 lg:col-span-2">
              <ProfileSection
                title="Legal"
                description="Review policies that apply to your account."
                items={legalItems}
              />

              {/* Account actions */}
              <Card>
                <CardHeader className="px-4 sm:px-5 md:px-6">
                  <CardTitle className="text-base">Account actions</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    Sign out or request account deletion.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 px-4 sm:px-5 md:px-6">
                  <button
                    type="button"
                    onClick={() => {
                      signOut()
                      navigate("/")
                    }}
                    className="flex min-h-14 w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-muted/50 sm:items-center"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <LogOutIcon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium leading-snug text-foreground">
                        Sign Out
                      </p>
                      <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
                        End your current session
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      toast.error("Account deletion", {
                        description:
                          "Please contact your barangay administrator to delete your account.",
                      })
                    }
                    className="flex min-h-14 w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-destructive/5 sm:items-center"
                    aria-label="Delete account - requires administrator approval"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                      <Trash2Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium leading-snug text-destructive">
                        Delete Account
                      </p>
                      <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
                        Request permanent deletion
                      </p>
                    </div>
                  </button>
                </CardContent>
              </Card>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
