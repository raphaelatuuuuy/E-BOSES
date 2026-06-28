"use client"

import * as React from "react"
import { FileImageIcon, FileTextIcon, XIcon } from "lucide-react"

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
          <h1 className="text-xl font-bold">Create an account</h1>
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
                    "border-input bg-white flex h-9 w-full items-center rounded-none border px-3 py-1 text-base shadow-xs",
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
          <FieldDescription>
            Make sure the required information is visible on your uploaded proof
            of residency.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="proofOfResidency">Proof of residency</FieldLabel>
          <Input
            id="proofOfResidency"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            multiple
            onChange={handleFileUpload}
            className={cn(
              "h-auto rounded-none border border-input bg-white px-0 py-0 text-sm text-muted-foreground file:mr-3 file:border-0 file:border-r file:border-input file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-white focus-visible:shadow-none",
              errors.proofOfResidency &&
                "border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.15)] file:border-destructive/40",
            )}
            aria-invalid={Boolean(errors.proofOfResidency)}
          />
          {values.proofOfResidency.length > 0 && (
            <div className="grid gap-2">
              {values.proofOfResidency.map((file, i) => (
                <div
                  key={`${file.name}-${file.lastModified}-${i}`}
                  className="flex items-start gap-3 border border-border bg-white p-3 shadow-xs"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center border border-border bg-muted/40 text-muted-foreground">
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
                    className="flex size-8 shrink-0 items-center justify-center border border-border bg-white text-muted-foreground transition-colors hover:text-foreground"
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
            Upload at least one valid government-issued id or bill in pdf, png, or jpg formats only
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
          <span className="text-muted-foreground">
            By signing up, you agree to our <a href="#" className="text-primary underline underline-offset-2">Terms of Service</a>, and <a href="#" className="text-primary underline underline-offset-2">Privacy Policy</a>.
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
