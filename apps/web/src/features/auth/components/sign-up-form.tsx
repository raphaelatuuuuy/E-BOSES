"use client"

import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { FieldError } from "@workspace/ui/components/field"
import { cn } from "@workspace/ui/lib/utils"

import type { AuthUser, ResidenceProofDetectResult } from "@/features/auth/api"
import { SignUpShell } from "@/features/auth/components/sign-up-shell"
import { AccountStep } from "@/features/auth/components/sign-up-steps/account-step"
import { AddressStep } from "@/features/auth/components/sign-up-steps/address-step"
import { CommunityPeekStep } from "@/features/auth/components/sign-up-steps/community-peek-step"
import { DobStep } from "@/features/auth/components/sign-up-steps/dob-step"
import { EmailOtpStep } from "@/features/auth/components/sign-up-steps/email-otp-step"
import { GenderStep } from "@/features/auth/components/sign-up-steps/gender-step"
import { GuidelinesStep } from "@/features/auth/components/sign-up-steps/guidelines-step"
import { MiddleNameStep } from "@/features/auth/components/sign-up-steps/middle-name-step"
import { NameStep } from "@/features/auth/components/sign-up-steps/name-step"
import { PhoneStep } from "@/features/auth/components/sign-up-steps/phone-step"
import { ProofStep } from "@/features/auth/components/sign-up-steps/proof-step"
import { useSignUpForm } from "@/features/auth/hooks/use-sign-up-form"

interface SignUpFormProps extends React.ComponentProps<"div"> {
  onSignIn?: () => void
  onSuccess?: (user: AuthUser, access: string) => void
}

export function SignUpForm({
  className,
  onSignIn,
  onSuccess,
  ...props
}: SignUpFormProps) {
  const form = useSignUpForm({ onSuccess })
  const {
    step,
    goBack,
    goNext,
    continueFromAccountStep,
    skipMiddleName,
    progressPercent,
    errors,
    handleChange,
    handleSendEmailOtp,
    handleVerifyEmailOtp,
    editEmailFromOtp,
    handleSendPhoneOtp,
    handleVerifyPhoneOtp,
    editPhoneFromOtp,
    submitRegistration,
    isSubmitting,
    isSendingEmailOtp,
    isVerifyingEmailOtp,
    isSendingPhoneOtp,
    isVerifyingPhoneOtp,
    passwordStrength,
    emailOtpCooldownSeconds,
    phoneOtpSent,
    phoneOtpVerified,
    phoneOtpCooldownSeconds,
    setFieldError,
    checkEmailOnBlur,
    isCheckingEmail,
    submitError,
    values,
    proofOptions,
    proofOptionsLoading,
    refreshProofOptions,
    resolveCommunity,
    canCaptureProof,
    proofCaptureBlockedReason,
  } = form

  const [proofDetect, setProofDetect] = React.useState<ResidenceProofDetectResult | null>(null)
  const [termsDialogOpen, setTermsDialogOpen] = React.useState(false)
  const [termsStep, setTermsStep] = React.useState<"terms" | "privacy">("terms")
  const [termsScrolled, setTermsScrolled] = React.useState(false)
  const [privacyScrolled, setPrivacyScrolled] = React.useState(false)
  const termsBodyRef = React.useRef<HTMLDivElement>(null)
  const privacyBodyRef = React.useRef<HTMLDivElement>(null)
  const termsSentinelRef = React.useRef<HTMLSpanElement>(null)
  const privacySentinelRef = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (termsStep !== "terms" || !termsDialogOpen || !termsSentinelRef.current || !termsBodyRef.current)
      return
    setTermsScrolled(false)
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setTermsScrolled(true)
      },
      { root: termsBodyRef.current, threshold: 0 },
    )
    observer.observe(termsSentinelRef.current)
    return () => observer.disconnect()
  }, [termsStep, termsDialogOpen])

  React.useEffect(() => {
    if (
      termsStep !== "privacy" ||
      !termsDialogOpen ||
      !privacySentinelRef.current ||
      !privacyBodyRef.current
    )
      return
    setPrivacyScrolled(false)
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setPrivacyScrolled(true)
      },
      { root: privacyBodyRef.current, threshold: 0 },
    )
    observer.observe(privacySentinelRef.current)
    return () => observer.disconnect()
  }, [termsStep, termsDialogOpen])

  React.useEffect(() => {
    if (termsStep === "privacy" && privacyBodyRef.current) {
      requestAnimationFrame(() => privacyBodyRef.current?.scrollTo(0, 0))
    }
  }, [termsStep])

  function openTermsDialog(start: "terms" | "privacy" = "terms") {
    setTermsStep(start)
    setTermsScrolled(false)
    setPrivacyScrolled(false)
    setTermsDialogOpen(true)
  }

  async function handleAccountContinue() {
    // email/password → send OTP → email OTP step only (never skip to name).
    await continueFromAccountStep()
  }

  function handleRequestAgree() {
    // Checkbox cannot be checked until user finishes Terms → Privacy scroll flow.
    openTermsDialog("terms")
  }

  const showProgress = step > 0
  // Back on OTP returns to email/password (same as "Edit your email").
  // Nothing goes back once the document is verified: the proof step (7) is the
  // last point where anything upstream of the verification can still change,
  // so from the phone step onward the control stays visible but disabled
  // instead of disappearing, so the wizard header does not jump around.
  const showBack = step > 0
  const backDisabled = step >= 8
  // Full-width layout no longer needed (verified peek no longer has a left carousel).
  const wideContent = false
  const shellVariant = step === 0 ? "account" : "wizard"

  return (
    <div className={cn("w-full", className)} {...props}>
      <SignUpShell
        onSignIn={onSignIn}
        showProgress={showProgress}
        progressPercent={progressPercent}
        showBack={showBack}
        backDisabled={backDisabled}
        onBack={step === 1 ? editEmailFromOtp : goBack}
        scrollKey={step}
        wideContent={wideContent}
        variant={shellVariant}
      >
        {step === 0 ? (
          <AccountStep
            values={values}
            errors={errors}
            passwordStrength={passwordStrength}
            isCheckingEmail={isCheckingEmail}
            onChange={handleChange}
            onEmailBlur={() => void checkEmailOnBlur()}
            onContinue={() => void handleAccountContinue()}
            onOpenPrivacy={() => openTermsDialog("privacy")}
            onOpenTerms={() => openTermsDialog("terms")}
            onRequestAgree={handleRequestAgree}
            isContinuing={isSendingEmailOtp}
          />
        ) : null}

        {step === 1 ? (
          <EmailOtpStep
            code={values.emailOtpCode ?? ""}
            errors={errors}
            isSending={isSendingEmailOtp}
            isVerifying={isVerifyingEmailOtp}
            cooldownSeconds={emailOtpCooldownSeconds}
            onCodeChange={(code) => {
              handleChange("emailOtpCode", code)
              // Changing the code invalidates a prior successful verify.
            }}
            onResend={() => void handleSendEmailOtp()}
            onEditEmail={editEmailFromOtp}
            onSubmit={() => void handleVerifyEmailOtp()}
          />
        ) : null}

        {step === 2 ? (
          <NameStep
            values={values}
            errors={errors}
            onChange={handleChange}
            onContinue={() => goNext()}
          />
        ) : null}

        {step === 3 ? (
          <MiddleNameStep
            values={values}
            errors={errors}
            onChange={handleChange}
            onContinue={() => goNext()}
            onSkip={skipMiddleName}
          />
        ) : null}

        {step === 4 ? (
          <GenderStep
            values={values}
            errors={errors}
            onChange={handleChange}
            onContinue={() => goNext()}
          />
        ) : null}

        {step === 5 ? (
          <DobStep
            values={values}
            errors={errors}
            onChange={handleChange}
            onContinue={() => goNext()}
          />
        ) : null}

        {step === 6 ? (
          <AddressStep
            values={values}
            errors={errors}
            resolving={proofOptionsLoading}
            onChange={handleChange}
            onResolve={resolveCommunity}
            onContinue={() => goNext()}
          />
        ) : null}

        {step === 7 ? (
          <ProofStep
            key={values.communityResolutionToken}
            values={values}
            errors={errors}
            proofOptions={proofOptions}
            proofOptionsLoading={proofOptionsLoading}
            canCaptureProof={canCaptureProof}
            proofCaptureBlockedReason={proofCaptureBlockedReason}
            onChange={handleChange}
            onSetFieldError={setFieldError}
            onRefreshProofOptions={refreshProofOptions}
            onContinue={() => goNext()}
            proofDetect={proofDetect}
            onProofDetectChange={setProofDetect}
          />
        ) : null}

        {step === 8 ? (
          <PhoneStep
            values={values}
            errors={errors}
            phoneOtpSent={phoneOtpSent}
            phoneOtpVerified={phoneOtpVerified}
            phoneOtpCooldownSeconds={phoneOtpCooldownSeconds}
            isSendingPhoneOtp={isSendingPhoneOtp}
            isVerifyingPhoneOtp={isVerifyingPhoneOtp}
            onChange={handleChange}
            onSendOtp={() => void handleSendPhoneOtp()}
            onVerifyOtp={() => void handleVerifyPhoneOtp()}
            onEditPhone={editPhoneFromOtp}
            onContinue={() => goNext()}
          />
        ) : null}

        {step === 9 ? (
          <CommunityPeekStep
            communityName={values.communityMatch?.name ?? "your community"}
            neighbors={values.communityMatch?.neighbors ?? 0}
            latitude={values.homeLatitude}
            longitude={values.homeLongitude}
            onContinue={() => void goNext()}
          />
        ) : null}

        {step === 10 ? (
          <GuidelinesStep
            firstName={values.firstName}
            isSubmitting={isSubmitting}
            submitError={submitError}
            onUnderstand={() => void submitRegistration()}
          />
        ) : null}

        {submitError && step !== 10 ? (
          <FieldError className="mt-4 justify-center text-center">{submitError}</FieldError>
        ) : null}
      </SignUpShell>

      <Dialog open={termsDialogOpen} onOpenChange={setTermsDialogOpen}>
        <DialogContent className="overflow-hidden rounded-t-3xl border-0 bg-white shadow-xl sm:rounded-3xl">
          <DialogHeader className="rounded-t-3xl border-0 border-none bg-white sm:rounded-t-3xl">
            <DialogTitle>
              {termsStep === "terms" ? "Terms of Service" : "Privacy Policy"}
            </DialogTitle>
          </DialogHeader>
          {termsStep === "terms" ? (
            <>
              <DialogBody
                ref={termsBodyRef}
                className={cn(
                  "bg-white",
                  // Keep scroll for “must read” gate, hide the scrollbar visually
                  "overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
                )}
              >
                <div className="space-y-4 text-sm text-muted-foreground">
                  <h3 className="font-semibold text-foreground">1. Acceptance of Terms</h3>
                  <p>
                    By registering and using E-Boses, you agree to be bound by these Terms of
                    Service. If you do not agree, you may not use the platform.
                  </p>

                  <h3 className="font-semibold text-foreground">2. Description of Service</h3>
                  <p>
                    E-Boses is a web-based, mobile-responsive barangay civic engagement platform
                    that enables verified residents to submit community concerns with photo
                    documentation and GPS location data, send GPS-tagged emergency alerts to
                    barangay first responders, and monitor resolution status through official
                    tracking numbers.
                  </p>

                  <h3 className="font-semibold text-foreground">3. User Eligibility and Registration</h3>
                  <p>
                    You must be a verified resident of an active E-Boses community, at least 18 years
                    of age, and not have an existing account with the system. Registration requires
                    the submission of personal information, OTP verification, and a valid
                    government-issued ID for identity verification.
                  </p>

                  <h3 className="font-semibold text-foreground">4. User Responsibilities</h3>
                  <p>
                    You agree to provide accurate and truthful information when submitting concern
                    reports or emergency alerts. You must not submit fake, irrelevant, duplicate,
                    edited, manipulated, or AI-generated content.
                  </p>

                  <h3 className="font-semibold text-foreground">5. Account Termination</h3>
                  <p>
                    The barangay reserves the right to suspend or terminate accounts found to be in
                    violation of these terms.
                  </p>

                  <h3 className="font-semibold text-foreground">6. Limitation of Liability</h3>
                  <p>
                    E-Boses is provided as a tool to assist barangay governance and emergency
                    coordination. The barangay does not guarantee immediate response to every report
                    or alert.
                  </p>
                  <span ref={termsSentinelRef} />
                </div>
              </DialogBody>
              <DialogFooter className="flex-col gap-2 border-0 border-none bg-white sm:flex-col">
                <Button
                  type="button"
                  className="h-12 w-full rounded-full text-base font-semibold shadow-none"
                  disabled={!termsScrolled}
                  onClick={() => {
                    setTermsStep("privacy")
                    setPrivacyScrolled(false)
                  }}
                >
                  Next
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogBody
                ref={privacyBodyRef}
                className={cn(
                  "bg-white",
                  "overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
                )}
              >
                <div className="space-y-4 text-sm text-muted-foreground">
                  <h3 className="font-semibold text-foreground">1. Data Collection</h3>
                  <p>
                    E-Boses collects personal information necessary for identity verification and
                    platform functionality, including your full name, email address or phone number,
                    barangay of residence, uploaded government-issued ID for verification, submitted
                    concern reports with photos and GPS location, and emergency alert data.
                  </p>

                  <h3 className="font-semibold text-foreground">2. Legal Basis</h3>
                  <p>
                    All data collection and processing is conducted in compliance with Republic Act
                    No. 10173, also known as the Data Privacy Act of 2012.
                  </p>

                  <h3 className="font-semibold text-foreground">3. Use of Information</h3>
                  <p>
                    Your data is used exclusively for platform operations, including identity
                    verification, processing of concern reports, and routing of emergency alerts to
                    appropriate barangay responders.
                  </p>

                  <h3 className="font-semibold text-foreground">4. Data Access and Role-Based Control</h3>
                  <p>
                    Access to your data is governed by Role-Based Access Control (RBAC). No data is
                    disclosed to third parties, external government agencies, or private
                    organizations without legal basis.
                  </p>

                  <h3 className="font-semibold text-foreground">5. Your Rights</h3>
                  <p>
                    You retain the right to request the deletion of your account and associated data
                    at any time. Participation is entirely voluntary.
                  </p>
                  <span ref={privacySentinelRef} />
                </div>
              </DialogBody>
              <DialogFooter className="flex-col gap-2 border-0 border-none bg-white sm:flex-col">
                <Button
                  type="button"
                  className="h-12 w-full rounded-full text-base font-semibold shadow-none"
                  disabled={!privacyScrolled}
                  onClick={() => {
                    handleChange("agreeToTerms", true)
                    setFieldError("agreeToTerms", undefined)
                    setTermsDialogOpen(false)
                  }}
                >
                  Agree
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
