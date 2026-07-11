import { type FormEvent, useEffect, useMemo, useState } from "react"

import {
  registerResident,
  requestRegistrationPhoneOtp,
  type AuthUser,
  verifyRegistrationPhoneOtp,
} from "@/features/auth/api"
import {
  type SignUpErrors,
  type SignUpValues,
  signUpSchema,
} from "@/features/auth/schemas/sign-up-schema"
import { ApiError } from "@/lib/api"

const initialValues: SignUpValues = {
  email: "",
  firstName: "",
  middleName: "",
  lastName: "",
  dateOfBirth: "",
  address: "",
  proofOfResidency: [],
  proofType: "",
  phoneNumber: "",
  phoneOtpCode: "",
  password: "",
  confirmPassword: "",
  gender: "",
  avatar: "",
  agreeToTerms: false,
}

function flattenErrors(values: SignUpValues) {
  const parsed = signUpSchema.safeParse(values)

  if (parsed.success) {
    return {}
  }

  const flat = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>
  const result: Record<string, string | undefined> = {}
  for (const [key, messages] of Object.entries(flat)) {
    result[key] = messages?.[0]
  }
  return result
}

const PHONE_OTP_RESEND_COOLDOWN_SECONDS = 30

function firstErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = firstErrorMessage(item)
      if (message) {
        return message
      }
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const message = firstErrorMessage(item)
      if (message) {
        return message
      }
    }
  }
  return undefined
}

const backendFieldMap: Record<string, keyof SignUpValues> = {
  address: "address",
  barangay: "address",
  dateOfBirth: "dateOfBirth",
  date_of_birth: "dateOfBirth",
  email: "email",
  firstName: "firstName",
  first_name: "firstName",
  lastName: "lastName",
  last_name: "lastName",
  middle_name: "middleName",
  password: "password",
  phone_number: "phoneNumber",
  phone_otp_code: "phoneOtpCode",
  privacy_version: "agreeToTerms",
  proof: "proofOfResidency",
  proofOfResidency: "proofOfResidency",
  proofType: "proofType",
  terms_version: "agreeToTerms",
}

interface UseSignUpFormOptions {
  onSuccess?: (user: AuthUser, access: string) => void
}

export function useSignUpForm(options: UseSignUpFormOptions = {}) {
  const { onSuccess } = options
  const [values, setValues] = useState<SignUpValues>(initialValues)
  const [errors, setErrors] = useState<SignUpErrors>({})
  const [submitError, setSubmitError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [phoneOtpSent, setPhoneOtpSent] = useState(false)
  const [phoneOtpVerified, setPhoneOtpVerified] = useState(false)
  const [isSendingPhoneOtp, setIsSendingPhoneOtp] = useState(false)
  const [isVerifyingPhoneOtp, setIsVerifyingPhoneOtp] = useState(false)
  const passwordStrength = useMemo(() => {
    const checks = [
      values.password.length >= 8,
      /[A-Z]/.test(values.password),
      /[a-z]/.test(values.password),
      /[0-9]/.test(values.password),
      /[^A-Za-z0-9]/.test(values.password),
    ]
    const passed = checks.filter(Boolean).length
    return {
      score: passed,
      max: checks.length,
      percent: (passed / checks.length) * 100,
      checks,
    }
  }, [values.password])
  const [phoneOtpResendAvailableAt, setPhoneOtpResendAvailableAt] = useState<number | null>(null)
  const [phoneOtpCooldownSeconds, setPhoneOtpCooldownSeconds] = useState(0)
  const [ocrFields, setOcrFields] = useState<string[]>([])

  useEffect(() => {
    if (!phoneOtpResendAvailableAt) {
      setPhoneOtpCooldownSeconds(0)
      return
    }

    function updateCooldown() {
      const nextSeconds = Math.max(0, Math.ceil((phoneOtpResendAvailableAt - Date.now()) / 1000))
      setPhoneOtpCooldownSeconds(nextSeconds)
      if (nextSeconds === 0) {
        setPhoneOtpResendAvailableAt(null)
      }
    }

    updateCooldown()
    const timer = window.setInterval(updateCooldown, 1000)
    return () => window.clearInterval(timer)
  }, [phoneOtpResendAvailableAt])

  function handleChange<K extends keyof SignUpValues>(
    field: K,
    value: SignUpValues[K],
  ) {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }))
    setSubmitError("")
    if (field === "phoneNumber") {
      setPhoneOtpSent(false)
      setPhoneOtpVerified(false)
      setPhoneOtpResendAvailableAt(null)
      setPhoneOtpCooldownSeconds(0)
    }

    setErrors((currentErrors) => {
      const hasError = Boolean(currentErrors[field] || (field !== "proofOfResidency" && currentErrors["proofOfResidency"] && currentErrors[field]))
      if (!hasError && !currentErrors["proofOfResidency"]) {
        return currentErrors
      }
      const next = { ...currentErrors, [field]: undefined }
      // Clear proofOfResidency error when user edits any field (OCR feedback should go away)
      if (["firstName", "lastName", "dateOfBirth", "address", "proofType", "proofOfResidency"].includes(field)) {
        next["proofOfResidency"] = undefined
      }
      return next
    })
  }

  function setFieldError<K extends keyof SignUpValues>(
    field: K,
    message: string | undefined,
  ) {
    setErrors((currentErrors) => ({
      ...currentErrors,
      [field]: message,
    }))
  }

  async function handleSendPhoneOtp() {
    if (phoneOtpCooldownSeconds > 0) {
      setFieldError("phoneNumber", `Wait ${phoneOtpCooldownSeconds}s before requesting another code.`)
      return
    }

    const phoneError = signUpSchema.shape.phoneNumber.safeParse(values.phoneNumber)
    if (!phoneError.success) {
      setFieldError("phoneNumber", phoneError.error.issues[0]?.message ?? "Enter a valid phone number.")
      return
    }

    setIsSendingPhoneOtp(true)
    setSubmitError("")
    try {
      await requestRegistrationPhoneOtp({ phone_number: values.phoneNumber })
      setPhoneOtpSent(true)
      setPhoneOtpVerified(false)
      setPhoneOtpResendAvailableAt(Date.now() + PHONE_OTP_RESEND_COOLDOWN_SECONDS * 1000)
      setFieldError("phoneNumber", undefined)
      setFieldError("phoneOtpCode", undefined)
    } catch (error) {
      setFieldError(
        "phoneNumber",
        error instanceof ApiError
          ? error.message
          : "Could not send SMS code. Check your number and try again.",
      )
    } finally {
      setIsSendingPhoneOtp(false)
    }
  }

  async function handleVerifyPhoneOtp() {
    if (!/^\d{6}$/.test(values.phoneOtpCode ?? "")) {
      setFieldError("phoneOtpCode", "Enter the 6-digit SMS code.")
      return
    }

    setIsVerifyingPhoneOtp(true)
    setSubmitError("")
    try {
      await verifyRegistrationPhoneOtp({
        phone_number: values.phoneNumber,
        code: values.phoneOtpCode ?? "",
      })
      setPhoneOtpVerified(true)
      setFieldError("phoneOtpCode", undefined)
      setFieldError("phoneNumber", undefined)
    } catch {
      setFieldError("phoneOtpCode", "Invalid or expired SMS code. Request a new one.")
    } finally {
      setIsVerifyingPhoneOtp(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const fieldErrors = flattenErrors(values)
    const nextErrors: SignUpErrors = {
      ...fieldErrors,
      ...(!phoneOtpVerified
        ? {
            phoneNumber: "Phone number must be verified.",
            phoneOtpCode: undefined,
          }
        : {}),
    }

    setErrors(nextErrors)

    if (Object.values(nextErrors).some(Boolean)) {
      setSubmitError("")
      return
    }

    const formData = new FormData()
    formData.append("email", values.email)
    formData.append("phone_number", values.phoneNumber)
    formData.append("phone_otp_code", values.phoneOtpCode ?? "")
    formData.append("password", values.password)
    formData.append("first_name", values.firstName)
    formData.append("middle_name", values.middleName ?? "")
    formData.append("last_name", values.lastName)
    formData.append("date_of_birth", values.dateOfBirth)
    formData.append("address", values.address)
    formData.append("barangay", "Pending")
    if (values.gender) formData.append("gender", values.gender)
    if (values.avatar) formData.append("avatar", values.avatar)
    if (values.proofType) formData.append("proof_type", values.proofType)
    for (const proofFile of values.proofOfResidency) {
      formData.append("proof", proofFile)
    }
    formData.append("terms_version", "2026-07-02")
    formData.append("privacy_version", "2026-07-02")

    setIsSubmitting(true)
    setSubmitError("")
    try {
      const response = await registerResident(formData)
      onSuccess?.(response.user, response.access)
    } catch (error) {
      if (error instanceof ApiError && error.data && typeof error.data === "object") {
        const backendErrors = error.data as Record<string, unknown>
        const nextErrors: SignUpErrors = {}

        const ocrFieldSet = new Set(["firstName", "lastName", "dateOfBirth", "address", "proofType"])
        const ocrAffected: string[] = []
        for (const [backendField, value] of Object.entries(backendErrors)) {
          const formField = backendFieldMap[backendField]
          const message = firstErrorMessage(value)
          if (formField && message) {
            if (ocrFieldSet.has(formField)) {
              ocrAffected.push(formField)
              nextErrors["proofOfResidency"] = message
              // Set field error for red border, EXCEPT proofType (expiry)
              if (formField !== "proofType") {
                nextErrors[formField] = message
              }
            } else {
              nextErrors[formField] = message
            }
          }
        }
        setOcrFields(ocrAffected)

        const detailMessage = firstErrorMessage(backendErrors.detail)
        if (detailMessage) {
          const targetField = detailMessage.toLowerCase().includes("phone")
            || detailMessage.toLowerCase().includes("otp")
            ? "phoneOtpCode"
            : "email"
          nextErrors[targetField] = detailMessage
        }

        if (Object.keys(nextErrors).length > 0) {
          setErrors((currentErrors) => ({
            ...currentErrors,
            ...nextErrors,
          }))
          setSubmitError("")
          return
        }
      }
      setErrors((currentErrors) => ({
        ...currentErrors,
        email: "Could not create account. Try again later.",
      }))
      setSubmitError("")
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    errors,
    handleChange,
    handleSendPhoneOtp,
    handleSubmit,
    handleVerifyPhoneOtp,
    isSubmitting,
    isSendingPhoneOtp,
    isVerifyingPhoneOtp,
    passwordStrength,
    phoneOtpSent,
    phoneOtpVerified,
    phoneOtpCooldownSeconds,
    setFieldError,
    setValues,
    submitError,
    values,
    ocrFields,
  }
}
