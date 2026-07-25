import { useNavigate } from "react-router-dom"
import { Pencil, SignOut } from "@phosphor-icons/react"
import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { cn } from "@workspace/ui/lib/utils"
import type { AccountRequest } from "@/features/auth/api"

const outlineBtn =
  "inline-flex h-10 items-center rounded-full border border-neutral-300 bg-white px-4 text-[14px] font-semibold text-neutral-700 transition-colors hover:border-[#ff8133] hover:bg-[#ff8133] hover:text-white"

function starPoints(cx: number, cy: number, outer: number, inner: number) {
  const pts: string[] = []
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push(`${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`)
  }
  return pts.join(" ")
}

function PhilippinesFlag({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24" className={className} aria-hidden="true">
      <rect width="36" height="12" y="0" fill="#0038A8" />
      <rect width="36" height="12" y="12" fill="#CE1126" />
      <path d="M0 0 L18 12 L0 24 Z" fill="#FFFFFF" />
      <circle cx="6.5" cy="12" r="2.15" fill="#FCD116" />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i * 45 * Math.PI) / 180
        return (
          <line key={i} x1={6.5 + Math.cos(a) * 2.5} y1={12 + Math.sin(a) * 2.5}
            x2={6.5 + Math.cos(a) * 3.7} y2={12 + Math.sin(a) * 3.7}
            stroke="#FCD116" strokeWidth="0.7" strokeLinecap="round" />
        )
      })}
      {[[3.2, 4.2], [3.2, 19.8], [12.2, 12]].map(([cx, cy], i) => (
        <polygon key={`star-${i}`} fill="#FCD116" points={starPoints(cx, cy, 1.05, 0.45)} />
      ))}
    </svg>
  )
}

function FieldShell({ label, children, hint }: { label?: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-4">
      {label ? <p className="mb-2 text-[13px] font-semibold text-neutral-700">{label}</p> : null}
      {children}
      {hint}
    </div>
  )
}

export function AccountSettingsSection({
  firstName,
  middleName,
  lastName,
  emailDraft,
  phoneLocal,
  displayAddress,
  fullName,
  barangay,
  letter,
  phoneE164,
  phoneValid,
  phoneDirty,
  emailDirty,
  emailLooksValid,
  nameDirty,
  pendingDeletion,
  onSetField,
  onOpenAddress,
  onOpenLifecycle,
  onSignOut,
}: {
  firstName: string
  middleName: string
  lastName: string
  emailDraft: string
  phoneLocal: string
  displayAddress: string
  fullName: string
  barangay: string
  letter: string
  phoneE164: string
  phoneValid: boolean
  phoneDirty: boolean
  emailDirty: boolean
  emailLooksValid: boolean
  nameDirty: boolean
  pendingDeletion: AccountRequest | undefined
  onSetField: (field: string, value: string) => void
  onOpenAddress: () => void
  onOpenLifecycle: () => void
  onSignOut: () => void
}) {
  const navigate = useNavigate()

  return (
    <div className="mt-3 space-y-4">
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="text-[17px] font-bold text-neutral-900">Your account</h2>
        <div className="mt-4">
          <FieldShell label="Full name">
            <div className="space-y-3">
              <FloatingLabelInput id="account-first-name" label="First name" value={firstName}
                onChange={(e) => onSetField("firstName", e.target.value)} autoComplete="given-name" />
              <FloatingLabelInput id="account-middle-name" label="Middle name (optional)" value={middleName}
                onChange={(e) => onSetField("middleName", e.target.value)} autoComplete="additional-name" />
              <FloatingLabelInput id="account-last-name" label="Last name" value={lastName}
                onChange={(e) => onSetField("lastName", e.target.value)} autoComplete="family-name" />
              {nameDirty ? (
                <button type="button" onClick={() => navigate("/dashboard/settings/reverify/name", {
                  state: { firstName: firstName.trim(), middleName: middleName.trim(), lastName: lastName.trim() }
                })} className={outlineBtn}>Change name</button>
              ) : null}
            </div>
          </FieldShell>

          <FieldShell label="Email">
            <div className="space-y-3">
              <FloatingLabelInput id="account-email" type="email" label="Email address" value={emailDraft}
                onChange={(e) => onSetField("emailDraft", e.target.value)} autoComplete="email" />
              {emailDirty && emailLooksValid ? (
                <button type="button" onClick={() => navigate("/dashboard/settings/reverify/email", { state: { email: emailDraft.trim() } })} className={outlineBtn}>Change email</button>
              ) : null}
              {emailDirty && !emailLooksValid ? <p className="text-[12px] text-red-600">Enter a valid email address.</p> : null}
            </div>
          </FieldShell>

          <FieldShell label="Password">
            <button type="button" onClick={() => navigate("/dashboard/settings/change-password")} className={outlineBtn}>Change password</button>
          </FieldShell>

          <FieldShell label="Mobile number">
            <div className="space-y-3">
              <div className="flex items-stretch gap-2.5">
                <div className={cn("flex h-[60px] shrink-0 items-center gap-2 rounded-[12px] border-2 bg-white px-3.5", phoneLocal && !phoneValid ? "border-destructive" : "border-input")} aria-label="Philippines country code +63">
                  <PhilippinesFlag className="h-5 w-[1.875rem] shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]" />
                  <span className="text-base font-medium tabular-nums text-neutral-800">+63</span>
                </div>
                <div className="relative min-w-0 flex-1">
                  <input id="account-phone" type="tel" inputMode="numeric" autoComplete="tel-national"
                    value={phoneLocal} placeholder="" aria-invalid={phoneLocal && !phoneValid ? true : undefined}
                    onChange={(e) => {
                      let d = e.target.value.replace(/\D/g, "")
                      if (d.startsWith("63")) d = d.slice(2)
                      if (d.startsWith("0")) d = d.slice(1)
                      onSetField("phoneLocal", d.slice(0, 10))
                    }}
                    className={cn("peer box-border h-[60px] w-full rounded-[12px] bg-white pl-[0.7rem] pr-4 pt-[1.75rem] pb-2.5 text-base leading-5 text-neutral-800 outline-none transition-[border-width,border-color] border-2 border-input focus-visible:border-[3px] focus-visible:border-primary aria-invalid:border-destructive")}
                  />
                  <label htmlFor="account-phone" className={cn("pointer-events-none absolute z-[1] overflow-hidden text-ellipsis whitespace-nowrap text-neutral-800 transition-all duration-150 ease-out left-[calc(0.7rem+2px)] right-[calc(1rem+2px)] peer-focus-visible:left-[calc(0.7rem+3px)] peer-focus-visible:right-[calc(1rem+3px)]",
                    phoneLocal ? "top-2.5 translate-y-0 text-[11px] font-medium leading-[14px]" : "top-1/2 -translate-y-1/2 text-[18px] font-normal leading-5 peer-focus-visible:top-2.5 peer-focus-visible:translate-y-0 peer-focus-visible:text-[11px] peer-focus-visible:font-medium peer-focus-visible:leading-[14px]",
                    phoneLocal && !phoneValid && "text-destructive")}>Mobile number</label>
                </div>
              </div>
              {phoneLocal && !phoneValid ? <p className="text-[12px] text-red-600">Enter a valid PH mobile number (10 digits starting with 9).</p> : null}
              {phoneDirty && phoneValid ? (
                <button type="button" onClick={() => navigate("/dashboard/settings/reverify/phone", { state: { phone: phoneE164 } })} className={outlineBtn}>Change number</button>
              ) : null}
            </div>
          </FieldShell>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white px-4 py-4">
        <h2 className="text-[16px] font-bold leading-none text-neutral-900">Profiles</h2>
        <div className="mt-4 flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#c5d0e6] text-[16px] font-bold text-[#2c3a5a]">{letter}</span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[15px] font-semibold leading-snug text-neutral-900">{fullName}</p>
            <p className="mt-0.5 text-[13px] font-normal leading-snug text-neutral-500">{barangay}</p>
            <div className="mt-2.5 flex items-center gap-1.5">
              <button type="button" onClick={onOpenAddress} className="max-w-[min(100%,20rem)] min-w-0 text-left">
                <p className="text-[14px] font-normal leading-[1.35] text-neutral-800">
                  {displayAddress || <span className="text-neutral-400">Add street address</span>}
                </p>
              </button>
              <button type="button" onClick={onOpenAddress}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
                aria-label={displayAddress ? "Confirm or edit address" : "Add street address"}>
                <Pencil className="size-5" weight="bold" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
        <button type="button" onClick={onSignOut} className="inline-flex items-center gap-2 text-[14px] font-semibold text-neutral-800">
          <SignOut className="size-4" />Log out
        </button>
        <button type="button" disabled={Boolean(pendingDeletion)} onClick={onOpenLifecycle}
          className="text-[14px] font-semibold text-neutral-600 hover:text-red-700 disabled:opacity-50">
          {pendingDeletion ? "Deletion requested" : "Deactivate your account"}
        </button>
      </div>
    </div>
  )
}
