import { useEffect, useState } from "react"
import { CalendarDaysIcon, MapPinIcon } from "lucide-react"
import { useAuthSession } from "@/features/auth/auth-session"

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return "Good morning"
  if (hour >= 12 && hour < 18) return "Good afternoon"
  return "Good evening"
}

function getDateString() {
  const now = new Date()
  return `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`
}

export function GreetingCard() {
  const { user } = useAuthSession()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const displayName = user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : "Resident"

  return (
    <section className="relative flex min-h-[210px] w-full flex-col overflow-hidden rounded-2xl lg:flex-row">
      <div className="relative z-10 flex shrink-0 flex-col justify-center px-0 py-5 sm:px-0 lg:w-[34%] xl:w-[31%]">
        <h1 className="font-heading text-center text-2xl font-extrabold leading-tight text-[#07145f] sm:text-3xl md:text-left xl:text-[2.35rem]">
          <span className="block text-base text-[#ff5f14] sm:text-lg">{mounted ? `${getGreeting()},` : "Good day,"}</span>
          {displayName}!
        </h1>
        <p className="mt-3 text-center text-sm font-semibold leading-6 text-[#43507f] md:text-left">
          Let's work together for a safer and stronger Marikina Heights.
        </p>

        <div className="mt-5 flex flex-row-reverse flex-wrap items-center justify-between gap-y-3 text-[#07145f] md:flex-row md:justify-start md:gap-x-5">
          <div className="flex items-center gap-2">
            <MapPinIcon className="size-5 shrink-0 text-[#ff6a1a]" strokeWidth={2.2} />
            <div>
              <p className="text-xs font-bold">Marikina Heights</p>
              <p className="text-[11px] text-[#46537d]">Barangay</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <CalendarDaysIcon className="size-5 shrink-0 text-[#ff6a1a]" strokeWidth={2.2} />
            <div>
              <p className="text-xs font-bold">{mounted ? getDateString() : ""}</p>
              <p className="text-[11px] text-[#46537d]">Today</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-end justify-center px-4 pb-3 lg:px-0 lg:pb-0">
        <img
          src="/contents/home-greetings.png"
          alt=""
          className="max-h-52 w-full object-contain object-bottom lg:h-full lg:max-h-none"
        />
      </div>
    </section>
  )
}
