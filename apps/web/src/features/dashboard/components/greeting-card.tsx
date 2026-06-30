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
    <div className="relative mx-4 mt-4 flex h-48 items-end justify-start overflow-hidden rounded-2xl bg-cover bg-center md:mx-10 md:mt-6 md:h-72" style={{ backgroundImage: "url(/images/marikina-1.jpg)" }}>
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/20" />
      {/* Glass card */}
      <div className="relative z-10 mb-4 ml-4 max-w-lg rounded-2xl border border-white/30 bg-white/07 px-4 py-3 text-left shadow-[0_4px_30px_rgba(0,0,0,0.1)] backdrop-blur-[5px] md:mb-8 md:ml-8 md:px-8 md:py-6">
        <h1 className="font-heading text-xl font-bold text-white md:text-3xl lg:text-4xl text-left">
          {greeting}, {user.firstName}
        </h1>
        <p className="mt-1 text-xs font-medium text-white/70 text-left md:mt-2 md:text-sm">
          {dateString}
        </p>
      </div>
    </div>
  )
}
