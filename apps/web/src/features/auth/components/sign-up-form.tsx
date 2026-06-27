"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldError,
  FieldDescription,
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

interface SignUpFormProps extends React.ComponentProps<"div"> {
  onSignIn?: () => void
}

export function SignUpForm({
  className,
  onSignIn,
  ...props
}: SignUpFormProps) {
  const { errors, handleChange, handleSubmit, statusMessage, values } =
    useSignUpForm()

  const [dateOpen, setDateOpen] = React.useState(false)
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>()

  const [agree, setAgree] = React.useState(false)
  const [attachments, setAttachments] = React.useState<File[]>([])

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    const valid = files.filter((f) => {
      const isImage = f.type.startsWith("image/")
      const isPdf = f.type === "application/pdf"
      return (isImage || isPdf) && f.size <= 5 * 1024 * 1024
    })
    setAttachments((prev) => [...prev, ...valid])
    e.target.value = ""
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
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

        {/* Name fields */}
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

        {/* Date of birth */}
        <Field>
          <FieldLabel htmlFor="date">Date of birth</FieldLabel>
          <div className="relative">
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger className="w-full">
                <span
                  className={cn(
                    "border-input bg-white flex h-9 w-full items-center rounded-none border px-3 py-1 text-sm shadow-xs",
                    selectedDate ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {selectedDate
                    ? (() => {
                        const m = String(selectedDate.getMonth() + 1).padStart(2, "0")
                        const d = String(selectedDate.getDate()).padStart(2, "0")
                        const y = String(selectedDate.getFullYear()).slice(-2)
                        return `${m}/${d}/${y}`
                      })()
                    : "Select date"}
                </span>
              </PopoverTrigger>
              <PopoverContent className="w-auto overflow-hidden p-0">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  defaultMonth={selectedDate}
                  captionLayout="dropdown"
                  fromYear={1900}
                  toYear={new Date().getFullYear()}
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

        {/* Address */}
        <Field>
          <FieldLabel htmlFor="address">Address</FieldLabel>
          <Input
            id="address"
            type="text"
            value={values.address}
            onChange={(e) => handleChange("address", e.target.value)}
            aria-invalid={Boolean(errors.address)}
            placeholder="123 Barangay Street, City"
            required
          />
          {errors.address ? <FieldError>{errors.address}</FieldError> : null}
        </Field>

        {/* Proof of Residency */}
        <Field>
          <FieldLabel htmlFor="proofOfResidency">Proof of residency</FieldLabel>
          <Input
            id="proofOfResidency"
            type="file"
            accept="image/*,.pdf"
            multiple
            onChange={handleFileUpload}
            className="h-auto rounded-none border border-input bg-white px-3 py-1.5 text-sm file:mr-3 file:border-0 file:bg-transparent file:px-0 file:text-sm file:font-medium file:text-foreground"
          />
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((file, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-none border border-border bg-white px-2 py-1 text-xs">
                  <span className="max-w-24 truncate">{file.name}</span>
                  <span className="text-muted-foreground">
                    {(file.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="ml-1 text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <FieldDescription>Upload a government-issued ID or utility bill (max 5MB each).</FieldDescription>
        </Field>

        {/* Phone Number */}
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

        {/* Password */}
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

        {/* Confirm Password */}
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
            checked={agree}
            onChange={() => setAgree(!agree)}
            className="mt-0.5 accent-primary"
          />
          <span className="text-muted-foreground">
            By signing up, you agree to our{" "}
            <a href="#" className="text-primary underline underline-offset-2">Terms of Service</a>,{" "}
            and{" "}
            <a href="#" className="text-primary underline underline-offset-2">Privacy Policy</a>.
          </span>
        </label>
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
