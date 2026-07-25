import { Link } from "react-router-dom"
import { CaretRight, Warning } from "@phosphor-icons/react"

export function FeedEmergencyBanner({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <Link
      to="/dashboard/alerts-map"
      className="mt-5 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5 no-underline transition-colors hover:bg-red-100/80"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
        <Warning className="size-5" weight="bold" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-red-800">
          {count} ongoing alert{count === 1 ? "" : "s"} in Marikina Heights
        </span>
        <span className="mt-0.5 block text-[13px] font-medium text-red-700/90">
          Open the alerts map for locations and nearby services
        </span>
      </span>
      <CaretRight className="size-5 shrink-0 text-red-600" weight="bold" />
    </Link>
  )
}
