import { useMockUser } from "@/features/dashboard/components/mock-user-context"

const FILIPINO_DAYS = [
  "Linggo",
  "Lunes",
  "Martes",
  "Miyerkules",
  "Huwebes",
  "Biyernes",
  "Sabado",
]

const FILIPINO_MONTHS = [
  "Enero",
  "Pebrero",
  "Marso",
  "Abril",
  "Mayo",
  "Hunyo",
  "Hulyo",
  "Agosto",
  "Setyembre",
  "Oktubre",
  "Nobyembre",
  "Disyembre",
]

function getFilipinoGreeting(): string {
  const hour = new Date().getHours()

  if (hour >= 5 && hour <= 11) return "Magandang umaga"
  if (hour === 12) return "Magandang tanghali"
  if (hour >= 13 && hour <= 17) return "Magandang hapon"
  return "Magandang gabi"
}

function getFilipinoDateString(): string {
  const now = new Date()
  const dayName = FILIPINO_DAYS[now.getDay()]
  const monthName = FILIPINO_MONTHS[now.getMonth()]
  const date = now.getDate()
  const year = now.getFullYear()

  return `Brgy. Marikina Heights, ${dayName}, ${monthName} ${date}, ${year}`
}

export function GreetingCard() {
  const user = useMockUser()
  const greeting = getFilipinoGreeting()
  const dateString = getFilipinoDateString()

  return (
    <div className="relative flex h-64 items-center justify-center bg-gradient-to-br from-blue-900/30 to-indigo-900/40">
      {/* Glass card */}
      <div className="mx-auto max-w-lg rounded-xl border border-white/20 bg-white/10 px-8 py-6 text-center backdrop-blur-md">
        <h1 className="font-heading text-3xl font-bold text-white md:text-4xl">
          {greeting}, {user.firstName}
        </h1>
        <p className="mt-2 text-sm font-medium text-white/70">
          {dateString}
        </p>
      </div>
    </div>
  )
}
