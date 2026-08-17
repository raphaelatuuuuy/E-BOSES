import { useSystemStatus } from "@/features/dashboard/components/system-banner"

function formatWindow(endsAt: string | null) {
  if (!endsAt) return "We will be back as soon as the work is finished."
  const end = new Date(endsAt)
  if (Number.isNaN(end.getTime())) return "We will be back shortly."
  return `Expected back by ${end.toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  })}.`
}

/**
 * Shown when an official has put the app into maintenance. Emergencies are the
 * one thing that must not depend on this app being up, so the hotlines are the
 * most prominent thing on the page.
 */
export function MaintenancePage() {
  const { status } = useSystemStatus()
  const notice = status?.maintenance ?? null

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[680px] flex-col justify-center px-6 py-20">
      <p className="text-label text-neutral-500">E-BOSES</p>
      <h1 className="mt-6 text-page-title text-brand-navy">
        {notice?.message || "We are carrying out maintenance"}
      </h1>
      <p className="mt-6 text-read text-neutral-500">
        {notice?.detail ||
          "The app is briefly unavailable while the barangay updates the system. Nothing you have reported is lost."}
      </p>
      <p className="mt-4 text-meta text-neutral-500">{formatWindow(notice?.ends_at ?? null)}</p>

      <div className="mt-14 border-t border-neutral-200 pt-8">
        <h2 className="text-section text-brand-navy">If this is an emergency</h2>
        <p className="mt-4 text-read text-neutral-500">
          Do not wait for the app. Call for help now.
        </p>
        <ul className="mt-6 overflow-hidden rounded-xl border border-neutral-200">
          <li className="flex items-baseline justify-between border-b border-neutral-200 px-8 py-7">
            <span className="text-row text-foreground">Marikina Rescue</span>
            <a href="tel:161" className="text-row font-medium text-accent">
              161
            </a>
          </li>
          <li className="flex items-baseline justify-between px-8 py-7">
            <span className="text-row text-foreground">National emergency</span>
            <a href="tel:911" className="text-row font-medium text-accent">
              911
            </a>
          </li>
        </ul>
      </div>

      <p className="mt-14 text-meta text-neutral-400">
        Barangay officials can still sign in to complete the work.
      </p>
    </main>
  )
}
