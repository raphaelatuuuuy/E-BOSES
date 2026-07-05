import { useEffect, useState, type ElementType } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  BellIcon,
  CameraIcon,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@workspace/ui/components/accordion"
import { Switch } from "@workspace/ui/components/switch"
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

function AccordionSection({
  title,
  description,
  items,
  type = "single",
}: {
  title: string
  description: string
  items: Array<{
    label: string
    desc: string
    icon: ElementType
  }>
  type?: "single" | "multiple"
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="px-4 sm:px-5 md:px-6">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-sm leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-3 sm:px-5 md:px-6">
        <Accordion type={type}>
          {items.map((item) => {
            const Icon = item.icon
            const isNotification = item.label === "Notifications"
            return (
              <AccordionItem key={item.label} value={item.label}>
                <AccordionTrigger className="gap-3 px-4 py-3 text-left hover:no-underline">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 text-left">
                      <p className="text-sm font-medium leading-snug text-foreground">
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-3">
                  {isNotification ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">Push alerts</p>
                          <p className="text-xs text-muted-foreground">Emergency alerts and official barangay announcements.</p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">Report updates</p>
                          <p className="text-xs text-muted-foreground">Status changes and new comments on your reports.</p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {item.label === "Personal Information"
                        ? "View and edit your name, email, phone number, and address."
                        : `${item.label} settings and details will be available in an upcoming update.`}
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
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

  // Compute default avatar from gender + age as fallback
  const avatarKey = user?.avatar || (user?.gender && user?.gender !== "prefer_not_to_say" && user?.date_of_birth
    ? (() => {
        const age = new Date().getFullYear() - new Date(user.date_of_birth!).getFullYear()
        const bucket = age >= 55 ? "senior" : age >= 30 ? "middleaged" : "young"
        const icon = user.gender === "male" ? "man" : "woman"
        return `${bucket}-${icon}`
      })()
    : "")

  if (!loaded)
    return (
      <div className="flex flex-col">
        <Topbar />
        <ProfileSkeleton />
      </div>
    )

  return (
    <div className="flex flex-col">
      <Topbar />

      <div className="flex-1 overflow-x-hidden p-4 sm:p-6 md:p-10">
        {/* Cover image */}
        <div className="mb-2 flex h-40 w-full items-center justify-center rounded-2xl md:h-48">
          <img src="/contents/profile-header.png" alt="" className="h-full w-full object-contain" />
        </div>
        <div className="mb-6 text-center">
          <p className="text-xs text-muted-foreground">Account Information</p>
          <h2 className="font-heading text-2xl font-bold text-foreground md:text-3xl">My Account</h2>
        </div>
          {/* ── Content grid ── */}
          <div className="grid gap-4 pb-10 sm:gap-6 lg:grid-cols-5">
            {/* Left column */}
            <section className="flex min-w-0 flex-col gap-4 sm:gap-6 lg:col-span-3">
              <Card className="overflow-hidden">
                {/* Avatar + details above Account header — left aligned */}
                <div className="flex items-center gap-4 px-4 md:gap-6 md:px-6">
                  <div className="relative size-16 shrink-0 md:size-20">
                    <div className="overflow-hidden rounded-full ring-4 ring-background">
                      {avatarKey ? (
                        <img src={`/contents/${avatarKey}.png`} alt="" className="h-full w-full scale-125 object-cover" />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground md:h-20 md:w-20 md:text-2xl">
                          {initials}
                        </div>
                      )}
                    </div>
                    {/* Hover overlay + popover trigger */}
                    <Popover>
                      <PopoverTrigger className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/0 transition-colors group-hover:bg-black/40" aria-label="Change avatar">
                        <CameraIcon className="size-5 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-4">
                        <p className="mb-3 text-sm font-medium text-foreground">Choose an avatar</p>
                        <div className="grid grid-cols-3 gap-3">
                          {["young-man", "young-woman", "middleaged-man", "middleaged-woman", "senior-man", "senior-woman"].map((key) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => {
                                toast("Avatar updated (sync pending)", { description: "Avatar change will be saved once the backend endpoint is connected." })
                              }}
                              className={`size-20 overflow-hidden rounded-full border-2 transition-all ${
                                avatarKey === key ? "border-primary shadow-[0_0_0_3px_rgba(255,129,51,0.3)]" : "border-border hover:border-primary/50"
                              }`}
                            >
                              <img src={`/contents/${key}.png`} alt="" className="h-full w-full scale-125 object-cover" />
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex flex-col items-start gap-1 text-left">
                    <h1 className="break-words text-lg font-bold leading-tight text-foreground md:text-xl">{fullName}</h1>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-medium text-primary">{user?.role?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) ?? "Resident"}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <VerifiedIcon className="size-3 text-primary" /> Verified
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">{summary?.reports_submitted ?? 0} submitted</span>
                      <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">{summary?.reports_resolved ?? 0} resolved</span>
                      <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">{summary?.reports_active ?? 0} active</span>
                    </div>
                  </div>
                </div>
                <CardHeader className="px-4 sm:px-5 md:px-6">
                  <CardTitle className="text-base">Account</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">Manage your personal profile and alert preferences.</CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-3 sm:px-5 md:px-6">
                  <Accordion type="multiple" defaultValue={["Personal Information"]}>
                    {accountItems.map((item) => {
                      const Icon = item.icon
                      const isNotification = item.label === "Notifications"
                      return (
                        <AccordionItem key={item.label} value={item.label}>
                          <AccordionTrigger className="gap-3 px-4 py-3 text-left hover:no-underline">
                            <div className="flex items-center gap-3">
                              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                <Icon className="size-4" />
                              </div>
                              <div className="min-w-0 text-left">
                                <p className="text-sm font-medium leading-snug text-foreground">{item.label}</p>
                                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="px-4 pb-4 pt-3">
                            {isNotification ? (
                              <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-foreground">Push alerts</p>
                                    <p className="text-xs text-muted-foreground">Emergency alerts and official barangay announcements.</p>
                                  </div>
                                  <Switch defaultChecked />
                                </div>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-foreground">Report updates</p>
                                    <p className="text-xs text-muted-foreground">Status changes and new comments on your reports.</p>
                                  </div>
                                  <Switch defaultChecked />
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">View and edit your name, email, phone number, and address.</p>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      )
                    })}
                  </Accordion>
                </CardContent>
              </Card>

              <AccordionSection
                title="Barangay"
                description="Find public information and local contacts."
                items={barangayItems}
              />
            </section>

            {/* Right column */}
            <aside className="flex min-w-0 flex-col gap-4 sm:gap-6 lg:col-span-2">
              <AccordionSection
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
  )
}
