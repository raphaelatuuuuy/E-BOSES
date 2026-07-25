import { useNavigate } from "react-router-dom"
import { Bell as BellIcon, CaretLeft, Lock as LockIcon, SignOut, User as UserIcon } from "@phosphor-icons/react"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"

export function ProfileCover({
  letter,
  onSignOut,
}: {
  letter: string
  onSignOut: () => void
}) {
  const navigate = useNavigate()

  return (
    <div className="relative">
      <div className="relative h-[132px] w-full overflow-hidden bg-[#9eb3c9] sm:h-[160px]">
        <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <rect width="400" height="160" fill="#8fa6bf" />
          <path fill="#a8bdd1" d="M0 160 V95 H40 V70 H70 V95 H100 V55 H140 V95 H160 V75 H200 V50 H240 V95 H270 V65 H310 V95 H340 V80 H400 V160 Z" />
          <circle cx="320" cy="42" r="18" fill="#c5d4e4" opacity="0.7" />
        </svg>

        <button type="button" onClick={() => navigate(-1)} className="absolute left-3 top-3 z-10 flex size-10 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow-sm backdrop-blur-sm hover:bg-white" aria-label="Back">
          <CaretLeft className="size-5" weight="bold" />
        </button>
        <Popover>
          <PopoverTrigger className="absolute right-3 top-3 z-10 flex size-10 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow-sm backdrop-blur-sm hover:bg-white" aria-label="Settings">
            <BellIcon className="size-5" />
          </PopoverTrigger>
          <PopoverContent className="w-[260px] overflow-hidden rounded-2xl border border-neutral-200 bg-white p-0 shadow-[0_12px_36px_rgba(15,23,42,0.16)]" side="bottom">
            <div className="py-1.5">
              {[
                { label: "Account settings", path: "/dashboard/settings?panel=account", icon: UserIcon },
                { label: "Notification settings", path: "/dashboard/settings?panel=notifications", icon: BellIcon },
                { label: "Privacy settings", path: "/dashboard/settings?panel=privacy", icon: LockIcon },
              ].map((item) => {
                const Icon = item.icon
                return (
                  <button key={item.path} type="button" onClick={() => navigate(item.path)} className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-800 transition-colors hover:bg-neutral-50">
                    <Icon className="size-5 shrink-0 text-neutral-700" />
                    {item.label}
                  </button>
                )
              })}
            </div>
            <div className="border-t border-neutral-200 py-1.5">
              <button type="button" onClick={onSignOut} className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-800 transition-colors hover:bg-neutral-50">
                <SignOut className="size-5 shrink-0 text-neutral-700" />
                Sign out
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="relative z-10 -mt-12 px-4 sm:-mt-14 sm:px-6">
        <span className="flex size-[88px] items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] text-3xl font-bold text-[#2c3a5a] ring-[3px] ring-white sm:size-24 sm:text-4xl" aria-hidden>
          {letter}
        </span>
      </div>
    </div>
  )
}
