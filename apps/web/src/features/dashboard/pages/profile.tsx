import type { ElementType } from "react"
import {
  BellIcon,
  FileTextIcon,
  HelpCircleIcon,
  LogOutIcon,
  MegaphoneIcon,
  PhoneIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"
import { useMockUser } from "@/features/dashboard/components/mock-user-context"

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
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {items.map((item) => {
          const Icon = item.icon

          return (
            <button
              key={item.label}
              type="button"
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary"
            >
              <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {item.label}
                </p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}

export default function ProfilePage() {
  usePageTitle("Profile")
  const user = useMockUser()

  return (
    <div className="flex min-h-svh flex-col">
      <Topbar />

      <div className="flex-1 p-4 md:p-10">
        <div className="rounded-2xl bg-primary px-6 py-4">
          <p className="text-xs text-[#020c4e]/70">Marikina Heights</p>
          <h1 className="font-heading text-2xl font-bold text-[#020c4e] md:text-3xl">
            Profile
          </h1>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          {/* Left: Profile info + sections */}
          <section className="flex flex-col gap-6 lg:col-span-3">
            {/* Profile header */}
            <div className="flex items-center gap-4">
              <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
                {user.firstName[0]}
                {user.lastName[0]}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-foreground">
                  {user.firstName} {user.lastName}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Verified resident since Jan 2026
                </p>
              </div>
            </div>

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

          {/* Right: Legal + Actions */}
          <aside className="flex flex-col gap-6 lg:col-span-2">
            <ProfileSection
              title="Legal"
              description="Review policies that apply to your account."
              items={legalItems}
            />

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Account actions</CardTitle>
                <CardDescription>
                  Sign out or request account deletion.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button type="button" variant="destructive" className="w-full justify-start">
                  <Trash2Icon data-icon="inline-start" />
                  Delete Account
                </Button>
                <Button type="button" variant="outline" className="w-full justify-start">
                  <LogOutIcon data-icon="inline-start" />
                  Sign Out
                </Button>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  )
}
