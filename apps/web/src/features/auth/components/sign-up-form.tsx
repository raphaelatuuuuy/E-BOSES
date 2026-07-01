"use client"

import * as React from "react"
import { FileImageIcon, FileTextIcon, InfoIcon, XIcon } from "lucide-react"

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
import {
  getLatestAllowedBirthDate,
  getProofOfResidencyFileError,
} from "@/features/auth/schemas/sign-up-schema"

interface SignUpFormProps extends React.ComponentProps<"div"> {
  onSignIn?: () => void
  onSuccess?: (recipient: string) => void
}

export function SignUpForm({
  className,
  onSignIn,
  onSuccess,
  ...props
}: SignUpFormProps) {
  const { errors, handleChange, handleSubmit, setFieldError, statusMessage, values } =
    useSignUpForm({
      onSuccess: () => onSuccess?.(values.phoneNumber || "your registered mobile number"),
    })

  const [dateOpen, setDateOpen] = React.useState(false)
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>()
  const firstBirthMonth = React.useMemo(() => new Date(1900, 0), [])
  const lastAllowedBirthDate = React.useMemo(() => getLatestAllowedBirthDate(), [])
  const lastBirthMonth = React.useMemo(
    () => new Date(lastAllowedBirthDate.getFullYear(), lastAllowedBirthDate.getMonth()),
    [lastAllowedBirthDate],
  )

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])

    if (files.length === 0) {
      return
    }

    const nextFiles = [...values.proofOfResidency]
    const invalidFiles: string[] = []

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

      if (!alreadySelected) {
        nextFiles.push(file)
      }
    }

    handleChange("proofOfResidency", nextFiles)
    setFieldError("proofOfResidency", invalidFiles[0])
    e.target.value = ""
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

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="firstName">First name</FieldLabel>
            <Input
              id="firstName"
              type="text"
              value={values.firstName}
              onChange={(e) => handleChange("firstName", e.target.value)}
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
              onChange={(e) => handleChange("middleName", e.target.value)}
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
            onChange={(e) => handleChange("lastName", e.target.value)}
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
              ? `${values.proofOfResidency.length} / 2 files selected`
              : "Upload files (max. 2)"}
          </label>
          {values.proofOfResidency.length > 0 && (
            <div className="grid gap-2">
              {values.proofOfResidency.map((file, i) => (
                <div
                  key={`${file.name}-${file.lastModified}-${i}`}
                  className="flex items-start gap-3 rounded-lg border border-border bg-white p-3 shadow-xs"
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
          <FieldDescription
            className={cn(
              errors.proofOfResidency && "font-medium text-destructive",
            )}
          >
            Upload 1-2 government-issued IDs or bills (PDF, PNG, or JPG). Max 5 MB each.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="phoneNumber">Phone number</FieldLabel>
          <Input
            id="phoneNumber"
            type="tel"
            value={values.phoneNumber}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "")
              const formatted = digits.startsWith("63") ? "+" + digits.slice(0, 12) : digits ? "+63" + digits.slice(0, 10) : ""
              handleChange("phoneNumber", formatted)
            }}
            aria-invalid={Boolean(errors.phoneNumber)}
            placeholder="(+63) 982 928 9283"
            required
          />
          {errors.phoneNumber ? <FieldError>{errors.phoneNumber}</FieldError> : null}
        </Field>

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
          <Button type="submit" className="w-full">Sign up</Button>
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
        <p className="text-sm text-foreground">
          Already have an account?{" "}
          <button
            type="button"
            onClick={onSignIn}
            className="font-medium underline underline-offset-2"
          >
            Sign in
          </button>
        </p>
        {statusMessage ? (
          <FieldDescription className="text-center">
            {statusMessage}
          </FieldDescription>
        ) : null}
      </form>
    </div>
  )
}
