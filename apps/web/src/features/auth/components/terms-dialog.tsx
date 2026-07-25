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
import { cn } from "@workspace/ui/lib/utils"
import type { SignUpValues } from "@/features/auth/schemas/sign-up-schema"

interface TermsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAgree: () => void
  onSetFieldError: (field: keyof SignUpValues | "street" | "houseNumber", error: string | undefined) => void
}

export function TermsDialog({
  open,
  onOpenChange,
  onAgree,
  onSetFieldError,
}: TermsDialogProps) {
  const [termsStep, setTermsStep] = React.useState<"terms" | "privacy">("terms")
  const [termsScrolled, setTermsScrolled] = React.useState(false)
  const [privacyScrolled, setPrivacyScrolled] = React.useState(false)
  const termsBodyRef = React.useRef<HTMLDivElement>(null)
  const privacyBodyRef = React.useRef<HTMLDivElement>(null)
  const termsSentinelRef = React.useRef<HTMLSpanElement>(null)
  const privacySentinelRef = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (termsStep !== "terms" || !open || !termsSentinelRef.current || !termsBodyRef.current)
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
  }, [termsStep, open])

  React.useEffect(() => {
    if (
      termsStep !== "privacy" ||
      !open ||
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
  }, [termsStep, open])

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setTermsStep("terms")
      setTermsScrolled(false)
      setPrivacyScrolled(false)
    }
  }

  function handleNext() {
    setTermsStep("privacy")
    setPrivacyScrolled(false)
    requestAnimationFrame(() => privacyBodyRef.current?.scrollTo(0, 0))
  }

  function handleAgree() {
    onAgree()
    onSetFieldError("agreeToTerms", undefined)
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
                  You must be a verified resident of Barangay Marikina Heights, at least 18 years
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
                onClick={handleNext}
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
                onClick={handleAgree}
              >
                Agree
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
