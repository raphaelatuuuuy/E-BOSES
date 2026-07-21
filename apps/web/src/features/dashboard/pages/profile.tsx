import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  BellIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  Loader2Icon,
  LockIcon,
  LogOutIcon,
  MapPinIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  SaveIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  getDashboardSummary,
  listMyConcerns,
  type Concern,
  type DashboardSummary,
} from "@/features/dashboard/api"
import { updateMe } from "@/features/auth/api"
import { concernBodyText } from "@/features/dashboard/components/feed-post-card"
import { ApiError } from "@/lib/api"

type ProfileFormState = {
  first_name: string
  middle_name: string
  last_name: string
  address: string
  gender: "male" | "female" | "prefer_not_to_say" | ""
}

type ProfileField = keyof ProfileFormState

function sanitizeName(value: string) {
  return value.replace(/[^A-Za-zÑñ ]/g, "")
}

function profileFormFromUser(user: ReturnType<typeof useAuthSession>["user"]): ProfileFormState {
  return {
    first_name: user?.firstName ?? "",
    middle_name: user?.middleName ?? "",
    last_name: user?.lastName ?? "",
    address: user?.address ?? "",
    gender: (user?.gender as ProfileFormState["gender"]) ?? "",
  }
}

function collectApiFieldErrors(error: unknown): Partial<Record<ProfileField, string>> {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== "object") return {}
  const errors: Partial<Record<ProfileField, string>> = {}
  for (const key of ["first_name", "middle_name", "last_name", "address", "gender"] as ProfileField[]) {
    const value = (error.data as Record<string, unknown>)[key]
    if (Array.isArray(value) && typeof value[0] === "string") errors[key] = value[0]
    else if (typeof value === "string") errors[key] = value
  }
  return errors
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs font-semibold text-red-600">{message}</p> : null
}

function timeAgo(value?: string | null) {
  if (!value) return ""
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function ProfileSkeleton() {
  return (
    <div className="flex-1 pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:pb-12">
      <Skeleton className="h-36 w-full rounded-none" />
      <div className="px-4 pt-12">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-32" />
        <Skeleton className="mt-4 h-10 w-28 rounded-full" />
        <Skeleton className="mt-8 h-28 w-full rounded-2xl" />
      </div>
    </div>
  )
}

export default function ProfilePage() {
  usePageTitle("Profile")
  const { user, loading, refreshUser, signOut } = useAuthSession()
  const navigate = useNavigate()

  const [loaded, setLoaded] = useState(false)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [posts, setPosts] = useState<Concern[]>([])
  const [profileForm, setProfileForm] = useState<ProfileFormState>(() => profileFormFromUser(null))
  const [profileErrors, setProfileErrors] = useState<Partial<Record<ProfileField, string>>>({})
  const [savingProfile, setSavingProfile] = useState(false)
  const [editing, setEditing] = useState(false)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)

  useEffect(() => {
    if (!user) return
    setProfileForm(profileFormFromUser(user))
  }, [user])

  useEffect(() => {
    if (loading) return
    let cancelled = false

    async function loadProfile() {
      setLoaded(false)
      try {
        const [nextSummary, myReports] = await Promise.all([
          getDashboardSummary().catch(() => null),
          listMyConcerns().catch(() => [] as Concern[]),
        ])
        if (!cancelled) {
          setSummary(nextSummary)
          setPosts(Array.isArray(myReports) ? myReports.slice(0, 8) : [])
        }
      } catch {
        if (!cancelled) toast.error("Could not load profile.")
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }

    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [loading])

  const fullName =
    user?.full_name ||
    `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() ||
    "Resident"
  // DB default is often "Pending" — always show the barangay area for this product.
  const rawBarangay = (user?.barangay || "").trim()
  const barangay =
    !rawBarangay || rawBarangay.toLowerCase() === "pending"
      ? "Marikina Heights"
      : rawBarangay
  const memberSince =
    user?.member_since ||
    (user?.date_joined
      ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(
          new Date(user.date_joined),
        )
      : "Recently")
  const letter = (
    user?.firstName?.[0] ||
    fullName[0] ||
    "?"
  ).toUpperCase()

  const joinedLine = `${fullName} joined ${barangay}.`

  function handleProfileChange(field: ProfileField, value: string) {
    setProfileForm((current) => ({ ...current, [field]: value }))
    setProfileErrors((current) => ({ ...current, [field]: undefined }))
  }

  async function handleProfileSubmit() {
    setSavingProfile(true)
    setProfileErrors({})
    try {
      await updateMe(profileForm)
      await refreshUser()
      setEditing(false)
      toast.success("Profile updated")
    } catch (error) {
      setProfileErrors(collectApiFieldErrors(error))
      toast.error(error instanceof ApiError ? error.message : "Could not update profile. Try again.")
    } finally {
      setSavingProfile(false)
    }
  }

  if (!loaded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <ProfileSkeleton />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:pb-12">
        {/* Cover + chrome */}
        <div className="relative">
          <div className="relative h-[132px] w-full overflow-hidden bg-[#9eb3c9] sm:h-[160px]">
            {/* Simple city skyline (Nextdoor-style cover, light) */}
            <svg
              className="absolute inset-0 h-full w-full opacity-90"
              viewBox="0 0 400 160"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden
            >
              <rect width="400" height="160" fill="#8fa6bf" />
              <path
                fill="#a8bdd1"
                d="M0 160 V95 H40 V70 H70 V95 H100 V55 H140 V95 H160 V75 H200 V50 H240 V95 H270 V65 H310 V95 H340 V80 H400 V160 Z"
              />
              <circle cx="320" cy="42" r="18" fill="#c5d4e4" opacity="0.7" />
            </svg>

            <button
              type="button"
              onClick={() => navigate(-1)}
              className="absolute left-3 top-3 z-10 flex size-10 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow-sm backdrop-blur-sm hover:bg-white"
              aria-label="Back"
            >
              <ChevronLeftIcon className="size-5" strokeWidth={2.25} />
            </button>
            <Popover open={settingsMenuOpen} onOpenChange={setSettingsMenuOpen}>
              <PopoverTrigger
                className="absolute right-3 top-3 z-10 flex size-10 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow-sm backdrop-blur-sm hover:bg-white"
                aria-label="Settings"
              >
                <SettingsIcon className="size-5" strokeWidth={1.75} />
              </PopoverTrigger>
              <PopoverContent
                className="w-[260px] overflow-hidden rounded-2xl border border-neutral-200 bg-white p-0 shadow-[0_12px_36px_rgba(15,23,42,0.16)]"
                side="bottom"
              >
                <div className="py-1.5">
                  {(
                    [
                      {
                        label: "Account settings",
                        path: "/dashboard/settings?panel=account",
                        icon: UserIcon,
                      },
                      {
                        label: "Notification settings",
                        path: "/dashboard/settings?panel=notifications",
                        icon: BellIcon,
                      },
                      {
                        label: "Privacy settings",
                        path: "/dashboard/settings?panel=privacy",
                        icon: LockIcon,
                      },
                    ] as const
                  ).map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => {
                          setSettingsMenuOpen(false)
                          navigate(item.path)
                        }}
                        className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-800 transition-colors hover:bg-neutral-50"
                      >
                        <Icon className="size-5 shrink-0 text-neutral-700" strokeWidth={1.75} />
                        {item.label}
                      </button>
                    )
                  })}
                </div>
                <div className="border-t border-neutral-200 py-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsMenuOpen(false)
                      void signOut().finally(() => navigate("/sign-in"))
                    }}
                    className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-800 transition-colors hover:bg-neutral-50"
                  >
                    <LogOutIcon className="size-5 shrink-0 text-neutral-700" strokeWidth={1.75} />
                    Sign out
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Letter avatar only (no portrait images) */}
          <div className="relative z-10 -mt-12 px-4 sm:-mt-14 sm:px-6">
            <span
              className="flex size-[88px] items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] text-3xl font-bold text-[#2c3a5a] ring-[3px] ring-white sm:size-24 sm:text-4xl"
              aria-hidden
            >
              {letter}
            </span>
          </div>
        </div>

        {/* Identity */}
        <div className="px-4 pt-3 sm:px-6">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight text-neutral-900 sm:text-2xl">
            {fullName}
          </h1>
          <p className="mt-1.5 flex items-center gap-1 text-[14px] text-neutral-600">
            <MapPinIcon className="size-4 shrink-0 text-neutral-500" strokeWidth={2} />
            <span>{barangay}</span>
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="inline-flex h-9 items-center justify-center rounded-full bg-neutral-900 px-4 text-[14px] font-semibold text-white transition-colors hover:bg-neutral-800"
            >
              {editing ? "Close" : "Edit profile"}
            </button>
          </div>

          {editing ? (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold text-neutral-700">First name</span>
                  <input
                    value={profileForm.first_name}
                    onChange={(e) =>
                      handleProfileChange("first_name", sanitizeName(e.target.value))
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-400"
                  />
                  <FieldError message={profileErrors.first_name} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-neutral-700">Last name</span>
                  <input
                    value={profileForm.last_name}
                    onChange={(e) =>
                      handleProfileChange("last_name", sanitizeName(e.target.value))
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-400"
                  />
                  <FieldError message={profileErrors.last_name} />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-neutral-700">Address</span>
                  <textarea
                    value={profileForm.address}
                    onChange={(e) => handleProfileChange("address", e.target.value)}
                    className="mt-1 min-h-20 w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-400"
                  />
                  <FieldError message={profileErrors.address} />
                </label>
              </div>
              <button
                type="button"
                onClick={() => void handleProfileSubmit()}
                disabled={savingProfile}
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-[#ff6a1a] px-4 text-sm font-semibold text-white hover:bg-[#e85f17] disabled:opacity-60"
              >
                {savingProfile ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <SaveIcon className="size-4" />
                )}
                Save changes
              </button>
            </div>
          ) : null}
        </div>

        {/* Dashboard — only visible to you */}
        <section className="mt-6 px-4 sm:px-6">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-bold text-neutral-900">Dashboard</h2>
            <span className="text-[12px] text-neutral-500">Only visible to you</span>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-[14px] font-semibold text-neutral-900">Your reports at a glance</p>
            <p className="mt-0.5 text-[12px] text-neutral-500">Member since {memberSince}</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { label: "Submitted", value: summary?.reports_submitted ?? posts.length },
                { label: "Resolved", value: summary?.reports_resolved ?? 0 },
                { label: "Active", value: summary?.reports_active ?? 0 },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl bg-neutral-50 px-2 py-3 text-center"
                >
                  <p className="text-[20px] font-bold tabular-nums text-neutral-900">
                    {stat.value}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-neutral-500">{stat.label}</p>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => navigate("/dashboard/reports")}
              className="mt-3 text-[13px] font-semibold text-[#2447b3] hover:underline"
            >
              View reports →
            </button>
          </div>
        </section>

        {/* Posts */}
        <section className="mt-7 px-4 pb-6 sm:px-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[17px] font-bold text-neutral-900">Posts</h2>
            <button
              type="button"
              onClick={() => navigate("/dashboard/reports")}
              className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-neutral-800 hover:bg-neutral-50"
            >
              See activity
            </button>
          </div>

          {/* Joined card — Nextdoor-style intro post */}
          <article className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="flex items-start gap-2.5">
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] text-[15px] font-bold text-[#2c3a5a]">
                {letter}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold text-neutral-900">{fullName}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[13px] text-neutral-500">
                      <span>{barangay}</span>
                      <span aria-hidden>·</span>
                      <span>{memberSince}</span>
                      <GlobeIcon className="size-3.5" strokeWidth={1.75} />
                    </p>
                  </div>
                  <button
                    type="button"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                    aria-label="More"
                  >
                    <MoreHorizontalIcon className="size-5" />
                  </button>
                </div>
                <p className="mt-2 text-[15px] leading-snug text-neutral-800">{joinedLine}</p>

                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="mt-3 flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-left transition-colors hover:bg-neutral-100"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-neutral-600 ring-1 ring-neutral-200">
                    <MessageCircleIcon className="size-5" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-neutral-900">
                      Add an intro
                    </span>
                    <span className="mt-0.5 block text-[12px] text-neutral-500">
                      Say hello and introduce yourself
                    </span>
                  </span>
                  <ChevronRightIcon className="size-5 shrink-0 text-neutral-400" />
                </button>
              </div>
            </div>
          </article>

          {posts.map((post) => (
            <article
              key={post.id}
              className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4"
            >
              <div className="flex items-start gap-2.5">
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] text-[15px] font-bold text-[#2c3a5a]">
                  {letter}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-bold text-neutral-900">{fullName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[13px] text-neutral-500">
                        <span>{barangay}</span>
                        <span aria-hidden>·</span>
                        <span>{timeAgo(post.created_at)}</span>
                        <GlobeIcon className="size-3.5" strokeWidth={1.75} />
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`/dashboard/reports/${post.public_id || post.id}`)}
                    className="mt-2 w-full text-left"
                  >
                    <p className="line-clamp-4 text-[15px] font-medium leading-relaxed text-neutral-900">
                      {concernBodyText(post)}
                    </p>
                  </button>
                </div>
              </div>
            </article>
          ))}

          {posts.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-neutral-500">
              No community posts yet. Reports you share to the feed will show here.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  )
}
