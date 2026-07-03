import { type FormEvent, useMemo, useState } from "react"

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
  phoneNumber: "",
  phoneOtpCode: "",
  password: "",
  confirmPassword: "",
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
    }

    setErrors((currentErrors) => {
      if (!currentErrors[field]) {
        return currentErrors
      }

      return {
        ...currentErrors,
        [field]: undefined,
      }
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
      setFieldError("phoneOtpCode", undefined)
    } catch {
      setFieldError("phoneNumber", "Could not send SMS code. Check your number and try again.")
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
    } catch {
      setFieldError("phoneOtpCode", "Invalid or expired SMS code. Request a new one.")
    } finally {
      setIsVerifyingPhoneOtp(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const fieldErrors = flattenErrors(values)

    setErrors(fieldErrors)

    if (Object.keys(fieldErrors).length > 0) {
      setSubmitError("")
      return
    }

    if (!phoneOtpVerified) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        phoneOtpCode: "Verify the SMS code before signing up.",
      }))
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
        const proofError = (error.data as { proof?: unknown }).proof
        const proofMessage = Array.isArray(proofError) && typeof proofError[0] === "string"
          ? proofError[0]
          : undefined

        if (proofMessage) {
          setErrors((currentErrors) => ({
            ...currentErrors,
            proofOfResidency: proofMessage,
          }))
          return
        }
      }
      setSubmitError("Could not create account. Try again later.")
    } finally {
      setIsSubmitting(false)
    }
  }

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
    setFieldError,
    setValues,
    submitError,
    values,
  }
}
