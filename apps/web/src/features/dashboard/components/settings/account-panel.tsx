import { LogOutIcon } from "lucide-react"
import type { NavigateFunction } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"
import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { FieldShell } from "@/features/dashboard/components/settings/settings-primitives"
import type { AccountRequest } from "@/features/auth/api"

const outlineBtn =
  "flex w-full h-10 items-center justify-center rounded-full border border-neutral-300 bg-white px-4 text-[14px] font-semibold text-neutral-700 transition-colors hover:border-primary hover:bg-primary hover:text-white"

function starPoints(cx: number, cy: number, outer: number, inner: number) {
  const pts: string[] = []
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push(`${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`)
  }
  return pts.join(" ")
}

/** PH mobile E.164: +639XXXXXXXXX */
function isValidPhMobileE164(value: string) {
  return /^\+639\d{9}$/.test(value)
}

/** Local 10-digit national number (9XXXXXXXXX) → +63… */
function e164FromLocalPh(local: string) {
  const d = local.replace(/\D/g, "")
  if (d.length === 10 && d.startsWith("9")) return `+63${d}`
  if (d.startsWith("63") && d.length === 12) return `+${d}`
  if (d.startsWith("0") && d.length === 11) return `+63${d.slice(1)}`
  return ""
}

function PhilippinesFlag({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 36 24"
      className={className}
      aria-hidden="true"
    >
      <rect width="36" height="12" y="0" fill="#0038A8" />
      <rect width="36" height="12" y="12" fill="#CE1126" />
      <path d="M0 0 L18 12 L0 24 Z" fill="#FFFFFF" />
      <circle cx="6.5" cy="12" r="2.15" fill="#FCD116" />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i * 45 * Math.PI) / 180
        return (
          <line
            key={i}
            x1={6.5 + Math.cos(a) * 2.5}
            y1={12 + Math.sin(a) * 2.5}
            x2={6.5 + Math.cos(a) * 3.7}
            y2={12 + Math.sin(a) * 3.7}
            stroke="#FCD116"
            strokeWidth="0.7"
            strokeLinecap="round"
          />
        )
      })}
      {[
        [3.2, 4.2],
        [3.2, 19.8],
        [12.2, 12],
      ].map(([cx, cy], i) => (
        <polygon key={`star-${i}`} fill="#FCD116" points={starPoints(cx, cy, 1.05, 0.45)} />
      ))}
    </svg>
  )
}

export function AccountPanel({
  navigate,
  firstName,
  onFirstNameChange,
  middleName,
  onMiddleNameChange,
  lastName,
  onLastNameChange,
  originalName,
  emailDraft,
  onEmailDraftChange,
  originalEmail,
  phoneLocal,
  onPhoneLocalChange,
  originalPhoneE164,
  displayAddress,
  onOpenAddressFlow,
  pendingDeletion,
  onOpenLifecycle,
  onSignOut,
}: {
  navigate: NavigateFunction
  firstName: string
  onFirstNameChange: (value: string) => void
  middleName: string
  onMiddleNameChange: (value: string) => void
  lastName: string
  onLastNameChange: (value: string) => void
  /** Original (server) name fields — used to detect unsaved edits. */
  originalName: { firstName: string; middleName: string; lastName: string }
  emailDraft: string
  onEmailDraftChange: (value: string) => void
  /** Original (server) email — used to detect unsaved edits. */
  originalEmail: string
  phoneLocal: string
  onPhoneLocalChange: (value: string) => void
  /** Original (server) phone in E.164 — used to detect unsaved edits. */
  originalPhoneE164: string
  displayAddress: string
  onOpenAddressFlow: () => void
  pendingDeletion: AccountRequest | undefined
  onOpenLifecycle: () => void
  onSignOut: () => void
}) {
  const phoneE164 = e164FromLocalPh(phoneLocal)
  const phoneValid = isValidPhMobileE164(phoneE164)
  const phoneDirty =
    phoneE164 !== originalPhoneE164.trim() && phoneLocal.replace(/\D/g, "").length > 0
  const emailDirty =
    emailDraft.trim().toLowerCase() !== originalEmail.trim().toLowerCase()
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDraft.trim())
  const nameDirty =
    firstName.trim() !== originalName.firstName.trim() ||
    lastName.trim() !== originalName.lastName.trim() ||
    middleName.trim() !== originalName.middleName.trim()

  return (
    <div className="mt-3 space-y-4">
      {/* Your account */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="text-[17px] font-bold text-neutral-900">Your account</h2>

        <div className="mt-4">
          <FieldShell label="Full name">
            <div className="space-y-3">
              <FloatingLabelInput
                id="account-first-name"
                label="First name"
                value={firstName}
                onChange={(e) => onFirstNameChange(e.target.value)}
                autoComplete="given-name"
              />
              <FloatingLabelInput
                id="account-middle-name"
                label="Middle name (optional)"
                value={middleName}
                onChange={(e) => onMiddleNameChange(e.target.value)}
                autoComplete="additional-name"
              />
              <FloatingLabelInput
                id="account-last-name"
                label="Last name"
                value={lastName}
                onChange={(e) => onLastNameChange(e.target.value)}
                autoComplete="family-name"
              />
              {nameDirty ? (
                <button
                  type="button"
                  onClick={() =>
                    navigate("/dashboard/settings/reverify/name", {
                      state: {
                        firstName: firstName.trim(),
                        middleName: middleName.trim(),
                        lastName: lastName.trim(),
                      },
                    })
                  }
                  className={outlineBtn}
                >
                  Change name
                </button>
              ) : null}
            </div>
          </FieldShell>

          <FieldShell label="Email">
            <div className="space-y-3">
              <FloatingLabelInput
                id="account-email"
                type="email"
                label="Email address"
                value={emailDraft}
                onChange={(e) => onEmailDraftChange(e.target.value)}
                autoComplete="email"
              />
              {emailDirty && emailLooksValid ? (
                <button
                  type="button"
                  onClick={() =>
                    navigate("/dashboard/settings/reverify/email", {
                      state: { email: emailDraft.trim() },
                    })
                  }
                  className={outlineBtn}
                >
                  Change email
                </button>
              ) : null}
              {emailDirty && !emailLooksValid ? (
                <p className="text-[12px] text-red-600">Enter a valid email address.</p>
              ) : null}
            </div>
          </FieldShell>

            <div className="space-y-3">
              <div className="flex items-stretch gap-2.5">
                <div
                  className={cn(
                    "flex h-[60px] shrink-0 items-center gap-2 rounded-[12px] border-2 bg-white px-3.5",
                    phoneLocal && !phoneValid ? "border-destructive" : "border-input",
                  )}
                  aria-label="Philippines country code +63"
                >
                  <PhilippinesFlag className="h-5 w-[1.875rem] shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" />
                  <span className="text-base font-medium tabular-nums text-neutral-800">
                    +63
                  </span>
                </div>
                <div className="relative min-w-0 flex-1">
                  <input
                    id="account-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    value={phoneLocal}
                    placeholder=""
                    aria-invalid={phoneLocal && !phoneValid ? true : undefined}
                    onChange={(e) => {
                      let d = e.target.value.replace(/\D/g, "")
                      if (d.startsWith("63")) d = d.slice(2)
                      if (d.startsWith("0")) d = d.slice(1)
                      onPhoneLocalChange(d.slice(0, 10))
                    }}
                    className={cn(
                      "peer box-border h-[60px] w-full rounded-[12px] bg-white pl-[0.7rem] pr-4 pt-[1.75rem] pb-2.5 text-base leading-5 text-neutral-800 outline-none transition-[border-width,border-color]",
                      "border-2 border-input focus-visible:border-[3px] focus-visible:border-primary",
                      "aria-invalid:border-destructive",
                    )}
                  />
                  <label
                    htmlFor="account-phone"
                    className={cn(
                      "pointer-events-none absolute z-[1] overflow-hidden text-ellipsis whitespace-nowrap text-neutral-800 transition-all duration-150 ease-out",
                      "left-[calc(0.7rem+2px)] right-[calc(1rem+2px)] peer-focus-visible:left-[calc(0.7rem+3px)] peer-focus-visible:right-[calc(1rem+3px)]",
                      phoneLocal
                        ? "top-2.5 translate-y-0 text-[11px] font-medium leading-[14px]"
                        : "top-1/2 -translate-y-1/2 text-[18px] font-normal leading-5 peer-focus-visible:top-2.5 peer-focus-visible:translate-y-0 peer-focus-visible:text-[11px] peer-focus-visible:font-medium peer-focus-visible:leading-[14px]",
                      phoneLocal && !phoneValid && "text-destructive",
                    )}
                  >
                    Mobile number
                  </label>
                </div>
              </div>
              {phoneLocal && !phoneValid ? (
                <p className="text-[12px] text-red-600">
                  Enter a valid PH mobile number (10 digits starting with 9).
                </p>
              ) : null}
              {phoneDirty && phoneValid ? (
                <button
                  type="button"
                  onClick={() =>
                    navigate("/dashboard/settings/reverify/phone", {
                      state: { phone: phoneE164 },
                    })
                  }
                  className={outlineBtn}
                >
                  Change number
                </button>
              ) : null}
            </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="mt-3">
            <FloatingLabelInput
              id="profile-address"
              label="Street address"
              value={displayAddress}
              readOnly
              onClick={onOpenAddressFlow}
            />
          </div>
        </div>
        <div className="pt-4">
          <button
            type="button"
            onClick={() => navigate("/dashboard/settings/change-password")}
            className={cn(outlineBtn, "w-full justify-center")}
          >
            Change password
          </button>
        </div>
      </section>

      {/* Log out / deactivate */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex items-center gap-2 text-[14px] font-semibold text-neutral-800"
        >
          <LogOutIcon className="size-4" strokeWidth={1.75} />
          Log out
        </button>
        <button
          type="button"
          disabled={Boolean(pendingDeletion)}
          onClick={onOpenLifecycle}
          className="text-[14px] font-semibold text-neutral-600 hover:text-red-700 disabled:opacity-50"
        >
          {pendingDeletion ? "Deletion requested" : "Deactivate your account"}
        </button>
      </div>
    </div>
  )
}
