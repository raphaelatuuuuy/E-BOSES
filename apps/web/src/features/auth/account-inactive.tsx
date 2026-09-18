import { useState } from "react"
import { Loader2Icon } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { usePageTitle } from "@/hooks/use-page-title"
import { reactivateAccount } from "@/features/auth/api"
import { getStatusPath, useAuthSession } from "@/features/auth/auth-session"
import { getAccessToken } from "@/lib/api"

export default function AccountInactivePage() {
  usePageTitle("Account inactive")
  const navigate = useNavigate()
  const { user, signOut, setAuthenticatedUser } = useAuthSession()
  const [busy, setBusy] = useState(false)

  const firstName =
    user?.firstName?.trim() ||
    user?.full_name?.split(" ")[0] ||
    "Neighbor"
  const fullName =
    user?.full_name?.trim() ||
    `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() ||
    "Resident"

  async function handleReactivate() {
    setBusy(true)
    try {
      const nextUser = await reactivateAccount()
      const access = getAccessToken()
      if (access) {
        setAuthenticatedUser(nextUser, access)
      }
      toast.success("Welcome back!")
      navigate(getStatusPath(nextUser.status, { isOnboarded: nextUser.is_onboarded }), {
        replace: true,
      })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not reactivate account.",
      )
    } finally {
      setBusy(false)
    }
  }

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
          aria-label={import.meta.env.MODE === "capacitor" ? "Boses — home" : "Boses — back to landing page"}
        >
          <img src="/contents/logo.webp" alt="" className="h-8 w-auto" />
          <span className="text-2xl font-bold text-accent">Boses</span>
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="text-[1.75rem] font-bold tracking-tight text-neutral-800 sm:text-[2rem]">
          {firstName}, Welcome back!
        </h1>

        <div className="mt-5 max-w-2xl space-y-4 text-[15px] leading-relaxed text-neutral-600">
          <p>
            Your account is currently inactive. If you&apos;d like to reactivate
            your account and join your neighbors on E-Boses,
            click the button below. If you need help,{" "}
            <a href="mailto:support@eboses.local" className="underline underline-offset-2">
              contact us
            </a>
            .
          </p>
          <p>
            By reactivating your account, you reaffirm your agreement to our{" "}
            <a href="/privacy" className="underline underline-offset-2">
              Privacy Policy
            </a>{" "}
            and community guidelines.
          </p>
        </div>

        <button
          type="button"
          disabled={busy || !user}
          onClick={() => void handleReactivate()}
          className="mt-8 inline-flex h-11 items-center justify-center rounded-md bg-brand-orange px-5 text-[15px] font-semibold text-white transition-colors hover:bg-brand-orange-strong disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2Icon className="mr-2 size-4 animate-spin" />
              Reactivating…
            </>
          ) : (
            "Reactivate Account"
          )}
        </button>

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
