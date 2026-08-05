import { useCallback, useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

import { usePageTitle } from "@/hooks/use-page-title"
import { getStatusPath, useAuthSession } from "@/features/auth/auth-session"
import { getMyResidenceVerification } from "@/features/ocr/api"

const POLL_INTERVAL_MS = 30_000

export default function AccountPendingPage() {
  usePageTitle("Account under review")
  const navigate = useNavigate()
  const { user, refreshUser, signOut } = useAuthSession()
  const [checking, setChecking] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)

  const firstName =
    user?.firstName?.trim() ||
    user?.full_name?.split(" ")[0] ||
    "Neighbor"
  const fullName =
    user?.full_name?.trim() ||
    `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() ||
    "Resident"

  const checkStatus = useCallback(async (manual = false) => {
    if (!user) return
    if (manual) setChecking(true)
    try {
      // verification/me also self-heals stuck OCR cases on the backend, so this
      // poll does more than just wait for an official to decide.
      const status = await getMyResidenceVerification()
      const nextUser = await refreshUser()
      if (nextUser?.status === "rejected" || status?.user_status === "rejected") {
        setDeclined(true)
        return
      }
      if (nextUser?.status === "verified") {
        navigate(getStatusPath(nextUser.status, { isOnboarded: nextUser.is_onboarded }), {
          replace: true,
        })
      }
    } catch {
      // transient network / auth errors — keep waiting
    } finally {
      if (manual) {
        setChecking(false)
        setLastCheckedAt(new Date())
      }
    }
  }, [navigate, refreshUser, user])

  useEffect(() => {
    const run = () => void checkStatus()
    const initialCheck = window.setTimeout(run, 0)
    const id = window.setInterval(run, POLL_INTERVAL_MS)
    return () => {
      window.clearTimeout(initialCheck)
      window.clearInterval(id)
    }
  }, [checkStatus])

  async function handleSignOut() {
    await signOut()
    navigate("/sign-in", { replace: true })
  }

  return (
    <div className="flex min-h-svh flex-col bg-white">
      <header className="border-b border-neutral-200 px-5 py-4 sm:px-8">
        <Link
          to="/"
          className="mx-auto flex max-w-3xl items-center gap-2"
          aria-label="Boses — back to landing page"
        >
          <img src="/contents/logo.png" alt="" className="h-8 w-auto" />
          <span className="font-heading text-xl font-bold text-[#ff8133]">Boses</span>
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="text-[1.75rem] font-bold tracking-tight text-neutral-800 sm:text-[2rem]">
          {firstName}, your account is under review
        </h1>
        <p className="mt-1 text-[15px] text-neutral-500">Waiting for approval</p>

        {declined ? (
          <div className="mt-6 max-w-2xl rounded-md border border-neutral-200 bg-neutral-50 p-5 text-[15px] leading-relaxed text-neutral-700">
            <p className="font-semibold text-neutral-800">
              We couldn&apos;t approve your account.
            </p>
            <p className="mt-2">
              Your residence proof could not be verified. If you believe this is a
              mistake, contact your Barangay Office or{" "}
              <a href="mailto:support@eboses.local" className="underline underline-offset-2">
                support@eboses.local
              </a>
              .
            </p>
          </div>
        ) : (
          <>
            <div className="mt-5 max-w-2xl space-y-4 text-[15px] leading-relaxed text-neutral-600">
              <p>
                An official is verifying your residence proof. Once it&apos;s
                approved, you&apos;ll be let in automatically — no need to do
                anything. Need help?{" "}
                <a href="mailto:support@eboses.local" className="underline underline-offset-2">
                  Contact us
                </a>
                .
              </p>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={checking}
                onClick={() => void checkStatus(true)}
                className="inline-flex h-11 items-center justify-center rounded-md bg-[#ff6a1a] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-[#e85f12] disabled:opacity-60"
              >
                {checking ? (
                  <>
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                    Checking…
                  </>
                ) : (
                  "Check status now"
                )}
              </button>
              {lastCheckedAt ? (
                <span className="text-[13px] text-neutral-500">
                  Last checked at {lastCheckedAt.toLocaleTimeString()}
                </span>
              ) : null}
            </div>
          </>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-5 text-[14px] text-neutral-600">
          <p>
            You are signed in as{" "}
            <span className="font-medium text-neutral-800">{fullName}</span>
            {user?.email ? (
              <>
                {" "}
                (<span className="break-all">{user.email}</span>)
              </>
            ) : null}
            .{" "}
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="font-semibold text-neutral-800 underline underline-offset-2 hover:text-neutral-950"
            >
              Sign out
            </button>
          </p>
          <a
            href="/privacy"
            className="text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline"
          >
            Help
          </a>
        </div>
      </main>
    </div>
  )
}
