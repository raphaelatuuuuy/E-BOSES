"use client"

import { useEffect, useMemo, useState } from "react"
import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"

import { changePassword } from "@/features/auth/api"
import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { PASSWORD_REQUIREMENTS } from "@/features/auth/lib/password-requirements"
import { ApiError } from "@/lib/api"

const primaryBtn =
  "flex h-12 w-full items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white transition-colors hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"

export function ChangePasswordFlow({
  registerBack,
  onDone,
  onExit,
}: {
  registerBack: (fn: () => void) => void
  onDone: () => void
  onExit: () => void
}) {
  const navigate = useNavigate()

  useEffect(() => {
    registerBack(onExit)
  })

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [stayLoggedIn, setStayLoggedIn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const requirementsMet = useMemo(
    () => PASSWORD_REQUIREMENTS.every((req) => req.test(newPassword)),
    [newPassword],
  )

  const canSubmit =
    currentPassword.length > 0 &&
    requirementsMet &&
    newPassword === confirmPassword &&
    newPassword !== currentPassword &&
    !busy

  async function handleSubmit() {
    if (!canSubmit) return
    setBusy(true)
    setError("")
    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
        stay_logged_in: stayLoggedIn,
      })
      toast.success("Password updated")
      onDone()
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Could not update password. Try again."
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 className="text-[1.45rem] font-bold leading-tight tracking-tight text-foreground">
        Set a new password
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-neutral-500">
        For a strong password, choose a unique phrase that you don&apos;t use
        on other accounts.
      </p>

      <div className="mt-6 space-y-3">
        <PasswordField
          id="current-password"
          label="Current password"
          value={currentPassword}
          show={showCurrent}
          onToggle={() => setShowCurrent((v) => !v)}
          onChange={setCurrentPassword}
          autoComplete="current-password"
        />
        <button
          type="button"
          onClick={() => navigate("/forgot-password")}
          className="text-[14px] font-medium text-primary hover:underline"
        >
          Forgot your password?
        </button>

        <PasswordField
          id="new-password"
          label="New password"
          value={newPassword}
          show={showNew}
          onToggle={() => setShowNew((v) => !v)}
          onChange={setNewPassword}
          autoComplete="new-password"
        />
        <PasswordField
          id="confirm-password"
          label="Confirm new password"
          value={confirmPassword}
          show={showConfirm}
          onToggle={() => setShowConfirm((v) => !v)}
          onChange={setConfirmPassword}
          autoComplete="new-password"
        />

        {newPassword ? (
          <ul className="space-y-1 pt-1 text-[12px] text-neutral-500">
            {PASSWORD_REQUIREMENTS.map((req) => {
              const ok = req.test(newPassword)
              return (
                <li
                  key={req.id}
                  className={cn(ok ? "text-neutral-600" : "text-neutral-500")}
                >
                  {ok ? "✓" : "·"} {req.label}
                </li>
              )
            })}
            {confirmPassword && newPassword !== confirmPassword ? (
              <li className="text-sos">Passwords do not match</li>
            ) : null}
          </ul>
        ) : null}

        <label className="flex cursor-pointer items-center gap-3 pt-2">
          <Checkbox
            checked={stayLoggedIn}
            onChange={(e) => setStayLoggedIn(e.currentTarget.checked)}
            aria-label="Stay logged in on other devices"
          />
          <span className="text-[14px] text-neutral-800">
            Stay logged in on other devices
          </span>
        </label>

        {error ? (
          <p className="text-[13px] font-medium text-sos" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          className={cn(primaryBtn, "mt-4")}
        >
          {busy ? (
            <>
              <Loader2Icon className="mr-2 size-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Set new password"
          )}
        </button>
      </div>
    </>
  )
}

function PasswordField({
  id,
  label,
  value,
  show,
  onToggle,
  onChange,
  autoComplete,
}: {
  id: string
  label: string
  value: string
  show: boolean
  onToggle: () => void
  onChange: (v: string) => void
  autoComplete?: string
}) {
  return (
    <div className="relative">
      <FloatingLabelInput
        id={id}
        type={show ? "text" : "password"}
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="pr-12"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute top-1/2 right-2 z-[2] flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? (
          <EyeOffIcon className="size-5" strokeWidth={1.75} />
        ) : (
          <EyeIcon className="size-5" strokeWidth={1.75} />
        )}
      </button>
    </div>
  )
}
