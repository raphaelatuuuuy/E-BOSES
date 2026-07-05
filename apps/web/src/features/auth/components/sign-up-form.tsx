"use client"

import * as React from "react"
import { CheckIcon, FileImageIcon, FileTextIcon, InfoIcon, LoaderCircleIcon, XIcon, CheckCircleIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { useSignUpForm } from "@/features/auth/hooks/use-sign-up-form"
import { checkRegistrationProof, type AuthUser } from "@/features/auth/api"
import {
  getLatestAllowedBirthDate,
  getProofOfResidencyFileError,
} from "@/features/auth/schemas/sign-up-schema"
import { ApiError } from "@/lib/api"

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
  const {
    errors,
    handleChange,
    handleSendPhoneOtp,
    handleSubmit,
    handleVerifyPhoneOtp,
    isSendingPhoneOtp,
    isSubmitting,
    isVerifyingPhoneOtp,
    passwordStrength,
    phoneOtpCooldownSeconds,
    phoneOtpSent,
    phoneOtpVerified,
    setFieldError,
    submitError,
    values,
  } =
    useSignUpForm({ onSuccess })

  const [dateOpen, setDateOpen] = React.useState(false)
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>()
  const firstBirthMonth = React.useMemo(() => new Date(1900, 0), [])
  const lastAllowedBirthDate = React.useMemo(() => getLatestAllowedBirthDate(), [])
  const lastBirthMonth = React.useMemo(
    () => new Date(lastAllowedBirthDate.getFullYear(), lastAllowedBirthDate.getMonth()),
    [lastAllowedBirthDate],
  )
  const [isCheckingProof, setIsCheckingProof] = React.useState(false)
  async function proofFileDigest(file: File) {
    const buffer = await file.arrayBuffer()
    const digest = await crypto.subtle.digest("SHA-256", buffer)
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])

    if (files.length === 0) {
      return
    }

    const nextFiles = [...values.proofOfResidency]
    const invalidFiles: string[] = []
    const selectedFileDigests = new Map<string, File>()

    for (const currentFile of nextFiles) {
      selectedFileDigests.set(await proofFileDigest(currentFile), currentFile)
    }

    setIsCheckingProof(true)
    for (const file of files) {
      if (nextFiles.length >= 2) {
        invalidFiles.push("You can upload a maximum of 2 files.")
        break
      }

      const error = getProofOfResidencyFileError(file)

      if (error) {
        invalidFiles.push(`${file.name}: ${error}`)
        continue
      }

      const alreadySelected = nextFiles.some(
        (currentFile) =>
          currentFile.name === file.name &&
          currentFile.size === file.size &&
          currentFile.lastModified === file.lastModified,
      )

      if (alreadySelected) {
        const duplicateFile = nextFiles.find(
          (currentFile) =>
            currentFile.name === file.name &&
            currentFile.size === file.size &&
            currentFile.lastModified === file.lastModified,
        )
        if (duplicateFile) {
          invalidFiles.push("Duplicate file upload.")
        }
        continue
      }

      const digest = await proofFileDigest(file)
      const duplicateFile = selectedFileDigests.get(digest)
      if (duplicateFile) {
        invalidFiles.push("Duplicate file upload.")
        continue
      }

      const formData = new FormData()
      for (const proofFile of [...nextFiles, file]) {
        formData.append("proof", proofFile)
      }

      try {
        await checkRegistrationProof(formData)
      } catch (error) {
        invalidFiles.push(
          error instanceof ApiError
            ? error.message
            : "File could not be checked.",
        )
        continue
      }

      selectedFileDigests.set(digest, file)
      nextFiles.push(file)
    }

    setIsCheckingProof(false)
    e.target.value = ""

    if (invalidFiles[0]) {
      handleChange("proofOfResidency", nextFiles)
      setFieldError("proofOfResidency", invalidFiles[0])
      return
    }
    handleChange("proofOfResidency", nextFiles)
    setFieldError("proofOfResidency", undefined)
  }

  function removeAttachment(index: number) {
    const nextFiles = values.proofOfResidency.filter((_, i) => i !== index)

    handleChange("proofOfResidency", nextFiles)
    setFieldError(
      "proofOfResidency",
      nextFiles.length === 0
        ? "Upload at least one valid government-issued ID or bill."
        : undefined,
    )
  }

  function formatFileSize(size: number) {
    if (size < 1024 * 1024) {
      return `${Math.ceil(size / 1024)} KB`
    }

    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  function getAttachmentTypeLabel(file: File) {
    const extension = file.name.split(".").pop()?.toUpperCase()
    return extension === "PDF" ? "PDF document" : `${extension ?? "Image"} image`
  }

  function formatSelectedDate(date: Date) {
    const m = String(date.getMonth() + 1).padStart(2, "0")
    const d = String(date.getDate()).padStart(2, "0")
    const y = String(date.getFullYear()).slice(-2)
    return `${m}/${d}/${y}`
  }

  function sanitizeName(value: string) {
    return value.replace(/[^A-Za-zÑñ ]/g, "")
  }

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
        <div className="mt-4 flex flex-col items-start gap-0">
          <h1 className="text-2xl font-bold">Create an account</h1>
          <p className="text-sm text-muted-foreground">
            Fill in the details below to get started
          </p>
        </div>

        <div className="h-1" />

        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            value={values.email}
            onChange={(e) => handleChange("email", e.target.value)}
            aria-invalid={Boolean(errors.email)}
            placeholder="juan@example.com"
            required
          />
          {errors.email ? <FieldError>{errors.email}</FieldError> : null}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="firstName">First name</FieldLabel>
            <Input
              id="firstName"
              type="text"
              value={values.firstName}
              onChange={(e) => handleChange("firstName", sanitizeName(e.target.value))}
              aria-invalid={Boolean(errors.firstName)}
              placeholder="Juan"
              required
            />
            {errors.firstName ? <FieldError>{errors.firstName}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="middleName">Middle name</FieldLabel>
            <Input
              id="middleName"
              type="text"
              value={values.middleName}
              onChange={(e) => handleChange("middleName", sanitizeName(e.target.value))}
              aria-invalid={Boolean(errors.middleName)}
              placeholder="Dela Cruz"
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="lastName">Last name</FieldLabel>
          <Input
            id="lastName"
            type="text"
            value={values.lastName}
            onChange={(e) => handleChange("lastName", sanitizeName(e.target.value))}
            aria-invalid={Boolean(errors.lastName)}
            placeholder="Santos"
            required
          />
          {errors.lastName ? <FieldError>{errors.lastName}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="date">Date of birth</FieldLabel>
          <div className="relative">
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger className="w-full">
                <span
                  className={cn(
                    "border-input bg-white flex h-9 w-full items-center rounded-md border px-3 py-1 text-base shadow-xs",
                    selectedDate ? "text-foreground" : "text-muted-foreground",
                    errors.dateOfBirth
                      ? "border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.15)]"
                      : "focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_rgba(255,129,51,0.15)]",
                  )}
                  aria-invalid={Boolean(errors.dateOfBirth)}
                >
                  {selectedDate ? formatSelectedDate(selectedDate) : "Select date"}
                </span>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  defaultMonth={selectedDate}
                  captionLayout="dropdown"
                  startMonth={firstBirthMonth}
                  endMonth={lastBirthMonth}
                  disabled={{ after: lastAllowedBirthDate }}
                  className="bg-white"
                  onSelect={(date) => {
                    setSelectedDate(date)
                    if (date) {
                      handleChange("dateOfBirth", date.toISOString().split("T")[0])
                    }
                    setDateOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          {errors.dateOfBirth ? <FieldError>{errors.dateOfBirth}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="address">Address</FieldLabel>
          <Input
            id="address"
            type="text"
            value={values.address}
            onChange={(e) => handleChange("address", e.target.value)}
            aria-invalid={Boolean(errors.address)}
            placeholder="123 Barangay Street"
            required
          />
          {errors.address ? <FieldError>{errors.address}</FieldError> : null}
        </Field>

        {/* Gender + Avatar */}
        <div className="flex flex-col gap-3">
          <FieldLabel>Gender</FieldLabel>
          <div className="flex gap-3">
            {["male", "female", "prefer_not_to_say"].map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  handleChange("gender", g)
                  // auto-assign avatar based on gender + dateOfBirth
                  if (values.dateOfBirth && g !== "prefer_not_to_say") {
                    const birth = new Date(values.dateOfBirth)
                    const age = new Date().getFullYear() - birth.getFullYear()
                    const base = g === "male" ? "man" : "woman"
                    const type = age >= 55 ? "senior" : age >= 30 ? "middleaged" : "young"
                    handleChange("avatar", `${type}-${base}`)
                  }
                }}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                  values.gender === g
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input bg-white text-muted-foreground hover:border-primary"
                }`}
              >
                {g === "male" ? "Male" : g === "female" ? "Female" : "Prefer not to say"}
              </button>
            ))}
          </div>
          {errors.gender ? <FieldError>{errors.gender}</FieldError> : null}

          {values.gender && values.gender !== "prefer_not_to_say" && (
            <>
              <FieldLabel>Avatar</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {["young", "middleaged", "senior"].map((age) => {
                  const icon = values.gender === "male" ? "man" : "woman"
                  const key = `${age}-${icon}`
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleChange("avatar", key)}
                      className={`relative size-16 overflow-hidden rounded-full border-2 transition-all ${
                        values.avatar === key
                          ? "border-primary shadow-[0_0_0_3px_rgba(255,129,51,0.3)]"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <img src={`/contents/${key}.png`} alt={key} className="h-full w-full object-cover" />
                      {values.avatar === key && (
                        <span className="absolute bottom-0 right-0">
                          <CheckCircleIcon className="size-4 fill-primary text-white" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <Field>
          <div className="flex items-center gap-1.5">
            <FieldLabel htmlFor="proofOfResidency">Proof of residency</FieldLabel>
            <HoverCard>
              <HoverCardTrigger
                className="flex size-4 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Proof of residency requirements"
              >
                <InfoIcon className="size-4" />
              </HoverCardTrigger>
              <HoverCardContent>
                <p className="mb-2 text-xs font-medium text-foreground">Make sure the following are clearly visible:</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li className="flex items-start gap-1.5">
                    <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground" />
                    Name (must match the name entered above)
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground" />
                    Address
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground" />
                    Document must be valid and not expired
                  </li>
                </ul>
              </HoverCardContent>
            </HoverCard>
          </div>
          <label
            htmlFor="proofOfResidency"
            className={cn(
              "flex h-auto cursor-pointer items-center gap-2 rounded-md border border-input bg-white px-3 py-2 text-sm text-muted-foreground shadow-xs",
              errors.proofOfResidency &&
                "border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.15)]",
            )}
          >
            <Input
              id="proofOfResidency"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              multiple
              onChange={handleFileUpload}
              className="sr-only"
              aria-invalid={Boolean(errors.proofOfResidency)}
            />
            {values.proofOfResidency.length > 0
              ? isCheckingProof
                ? "Checking files..."
                : `${values.proofOfResidency.length} / 2 files selected`
              : "Upload files (max. 2)"}
          </label>
          {values.proofOfResidency.length > 0 && (
            <div className="grid w-full gap-2">
              {values.proofOfResidency.map((file, i) => (
                <div
                  key={`${file.name}-${file.lastModified}-${i}`}
                  className="flex w-full items-start gap-3 overflow-hidden rounded-lg border border-border bg-white p-3 shadow-xs"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                    {file.type === "application/pdf" ? (
                      <FileTextIcon className="size-4" />
                    ) : (
                      <FileImageIcon className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {file.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{formatFileSize(file.size)}</span>
                      <span className="hidden sm:inline">•</span>
                      <span>{getAttachmentTypeLabel(file)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="my-auto flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={`Remove ${file.name}`}
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {isCheckingProof ? (
            <FieldDescription>Checking proof upload...</FieldDescription>
          ) : errors.proofOfResidency ? (
            <FieldError>{errors.proofOfResidency}</FieldError>
          ) : (
            <FieldDescription>
              Upload 1-2 government-issued IDs or bills (PDF, PNG, or JPG). Max 2 MB each.
            </FieldDescription>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor="phoneNumber">Phone number</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="phoneNumber"
              type="tel"
              value={values.phoneNumber}
              disabled={phoneOtpVerified || phoneOtpCooldownSeconds > 0}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "")
                const formatted = digits.startsWith("63") ? "+" + digits.slice(0, 12) : digits ? "+63" + digits.slice(0, 10) : ""
                handleChange("phoneNumber", formatted)
              }}
              aria-invalid={Boolean(errors.phoneNumber)}
              placeholder="(+63) 982 928 9283"
              required
            />
            <Button
              type="button"
              className="shrink-0"
              onClick={handleSendPhoneOtp}
              disabled={isSendingPhoneOtp || phoneOtpVerified || phoneOtpCooldownSeconds > 0}
            >
              {isSendingPhoneOtp ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : phoneOtpVerified ? (
                <CheckIcon className="size-4" />
              ) : null}
              {phoneOtpVerified
                ? "Verified"
                : phoneOtpCooldownSeconds > 0
                  ? `Resend ${phoneOtpCooldownSeconds}s`
                  : phoneOtpSent
                    ? "Resend"
                    : "Send code"}
            </Button>
          </div>
          {errors.phoneNumber ? <FieldError>{errors.phoneNumber}</FieldError> : null}
        </Field>

        {phoneOtpSent && !phoneOtpVerified ? (
          <Field>
            <FieldLabel htmlFor="phoneOtpCode">SMS code</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="phoneOtpCode"
                inputMode="numeric"
                maxLength={6}
                value={values.phoneOtpCode ?? ""}
                onChange={(e) => handleChange("phoneOtpCode", e.target.value.replace(/\D/g, "").slice(0, 6))}
                aria-invalid={Boolean(errors.phoneOtpCode)}
                placeholder="6-digit code"
              />
              <Button
                type="button"
                className="shrink-0"
                onClick={handleVerifyPhoneOtp}
                disabled={isVerifyingPhoneOtp}
              >
                {isVerifyingPhoneOtp ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : null}
                Verify
              </Button>
            </div>
            {errors.phoneOtpCode ? (
              <FieldError>{errors.phoneOtpCode}</FieldError>
            ) : (
              <FieldDescription>Enter the SMS code sent to your phone.</FieldDescription>
            )}
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            value={values.password}
            onChange={(e) => handleChange("password", e.target.value)}
            aria-invalid={Boolean(errors.password)}
            required
          />
          {values.password.length > 0 ? (
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-1">
                {Array.from({ length: passwordStrength.max }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1 rounded-full bg-muted transition-colors",
                      i < passwordStrength.score &&
                        (passwordStrength.score <= 2
                          ? "bg-destructive"
                          : passwordStrength.score <= 4
                            ? "bg-amber-500"
                            : "bg-primary"),
                    )}
                  />
                ))}
              </div>
              <FieldDescription>
                Use 8+ characters with uppercase, lowercase, number, and special character.
              </FieldDescription>
            </div>
          ) : null}
          {errors.password ? <FieldError>{errors.password}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
          <Input
            id="confirmPassword"
            type="password"
            value={values.confirmPassword}
            onChange={(e) => handleChange("confirmPassword", e.target.value)}
            aria-invalid={Boolean(errors.confirmPassword)}
            required
          />
          {errors.confirmPassword ? <FieldError>{errors.confirmPassword}</FieldError> : null}
        </Field>

        <Field>
          <Button type="submit" className="w-full" disabled={isSubmitting || isCheckingProof}>
            {isSubmitting ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
            {isSubmitting ? "Creating account" : "Sign up"}
          </Button>
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={values.agreeToTerms}
            onChange={(event) => handleChange("agreeToTerms", event.target.checked)}
            className="mt-0.5"
            aria-invalid={Boolean(errors.agreeToTerms)}
          />
          <span className={cn("text-muted-foreground", errors.agreeToTerms && "text-destructive")}>
            By signing up, you agree to our{" "}
            <Dialog>
              <DialogTrigger className="text-primary underline underline-offset-2 cursor-pointer">Terms of Service</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Terms of Service</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <div className="space-y-4 text-sm text-muted-foreground">
                    <h3 className="font-semibold text-foreground">1. Acceptance of Terms</h3>
                    <p>By registering and using E-Boses, you agree to be bound by these Terms of Service. If you do not agree, you may not use the platform.</p>

                    <h3 className="font-semibold text-foreground">2. Description of Service</h3>
                    <p>E-Boses is a web-based, mobile-responsive barangay civic engagement platform that enables verified residents to submit community concerns with photo documentation and GPS location data, send GPS-tagged emergency alerts to barangay first responders, and monitor resolution status through official tracking numbers.</p>

                    <h3 className="font-semibold text-foreground">3. User Eligibility and Registration</h3>
                    <p>You must be a verified resident of the barangay served by the platform, at least 18 years of age, and not have an existing account with the system. Registration requires the submission of personal information, OTP verification, and a valid government-issued ID for identity verification. Accounts are subject to review and may be rejected if uploaded IDs are found to be edited, manipulated, AI-generated, duplicated, unreadable, or suspicious.</p>

                    <h3 className="font-semibold text-foreground">4. User Responsibilities</h3>
                    <p>You agree to provide accurate and truthful information when submitting concern reports or emergency alerts. You must not submit fake, irrelevant, duplicate, edited, manipulated, or AI-generated content. You must not submit reports with false or spoofed GPS locations. You must not misuse the emergency alert system by sending false alarms.</p>

                    <h3 className="font-semibold text-foreground">5. Account Termination</h3>
                    <p>The barangay reserves the right to suspend or terminate accounts found to be in violation of these terms, including but not limited to submission of fraudulent reports, misuse of the emergency alert system, or attempting to access data outside your role-based permissions.</p>

                    <h3 className="font-semibold text-foreground">6. Limitation of Liability</h3>
                    <p>E-Boses is provided as a tool to assist barangay governance and emergency coordination. The barangay does not guarantee immediate response to every report or alert. AI-generated severity scores and assessments are advisory in nature and subject to review by barangay officials. The platform is accessible via standard web browsers and requires internet connectivity; performance may vary depending on network conditions.</p>
                  </div>
                </DialogBody>
                <DialogFooter>
                  <DialogClose />
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {" and "}
            <Dialog>
              <DialogTrigger className="text-primary underline underline-offset-2 cursor-pointer">Privacy Policy</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Privacy Policy</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <div className="space-y-4 text-sm text-muted-foreground">
                    <h3 className="font-semibold text-foreground">1. Data Collection</h3>
                    <p>E-Boses collects personal information necessary for identity verification and platform functionality, including your full name, email address or phone number, barangay of residence, uploaded government-issued ID for verification, submitted concern reports with photos and GPS location, and emergency alert data including location and optional media.</p>

                    <h3 className="font-semibold text-foreground">2. Legal Basis</h3>
                    <p>All data collection and processing is conducted in compliance with Republic Act No. 10173, also known as the Data Privacy Act of 2012. Your consent is obtained through an explicit acknowledgment before you may proceed with registration.</p>

                    <h3 className="font-semibold text-foreground">3. Use of Information</h3>
                    <p>Your data is used exclusively for platform operations, including identity verification through OTP and ID validation, processing and tracking of concern reports, routing of emergency alerts to appropriate barangay responders (BHW, BDRRMO, or barangay tanods), AI-based analysis of submitted photos and text for severity scoring and relevance checking, and community witness notifications during emergencies.</p>

                    <h3 className="font-semibold text-foreground">4. Data Access and Role-Based Control</h3>
                    <p>Access to your data is governed by Role-Based Access Control (RBAC). Residents may only view their own submitted reports. Barangay officials may access all reports within their jurisdiction. First responders may only view emergency alerts assigned to their role. System administrators are restricted to technical logs. No data is disclosed to third parties, external government agencies, or private organizations.</p>

                    <h3 className="font-semibold text-foreground">5. Media and Privacy Protection</h3>
                    <p>Uploaded photos or media containing faces, license plates, injuries, or other personally identifiable information are subject to privacy blurring, restricted access, and consent-based controls. Raw media access is limited to authorized barangay personnel only.</p>

                    <h3 className="font-semibold text-foreground">6. Data Security</h3>
                    <p>All personal and location data is secured during transmission and storage using HTTPS/TLS encryption. Records are stored in cloud-based storage with automated daily backups to ensure data persistence and availability.</p>

                    <h3 className="font-semibold text-foreground">7. Your Rights</h3>
                    <p>You retain the right to request the deletion of your account and associated data at any time. Participation is entirely voluntary, and declining or withdrawing does not affect your access to barangay services. You may request access to your personal data held by the system.</p>

                    <h3 className="font-semibold text-foreground">8. Data Retention</h3>
                    <p>Records are retained for a period consistent with standard barangay record-management practice. After the retention period, records are disposed of in accordance with applicable regulations.</p>
                  </div>
                </DialogBody>
                <DialogFooter>
                  <DialogClose />
                </DialogFooter>
              </DialogContent>
            </Dialog>
            .
          </span>
        </label>
        {errors.agreeToTerms ? <FieldError>{errors.agreeToTerms}</FieldError> : null}
        <div className="h-1" />
        <p className="text-sm text-foreground text-center">
          Already have an account?{" "}
          <button
            type="button"
            onClick={onSignIn}
            className="font-medium underline underline-offset-2"
          >
            Sign in
          </button>
        </p>
        {submitError ? (
          <FieldError className="justify-center text-center">
            {submitError}
          </FieldError>
        ) : null}
      </form>
    </div>
  )
}
