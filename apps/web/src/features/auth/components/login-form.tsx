import * as React from "react"
import { Link } from "react-router-dom"
import {
  ChevronDownIcon,
  InfoIcon,
  LoaderCircleIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Field, FieldError } from "@workspace/ui/components/field"
import { cn } from "@workspace/ui/lib/utils"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import {
  getDevicePassword,
  getWebPassword,
  saveDevicePassword,
  saveWebPassword,
} from "@/features/auth/device-credentials"
import {
  SILENT_SIGN_IN_ERROR,
  useSignInForm,
} from "@/features/auth/hooks/use-sign-in-form"
import {
  clearRecentPassword,
  forgetRecentAccount,
  readRecentAccounts,
  readRecentPassword,
  rememberRecentAccount,
  saveRecentPassword,
  type RecentAccount,
} from "@/features/auth/recent-accounts"
import type { AuthUser } from "@/features/auth/api"
import { initials } from "@/lib/initials"

interface LoginFormProps extends React.ComponentProps<"div"> {
  onForgotPassword?: () => void
  onSignUp?: () => void
  onSuccess?: (user: AuthUser, access: string) => void
}

export function LoginForm({
  className,
  onForgotPassword,
  onSignUp,
  onSuccess,
  ...props
}: LoginFormProps) {
  const [showPassword, setShowPassword] = React.useState(false)
  const [rememberAccount, setRememberAccount] = React.useState(false)
  const [recentAccounts, setRecentAccounts] =
    React.useState<RecentAccount[]>(readRecentAccounts)
  const [isRetrieving, setIsRetrieving] = React.useState(false)
  const accountMenuRef = React.useRef<HTMLDetailsElement>(null)
  const {
    errors,
    handleChange,
    handleSubmit,
    isSubmitting,
    submitError,
    values,
  } = useSignInForm({
    onSuccess,
    beforeSuccess: async ({ user, identifier, values: submittedValues }) => {
      setRecentAccounts(rememberRecentAccount(user, identifier))
      if (!rememberAccount) {
        clearRecentPassword(user.id)
        return
      }
      saveRecentPassword(user.id, submittedValues.password)
      await saveDevicePassword(identifier, submittedValues.password).catch(
        () => undefined
      )
      await saveWebPassword(identifier, submittedValues.password).catch(
        () => undefined
      )
    },
  })

  async function chooseRecentAccount(account: RecentAccount) {
    accountMenuRef.current?.removeAttribute("open")
    handleChange("identifier", account.identifier)
    const savedPassword = readRecentPassword(account.id)
    if (savedPassword) {
      handleChange("password", savedPassword)
      setRememberAccount(true)
      return
    }
    handleChange("password", "")
    setRememberAccount(false)
    setIsRetrieving(true)
    try {
      const credential =
        (await getDevicePassword().catch(() => null)) ??
        (await getWebPassword().catch(() => null))
      if (!credential) return
      const matchingAccount =
        recentAccounts.find(
          (row) => row.identifier.toLowerCase() === credential.id.toLowerCase()
        ) ?? account
      handleChange("identifier", matchingAccount.identifier)
      handleChange("password", credential.password)
      saveRecentPassword(matchingAccount.id, credential.password)
      setRememberAccount(true)
    } catch {
      return
    } finally {
      setIsRetrieving(false)
    }
  }

  return (
    <div className={cn("w-full", className)} {...props}>
      <form
        className="flex w-full flex-col gap-2"
        noValidate
        onSubmit={handleSubmit}
      >
        <Field>
          <div className="relative">
            <FloatingLabelInput
              id="identifier"
              name="identifier"
              type="email"
              inputMode="email"
              autoComplete="username"
              label="Email address"
              value={values.identifier}
              onChange={(event) =>
                handleChange("identifier", event.target.value)
              }
              aria-invalid={Boolean(errors.identifier)}
              required
              className="pr-12"
            />
            <div className="contents">
              <details ref={accountMenuRef} className="group static">
                <summary
                  className="absolute top-1/2 right-2 z-20 flex size-8 -translate-y-1/2 cursor-pointer list-none items-center justify-center rounded-full text-foreground hover:bg-muted [&::-webkit-details-marker]:hidden"
                  aria-label="Show saved accounts"
                >
                  <ChevronDownIcon
                    className="size-5 transition-transform group-open:rotate-180"
                    strokeWidth={2}
                    aria-hidden
                  />
                </summary>
                <div className="absolute top-[calc(100%+0.375rem)] left-0 z-50 w-full overflow-hidden rounded-[12px] border-2 border-input bg-white p-2 shadow-xl">
                  {recentAccounts.length ? (
                    recentAccounts.map((account) => (
                      <div
                        key={account.id}
                        className="group/account flex items-center rounded-xl hover:bg-muted/70"
                      >
                        <button
                          type="button"
                          onClick={() => void chooseRecentAccount(account)}
                          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-soft text-sm font-bold text-navy-muted">
                            {initials(account.name).charAt(0)}
                          </span>
                          <span className="block min-w-0 truncate text-sm font-semibold text-foreground">
                            {account.name}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="mr-2 flex size-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${account.name} from recent accounts`}
                          onClick={() =>
                            setRecentAccounts(forgetRecentAccount(account.id))
                          }
                        >
                          <XIcon
                            className="size-5"
                            strokeWidth={2}
                            aria-hidden
                          />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center justify-center gap-2 px-3 py-5 text-sm font-medium text-neutral-600">
                      <InfoIcon
                        className="size-4 shrink-0"
                        strokeWidth={1.9}
                        aria-hidden
                      />
                      <span>No saved accounts yet.</span>
                    </div>
                  )}
                </div>
              </details>
            </div>
          </div>
          {errors.identifier && errors.identifier !== SILENT_SIGN_IN_ERROR ? (
            <FieldError>{errors.identifier}</FieldError>
          ) : null}
        </Field>

        <Field>
          <div className="relative">
            <FloatingLabelInput
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              label="Password"
              value={values.password}
              disabled={isRetrieving}
              onChange={(event) => handleChange("password", event.target.value)}
              aria-invalid={Boolean(errors.password)}
              required
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((open) => !open)}
              className="absolute top-1/2 right-3 z-10 -translate-y-1/2 px-2 py-1 text-xs font-medium text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
              tabIndex={-1}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {errors.password ? <FieldError>{errors.password}</FieldError> : null}
        </Field>

        <div className="mt-1 flex items-center justify-between gap-3">
          <label
            htmlFor="remember-account"
            className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-foreground"
          >
            <Checkbox
              id="remember-account"
              checked={rememberAccount}
              onChange={(event) => setRememberAccount(event.target.checked)}
            />
            <span>Remember me</span>
          </label>
          <button
            type="button"
            onClick={onForgotPassword}
            className="shrink-0 text-[13px] font-semibold text-foreground transition-colors hover:text-primary"
          >
            Forgot password?
          </button>
        </div>

        <Button
          type="submit"
          disabled={isSubmitting || isRetrieving}
          className="mt-2 h-12 w-full rounded-full text-base font-semibold shadow-none"
        >
          {isSubmitting ? (
            <LoaderCircleIcon
              className="size-5 animate-spin"
              aria-hidden="true"
            />
          ) : (
            "Sign in"
          )}
        </Button>

        {submitError ? (
          <FieldError className="justify-center text-center">
            {submitError}
          </FieldError>
        ) : null}

        <Button
          type="button"
          onClick={onSignUp}
          className="mt-1 h-12 w-full rounded-full border-brand-navy bg-brand-navy text-base font-semibold text-white shadow-none transition-colors hover:bg-brand-navy/90"
        >
          Create an account
        </Button>

        <div className="mt-2 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            or
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Link
          to="/report-issue"
          className="mt-1 flex h-12 w-full items-center justify-center rounded-full border border-foreground bg-white text-base font-semibold text-foreground transition-colors hover:bg-foreground hover:text-white"
        >
          Continue as guest
        </Link>
      </form>
    </div>
  )
}
