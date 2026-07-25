import { Bell as BellIcon, CaretRight, Lock as LockIcon, User as UserIcon } from "@phosphor-icons/react"
import { useNavigate } from "react-router-dom"

import { useAuthSession } from "@/features/auth/auth-session"

import type { SettingsPanel } from "./settings"

function HubRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[56px] w-full items-center gap-3.5 border-b border-neutral-200 px-1 py-3.5 text-left transition-colors hover:bg-neutral-50"
    >
      <Icon className="size-5 shrink-0 text-neutral-800" />
      <span className="min-w-0 flex-1 text-[16px] font-normal text-neutral-900">{label}</span>
      <CaretRight className="size-5 shrink-0 text-neutral-400" weight="bold" />
    </button>
  )
}

export function SettingsHubPanel({ onSetPanel }: { onSetPanel: (panel: SettingsPanel) => void }) {
  const navigate = useNavigate()
  const { signOut } = useAuthSession()

  return (
    <>
      <div className="mt-2">
        <HubRow icon={UserIcon} label="Account settings" onClick={() => onSetPanel("account")} />
        <HubRow icon={LockIcon} label="Privacy settings" onClick={() => onSetPanel("privacy")} />
        <HubRow icon={BellIcon} label="Notification settings" onClick={() => onSetPanel("notifications")} />
      </div>

      <div className="mt-8 space-y-1 px-1">
        <a
          href="/privacy"
          className="block py-2.5 text-[15px] font-normal text-neutral-600 no-underline transition-colors hover:text-neutral-900"
        >
          Privacy policy
        </a>
        <button
          type="button"
          onClick={() => {
            void signOut().finally(() => navigate("/"))
          }}
          className="block w-full py-2.5 text-left text-[15px] font-normal text-neutral-600 transition-colors hover:text-neutral-900"
        >
          Log out
        </button>
      </div>
    </>
  )
}