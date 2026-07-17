import { useEffect, useMemo, useState, type ElementType } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  BellIcon,
  CalendarDaysIcon,
  CameraIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  HomeIcon,
  LifeBuoyIcon,
  Loader2Icon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  SaveIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SirenIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"
import { useAuthSession } from "@/features/auth/auth-session"
import { getDashboardSummary, type DashboardSummary } from "@/features/dashboard/api"
import { updateMe } from "@/features/auth/api"
import { ApiError } from "@/lib/api"

type ProfileFormState = {
  first_name: string
  middle_name: string
  last_name: string
  address: string
  gender: "male" | "female" | "prefer_not_to_say" | ""
}

type ProfileField = keyof ProfileFormState

import { computeDefaultAvatar, getAvatarChoices } from "@/features/dashboard/avatar-utils"

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

function formatDateTime(value?: string | null) {
  if (!value) return "Not available"
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function roleLabel(role?: string) {
  return (role || "resident").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs font-semibold text-red-600">{message}</p> : null
}

function ProfileSkeleton() {
  return (
    <div className="flex-1 p-4 sm:p-6 md:p-8">
      <Skeleton className="h-56 rounded-2xl" />
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_260px]">
        <div className="grid gap-5 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-56 rounded-2xl" />)}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  )
}

function SectionCard({
  title,
  desc,
  children,
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-[#dfe7f5] bg-white p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-[#07145f]">{title}</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-[#43507f]">{desc}</p>
        </div>
        <ChevronRightIcon className="mt-1 size-5 shrink-0 text-[#07145f]" />
      </div>
      {children}
    </section>
  )
}

function InfoItem({
  icon: Icon,
  label,
  value,
  danger,
}: {
  icon: ElementType
  label: string
  value: string
  danger?: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", danger ? "bg-red-50 text-red-600" : "bg-[#eef3ff] text-[#2447b3]")}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-extrabold", danger ? "text-red-600" : "text-[#07145f]")}>{label}</p>
        <p className="mt-0.5 break-words text-xs font-semibold leading-5 text-[#43507f]">{value || "Not provided"}</p>
      </div>
      <ChevronRightIcon className={cn("mt-2 size-4 shrink-0", danger ? "text-red-500" : "text-[#2447b3]")} />
    </div>
  )
}

function TextInput({
  label,
  value,
  error,
  onChange,
}: {
  label: string
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-[#07145f]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-lg border border-[#dfe7f5] px-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a] focus:ring-2 focus:ring-[#ff6a1a]/15"
      />
      <FieldError message={error} />
    </label>
  )
}

export default function ProfilePage() {
  usePageTitle("Profile")
  const { user, loading, refreshUser } = useAuthSession()
  const navigate = useNavigate()

  const [loaded, setLoaded] = useState(false)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [profileForm, setProfileForm] = useState<ProfileFormState>(() => profileFormFromUser(null))
  const [profileErrors, setProfileErrors] = useState<Partial<Record<ProfileField, string>>>({})
  const [savingProfile, setSavingProfile] = useState(false)
  const [editing, setEditing] = useState(false)

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
        const nextSummary = await getDashboardSummary()
        if (!cancelled) {
          setSummary(nextSummary)
        }
      } catch {
        if (!cancelled) toast.error("Could not load profile details.")
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
  const barangay = user?.barangay || "Marikina Heights"
  const memberSince = user?.member_since || (user?.date_joined ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(user.date_joined)) : "Recently")
  const avatarKey = user ? computeDefaultAvatar(user) : ""
  const avatarChoices = user ? getAvatarChoices(user.role, user.responder_unit) : []
  const initials = fullName.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?"

  const accountStatus = user?.status === "verified" ? "Active" : roleLabel(user?.status)
  const personalRows = useMemo(() => [
    { icon: UserIcon, label: "Full Name", value: fullName },
    { icon: MailIcon, label: "Email Address", value: user?.email ?? "" },
    { icon: PhoneIcon, label: "Phone Number", value: user?.phone_number ?? "" },
    { icon: HomeIcon, label: "Home Address", value: user?.address ?? "" },
    { icon: UsersIcon, label: "Emergency Contact", value: "Barangay hotline / 911 for life-threatening emergencies" },
  ], [fullName, user])

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

  async function handleAvatarChange(avatar: string) {
    try {
      await updateMe({ avatar })
      await refreshUser()
      toast.success("Avatar updated")
    } catch {
      toast.error("Could not update avatar. Try again.")
    }
  }

  if (!loaded) {
    return (
      <div className="flex flex-col">
        <Topbar />
        <ProfileSkeleton />
      </div>
    )
  }

  return (
    <div className="flex flex-col bg-[#f7f8fc]">
      <Topbar />

      <div className="flex-1 p-4 sm:p-6 md:p-8">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_270px]">
          <main className="min-w-0 space-y-5">
            <section className="overflow-hidden rounded-lg border border-[#dfe7f5] bg-white p-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_360px] lg:items-center">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <Popover>
                    <PopoverTrigger className="group relative size-28 shrink-0 overflow-hidden rounded-full bg-[#eef3ff] ring-4 ring-[#f8fbff]" aria-label="Change avatar">
                      {avatarKey ? (
                        <img src={`/contents/${avatarKey}.png`} alt="" className="h-full w-full scale-125 object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-2xl font-extrabold text-[#07145f]">{initials}</span>
                      )}
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/35">
                        <CameraIcon className="size-5 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                      </span>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-4">
                      <p className="mb-3 text-sm font-bold text-[#07145f]">Choose an avatar</p>
                      <div className="grid grid-cols-3 gap-3">
                        {avatarChoices.map((key) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => void handleAvatarChange(key)}
                            className={cn("size-20 overflow-hidden rounded-full border-2 transition-colors", avatarKey === key ? "border-[#ff6a1a]" : "border-[#dfe7f5] hover:border-[#ff6a1a]")}
                            aria-label={`Choose ${key.replace(/-/g, " ")} avatar`}
                          >
                            <img src={`/contents/${key}.png`} alt="" className="h-full w-full scale-125 object-cover" />
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <div className="min-w-0 flex-1">
                    <h1 className="text-2xl font-extrabold text-[#07145f] md:text-3xl">{fullName}</h1>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-[#43507f]">
                      <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2Icon className="size-3.5" /> Verified Resident</span>
                      <span>Member since {memberSince}</span>
                      <span className="inline-flex items-center gap-1"><MapPinIcon className="size-3.5" /> {barangay}, Marikina City</span>
                      <span className="inline-flex items-center gap-1"><MailIcon className="size-3.5" /> {user?.email}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing((current) => !current)}
                      className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg border border-[#cbd8ee] px-4 text-sm font-extrabold text-[#07145f] transition-colors hover:border-[#ff6a1a] hover:text-[#ff6a1a]"
                    >
                      <PencilIcon className="size-4" />
                      {editing ? "Close Editor" : "Edit Profile"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-[#dfe7f5] pt-4 sm:gap-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                  {[
                    { icon: ClipboardListIcon, value: summary?.reports_submitted ?? 0, label: "Reports Submitted" },
                    { icon: CheckCircle2Icon, value: summary?.reports_resolved ?? 0, label: "Reports Resolved" },
                    { icon: BellIcon, value: summary?.reports_active ?? 0, label: "Active Alerts" },
                  ].map((item) => {
                    const Icon = item.icon
                    return (
                      <div key={item.label} className="text-center">
                        <Icon className="mx-auto size-6 text-[#07145f]" />
                        <p className="mt-2 text-lg font-extrabold text-[#07145f]">{item.value}</p>
                        <p className="text-[11px] font-semibold leading-4 text-[#43507f]">{item.label}</p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {editing ? (
                <div className="mt-5 rounded-lg border border-[#dfe7f5] bg-[#f8fbff] p-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <TextInput label="First name" value={profileForm.first_name} error={profileErrors.first_name} onChange={(value) => handleProfileChange("first_name", sanitizeName(value))} />
                    <TextInput label="Middle name" value={profileForm.middle_name} error={profileErrors.middle_name} onChange={(value) => handleProfileChange("middle_name", sanitizeName(value))} />
                    <TextInput label="Last name" value={profileForm.last_name} error={profileErrors.last_name} onChange={(value) => handleProfileChange("last_name", sanitizeName(value))} />
                    <label className="block md:col-span-2">
                      <span className="text-xs font-bold text-[#07145f]">Address</span>
                      <textarea
                        value={profileForm.address}
                        onChange={(event) => handleProfileChange("address", event.target.value)}
                        className="mt-1 min-h-20 w-full resize-none rounded-lg border border-[#dfe7f5] px-3 py-2 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a] focus:ring-2 focus:ring-[#ff6a1a]/15"
                      />
                      <FieldError message={profileErrors.address} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-[#07145f]">Gender</span>
                      <select
                        value={profileForm.gender}
                        onChange={(event) => handleProfileChange("gender", event.target.value)}
                        className="mt-1 h-10 w-full rounded-lg border border-[#dfe7f5] px-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a] focus:ring-2 focus:ring-[#ff6a1a]/15"
                      >
                        <option value="">Not specified</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="prefer_not_to_say">Prefer not to say</option>
                      </select>
                      <FieldError message={profileErrors.gender} />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleProfileSubmit()}
                    disabled={savingProfile}
                    className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-[#ff6a1a] px-4 text-sm font-extrabold text-white transition-colors hover:bg-[#e85f17] disabled:opacity-60"
                  >
                    {savingProfile ? <Loader2Icon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
                    Save changes
                  </button>
                </div>
              ) : null}
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <SectionCard title="Personal Information" desc="Manage your personal profile and contact details.">
                <div className="space-y-4">
                  {personalRows.map((row) => <InfoItem key={row.label} {...row} />)}
                </div>
              </SectionCard>

              <SectionCard title="About Your Account" desc="Important details about your verified account.">
                <div className="space-y-4">
                  <InfoItem icon={ShieldCheckIcon} label="Account Type" value={roleLabel(user?.role)} />
                  <InfoItem icon={CheckCircle2Icon} label="Account Status" value={accountStatus} />
                  <InfoItem icon={CalendarDaysIcon} label="Last Active" value={formatDateTime(user?.last_seen_at)} />
                  <InfoItem icon={CalendarDaysIcon} label="Member Since" value={memberSince} />
                </div>
              </SectionCard>

              <SectionCard title="Account & Preferences" desc="Notification, privacy, emergency shortcut, and account controls.">
                <button
                  type="button"
                  onClick={() => navigate("/dashboard/settings")}
                  className="flex min-h-11 w-full items-center justify-between rounded-lg border border-[#cbd8ee] px-4 text-left text-sm font-extrabold text-[#07145f] transition-colors hover:border-[#ff6a1a] hover:text-[#ff6a1a]"
                >
                  <span className="flex items-center gap-3"><SettingsIcon className="size-4" /> Open settings</span>
                  <ChevronRightIcon className="size-4" />
                </button>
              </SectionCard>

              <SectionCard title="Resident Activity" desc="Continue with your reports and community updates.">
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { icon: ClipboardListIcon, label: "My Reports", path: "/dashboard/reports" },
                    { icon: UsersIcon, label: "Community", path: "/dashboard/feed" },
                    { icon: SirenIcon, label: "Emergency History", path: "/dashboard/emergency-history" },
                    { icon: BellIcon, label: "Notifications", path: "/dashboard/notifications" },
                  ].map((link) => {
                    const Icon = link.icon
                    return (
                      <button
                        key={link.label}
                        type="button"
                        onClick={() => navigate(link.path)}
                        className="flex min-h-11 items-center gap-2 rounded-lg border border-[#dfe7f5] px-3 text-left text-sm font-bold text-[#2447b3] transition-colors hover:border-[#ff6a1a] hover:text-[#ff6a1a]"
                      >
                        <Icon className="size-4" /> {link.label}
                      </button>
                    )
                  })}
                </div>
              </SectionCard>
            </div>
          </main>

          <aside className="space-y-5">
            <section className="rounded-lg border border-[#dfe7f5] bg-white p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-[#eef3ff] text-[#2447b3]"><LifeBuoyIcon className="size-5" /></span>
                <div>
                  <h2 className="text-sm font-extrabold text-[#07145f]">Need help?</h2>
                  <p className="mt-1 text-xs font-semibold text-[#43507f]">We're here to assist you.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate("/dashboard/settings")}
                className="mt-5 flex h-10 w-full items-center justify-center rounded-lg border border-[#cbd8ee] text-sm font-extrabold text-[#07145f] transition-colors hover:border-[#ff6a1a] hover:text-[#ff6a1a]"
              >
                Open settings
              </button>
            </section>

            <section className="rounded-lg border border-[#dfe7f5] bg-white p-5">
              <h2 className="text-base font-extrabold text-[#07145f]">Quick Links</h2>
              <div className="mt-5 space-y-4">
                {[
                  { icon: ClipboardListIcon, label: "My Reports", path: "/dashboard/reports" },
                  { icon: BellIcon, label: "Notifications", path: "/dashboard/notifications" },
                  { icon: UsersIcon, label: "Community Feed", path: "/dashboard/feed" },
                  { icon: SettingsIcon, label: "Settings", path: "/dashboard/settings" },
                ].map((link) => {
                  const Icon = link.icon
                  return (
                    <button key={link.label} type="button" onClick={() => navigate(link.path)} className="flex w-full items-center gap-3 text-left text-sm font-extrabold text-[#2447b3] transition-colors hover:text-[#ff6a1a]">
                      <Icon className="size-4" />
                      {link.label}
                    </button>
                  )
                })}
              </div>
            </section>

          </aside>
        </div>
      </div>
    </div>
  )
}
