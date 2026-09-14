"use client"

import { useState } from "react"

import { useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import { OfficialSettingsDialog } from "@/features/dashboard/components/official/official-account-dialogs"
import { ResidentSettingsDialog } from "@/features/dashboard/components/resident/resident-account-dialogs"
import { ResponderSettingsDialog } from "@/features/dashboard/components/responder/account-dialogs"
import { useSettingsPopGate } from "@/features/dashboard/components/settings/settings-event"

export function SettingsPopGate() {
  const [open, setOpen] = useState(false)
  useSettingsPopGate(() => setOpen(true))
  const { user } = useAuthSession()
  if (!open) return null
  if (isOfficialUser(user)) {
    return <OfficialSettingsDialog open onOpenChange={setOpen} />
  }
  if (user?.role === "resident") {
    return <ResidentSettingsDialog open onOpenChange={setOpen} />
  }
  if (isResponderUser(user)) {
    return <ResponderSettingsDialog open onOpenChange={setOpen} />
  }
  return null
}
