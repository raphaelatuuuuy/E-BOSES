import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"

import {
  checkEmailAvailability,
  registerResident,
  requestRegistrationEmailOtp,
  requestRegistrationPhoneOtp,
  type AuthUser,
  verifyRegistrationEmailOtp,
  verifyRegistrationPhoneOtp,
} from "@/features/auth/api"
import { getPasswordStrength } from "@/features/auth/lib/password-requirements"
import { humanizeProofError } from "@/features/auth/lib/process-proof-file"
import { listResidenceProofOptions, type ResidenceProofOption } from "@/features/ocr/api"
import {
  type SignUpErrors,
  type SignUpStepIndex,
  type SignUpValues,
  SIGN_UP_STEP_COUNT,
  buildAddressFromParts,
  signUpSchema,
  validateSignUpStep,
} from "@/features/auth/schemas/sign-up-schema"
import { ApiError } from "@/lib/api"
import { toast } from "sonner"

const initialValues: SignUpValues = {
  email: "",
  emailOtpCode: "",
  firstName: "",
  middleName: "",
  lastName: "",
  dateOfBirth: "",
  street: "",
  houseNumber: "",
  address: "",
  proofOfResidency: [],
  proofType: "",
  phoneNumber: "",
  phoneOtpCode: "",
  password: "",
  gender: "",
  avatar: "",
  agreeToTerms: false,
}

/** Wait this long before the user can resend an email OTP. */
const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60


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

/** Wait this long before the user can resend an SMS or change their number. */
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
  email_otp_code: "emailOtpCode",
}

function computeAvatar(gender: string, dateOfBirth: string) {
  if (!dateOfBirth || !gender || gender === "prefer_not_to_say") return ""
  const birth = new Date(dateOfBirth)
  if (Number.isNaN(birth.getTime())) return ""
  const age = new Date().getFullYear() - birth.getFullYear()
  const base = gender === "male" ? "man" : "woman"
  const type = age >= 55 ? "senior" : age >= 30 ? "middleaged" : "young"
  return `${type}-${base}`
}

interface UseSignUpFormOptions {
  onSuccess?: (user: AuthUser, access: string) => void
}

export function useSignUpForm(options: UseSignUpFormOptions = {}) {
  const { onSuccess } = options
  const [step, setStep] = useState<SignUpStepIndex>(0)
  const [values, setValues] = useState<SignUpValues>(initialValues)
  const valuesRef = useRef(values)
  valuesRef.current = values
  const [errors, setErrors] = useState<SignUpErrors>({})
  const [submitError, setSubmitError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingEmail, setIsCheckingEmail] = useState(false)
  const emailCheckCacheRef = useRef<{ email: string; available: boolean } | null>(null)
  const [emailOtpSent, setEmailOtpSent] = useState(false)
  const [emailOtpVerified, setEmailOtpVerified] = useState(false)
  const emailOtpVerifiedRef = useRef(emailOtpVerified)
  emailOtpVerifiedRef.current = emailOtpVerified
  const [isSendingEmailOtp, setIsSendingEmailOtp] = useState(false)
  const [isVerifyingEmailOtp, setIsVerifyingEmailOtp] = useState(false)
  const [emailOtpResendAvailableAt, setEmailOtpResendAvailableAt] = useState<number | null>(null)
  const [emailOtpCooldownSeconds, setEmailOtpCooldownSeconds] = useState(0)
  const [phoneOtpSent, setPhoneOtpSent] = useState(false)
  const [phoneOtpVerified, setPhoneOtpVerified] = useState(false)
  const phoneOtpVerifiedRef = useRef(phoneOtpVerified)
  phoneOtpVerifiedRef.current = phoneOtpVerified
  const [isSendingPhoneOtp, setIsSendingPhoneOtp] = useState(false)
  const [isVerifyingPhoneOtp, setIsVerifyingPhoneOtp] = useState(false)
  const passwordStrength = useMemo(
    () => getPasswordStrength(values.password),
    [values.password],
  )
  const [phoneOtpResendAvailableAt, setPhoneOtpResendAvailableAt] = useState<number | null>(null)
  const [phoneOtpCooldownSeconds, setPhoneOtpCooldownSeconds] = useState(0)
  const [ocrFields, setOcrFields] = useState<string[]>([])
  const [proofOptions, setProofOptions] = useState<ResidenceProofOption[]>([])
  const [proofOptionsLoading, setProofOptionsLoading] = useState(true)
  const proofOptionsMounted = useRef(true)

  async function refreshProofOptions() {
    setProofOptionsLoading(true)
    let options: ResidenceProofOption[] = []
    let failed = false
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          options = await listResidenceProofOptions()
          break
        } catch {
          failed = true
          if (attempt >= 2 || !proofOptionsMounted.current) break
          await new Promise((resolve) => window.setTimeout(resolve, 1500 * (attempt + 1)))
        }
      }
      if (failed && import.meta.env.DEV) {
        console.warn("[sign-up] Failed to load residence proof options")
      }
      if (!proofOptionsMounted.current) return options
      setProofOptions(options)
      setValues((current) => {
        const stillValid = options.some((item) => item.key === current.proofType)
        return {
          ...current,
          proofType: stillValid ? current.proofType : options[0]?.key || "",
        }
      })
      return options
    } finally {
      if (proofOptionsMounted.current) setProofOptionsLoading(false)
    }
  }

  useEffect(() => {
    proofOptionsMounted.current = true
    const id = window.setTimeout(() => void refreshProofOptions(), 0)
    return () => {
      proofOptionsMounted.current = false
      window.clearTimeout(id)
    }
  }, [])

  // Reset the phone cooldown display whenever the resend window closes —
  // render-adjust instead of a sync setState at the top of the ticking effect.
  const [prevPhoneExpiry, setPrevPhoneExpiry] = useState(phoneOtpResendAvailableAt)
  if (prevPhoneExpiry !== phoneOtpResendAvailableAt) {
    setPrevPhoneExpiry(phoneOtpResendAvailableAt)
    if (!phoneOtpResendAvailableAt) setPhoneOtpCooldownSeconds(0)
  }

  useEffect(() => {
    const phoneExpiry = phoneOtpResendAvailableAt
    if (!phoneExpiry) return

    const updateCooldown = () => {
      const nextSeconds = Math.max(0, Math.ceil((phoneExpiry - Date.now()) / 1000))
      setPhoneOtpCooldownSeconds(nextSeconds)
      if (nextSeconds === 0) {
        setPhoneOtpResendAvailableAt(null)
      }
    }

    updateCooldown()
    const timer = window.setInterval(updateCooldown, 1000)
    return () => window.clearInterval(timer)
  }, [phoneOtpResendAvailableAt])

  // Reset the email cooldown display whenever the resend window closes —
  // render-adjust instead of a sync setState at the top of the ticking effect.
  const [prevEmailExpiry, setPrevEmailExpiry] = useState(emailOtpResendAvailableAt)
  if (prevEmailExpiry !== emailOtpResendAvailableAt) {
    setPrevEmailExpiry(emailOtpResendAvailableAt)
    if (!emailOtpResendAvailableAt) setEmailOtpCooldownSeconds(0)
  }

  useEffect(() => {
    const emailExpiry = emailOtpResendAvailableAt
    if (!emailExpiry) return

    const updateCooldown = () => {
      const nextSeconds = Math.max(0, Math.ceil((emailExpiry - Date.now()) / 1000))
      setEmailOtpCooldownSeconds(nextSeconds)
      if (nextSeconds === 0) {
        setEmailOtpResendAvailableAt(null)
      }
    }

    updateCooldown()
    const timer = window.setInterval(updateCooldown, 1000)
    return () => window.clearInterval(timer)
  }, [emailOtpResendAvailableAt])

  function handleChange<K extends keyof SignUpValues>(
    field: K,
    value: SignUpValues[K],
  ) {
    setValues((currentValues) => {
      const next = {
        ...currentValues,
        [field]: value,
      }

      if (field === "street" || field === "houseNumber") {
        const street = field === "street" ? (value as string) : next.street
        const houseNumber = field === "houseNumber" ? (value as string) : next.houseNumber
        next.address = street ? buildAddressFromParts(street, houseNumber) : ""
      }

      if (field === "gender" || field === "dateOfBirth") {
        const gender = field === "gender" ? (value as string) : next.gender
        const dob = field === "dateOfBirth" ? (value as string) : next.dateOfBirth
        next.avatar = computeAvatar(gender, dob)
      }

      if (field === "email") {
        next.emailOtpCode = ""
      }

      valuesRef.current = next
      return next
    })
    setSubmitError("")
    if (field === "email") {
      emailCheckCacheRef.current = null
      setEmailOtpSent(false)
      setEmailOtpVerified(false)
      setEmailOtpResendAvailableAt(null)
      setEmailOtpCooldownSeconds(0)
    }
    if (field === "phoneNumber") {
      setPhoneOtpSent(false)
      setPhoneOtpVerified(false)
      setPhoneOtpResendAvailableAt(null)
      setPhoneOtpCooldownSeconds(0)
    }

    setErrors((currentErrors) => {
      const hasError = Boolean(currentErrors[field])
      if (!hasError && !currentErrors["proofOfResidency"]) {
        return currentErrors
      }
      const next = { ...currentErrors, [field]: undefined }
      if (
        ["firstName", "lastName", "dateOfBirth", "address", "street", "proofType", "proofOfResidency"].includes(
          field,
        )
      ) {
        next["proofOfResidency"] = undefined
      }
      return next
    })
  }

  function setFieldError<K extends keyof SignUpValues | "street" | "houseNumber">(
    field: K,
    message: string | undefined,
  ) {
    setErrors((currentErrors) => ({
      ...currentErrors,
      [field]: message,
    }))
  }

  function goBack() {
    setErrors({})
    setSubmitError("")
    setStep((current) => Math.max(0, current - 1) as SignUpStepIndex)
  }

  function goToStep(nextStep: SignUpStepIndex) {
    setErrors({})
    setSubmitError("")
    setStep(nextStep)
  }

  /**
   * Returns true when the email can be used for registration.
   * Sets field error when the address is already taken.
   */
  async function ensureEmailAvailable(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase()
    const formatOk = signUpSchema.shape.email.safeParse(normalized)
    if (!formatOk.success) {
      setFieldError("email", formatOk.error.issues[0]?.message ?? "Enter a valid email address.")
      return false
    }

    const cached = emailCheckCacheRef.current
    if (cached && cached.email === normalized) {
      if (!cached.available) {
        setFieldError("email", "An account with this email already exists.")
        return false
      }
      setFieldError("email", undefined)
      return true
    }

    setIsCheckingEmail(true)
    try {
      const result = await checkEmailAvailability({ email: normalized })
      emailCheckCacheRef.current = {
        email: result.email || normalized,
        available: result.available,
      }
      if (!result.available) {
        setFieldError(
          "email",
          result.message || "An account with this email already exists.",
        )
        return false
      }
      setFieldError("email", undefined)
      return true
    } catch (error) {
      setFieldError(
        "email",
        error instanceof ApiError
          ? error.message
          : "Could not verify email. Check your connection and try again.",
      )
      return false
    } finally {
      setIsCheckingEmail(false)
    }
  }

  async function checkEmailOnBlur() {
    const email = valuesRef.current.email.trim()
    if (!email) return
    const formatOk = signUpSchema.shape.email.safeParse(email)
    if (!formatOk.success) return
    await ensureEmailAvailable(email)
  }

  /**
   * Account step only: validate → send email OTP → go to OTP step (1).
   * Never jumps to name (step 2) until email OTP is verified.
   */
  async function continueFromAccountStep() {
    const current = valuesRef.current
    const stepErrors = validateSignUpStep(0, current)
    if (Object.values(stepErrors).some(Boolean)) {
      setErrors(stepErrors)
      return { ok: false as const }
    }

    const emailOk = await ensureEmailAvailable(current.email)
    if (!emailOk) {
      return { ok: false as const }
    }

    const sent = await handleSendEmailOtp()
    if (!sent) {
      return { ok: false as const }
    }

    setErrors({})
    setEmailOtpVerified(false)
    // Explicit landing: email/password → OTP only.
    setStep(1)
    return { ok: true as const }
  }

  async function goNext() {
    // Account step has its own continue handler (must not skip OTP).
    if (step === 0) {
      return continueFromAccountStep()
    }

    // Email OTP step: only advance via handleVerifyEmailOtp after a successful verify.
    if (step === 1) {
      if (!emailOtpVerifiedRef.current) {
        setErrors({ emailOtpCode: "Enter the code and tap Submit to verify your email." })
        return { ok: false as const, needsTerms: false as const }
      }
      setErrors({})
      setStep(2)
      return { ok: true as const, needsTerms: false as const }
    }

    // Always read latest form state (avoids stale closures after flushSync updates).
    const current = valuesRef.current
    let stepErrors = validateSignUpStep(step, current)

    if (step === 9 && !phoneOtpVerifiedRef.current) {
      stepErrors = {
        ...stepErrors,
        phoneNumber: "Phone number must be verified.",
      }
    }

    if (Object.values(stepErrors).some(Boolean)) {
      setErrors(stepErrors)
      return { ok: false as const, needsTerms: false as const }
    }

    setErrors({})
    if (step < SIGN_UP_STEP_COUNT - 1) {
      setStep((currentStep) => (currentStep + 1) as SignUpStepIndex)
    }
    return { ok: true as const, needsTerms: false as const }
  }

  function skipMiddleName() {
    handleChange("middleName", "")
    setErrors({})
    setStep(4)
  }

  async function handleSendEmailOtp(): Promise<boolean> {
    if (isSendingEmailOtp) return false

    if (emailOtpCooldownSeconds > 0 && emailOtpSent) {
      setFieldError("emailOtpCode", `Wait ${emailOtpCooldownSeconds}s before requesting another code.`)
      return false
    }

    const email = valuesRef.current.email.trim().toLowerCase()
    const formatOk = signUpSchema.shape.email.safeParse(email)
    if (!formatOk.success) {
      setFieldError("email", formatOk.error.issues[0]?.message ?? "Enter a valid email address.")
      return false
    }

    setIsSendingEmailOtp(true)
    setSubmitError("")
    try {
      await requestRegistrationEmailOtp({ email })
      setEmailOtpSent(true)
      setEmailOtpVerified(false)
      // Clear any previous code — user types the code, then Submit.
      setValues((current) => {
        const next = { ...current, emailOtpCode: "" }
        valuesRef.current = next
        return next
      })
      setEmailOtpResendAvailableAt(Date.now() + EMAIL_OTP_RESEND_COOLDOWN_SECONDS * 1000)
      setEmailOtpCooldownSeconds(EMAIL_OTP_RESEND_COOLDOWN_SECONDS)
      setFieldError("emailOtpCode", undefined)

      toast.success("A 6-digit code was sent to your email.", {
        description: "Check your inbox (and spam) for the code.",
        icon: null,
        toasterId: "center",
        position: "top-center",
        duration: 5000,
      })
      return true
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message || "Could not send email code. Try again."
          : error instanceof Error
            ? error.message
            : "Could not send email code. Try again."
      let fieldMessage = message
      if (error instanceof ApiError && error.data && typeof error.data === "object") {
        const data = error.data as Record<string, unknown>
        const emailErr = data.email
        if (Array.isArray(emailErr) && typeof emailErr[0] === "string") {
          fieldMessage = emailErr[0]
        } else if (typeof emailErr === "string") {
          fieldMessage = emailErr
        } else if (typeof data.detail === "string") {
          fieldMessage = data.detail
        }
      }
      // Prefer the email field when still on the account step.
      setFieldError(step === 0 ? "email" : "emailOtpCode", fieldMessage)
      toast.error(fieldMessage, {
        toasterId: "center",
        position: "top-center",
        duration: 5000,
      })
      return false
    } finally {
      setIsSendingEmailOtp(false)
    }
  }

  async function handleVerifyEmailOtp(): Promise<boolean> {
    if (isVerifyingEmailOtp) return false

    const code = (valuesRef.current.emailOtpCode ?? "").replace(/\D/g, "")
    if (!/^\d{6}$/.test(code)) {
      setFieldError("emailOtpCode", "Enter the 6-digit code from your email.")
      return false
    }

    setIsVerifyingEmailOtp(true)
    setSubmitError("")
    try {
      await verifyRegistrationEmailOtp({
        email: valuesRef.current.email.trim().toLowerCase(),
        code,
      })
      // Mark verified only after API success, then name step.
      setEmailOtpVerified(true)
      emailOtpVerifiedRef.current = true
      setFieldError("emailOtpCode", undefined)
      setErrors({})
      setStep(2)
      return true
    } catch {
      setEmailOtpVerified(false)
      emailOtpVerifiedRef.current = false
      setFieldError("emailOtpCode", "Invalid or expired code. Request a new one.")
      return false
    } finally {
      setIsVerifyingEmailOtp(false)
    }
  }

  function editEmailFromOtp() {
    setEmailOtpVerified(false)
    setEmailOtpSent(false)
    setErrors({})
    setSubmitError("")
    setStep(0)
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
      const result = await requestRegistrationPhoneOtp({ phone_number: values.phoneNumber })
      setPhoneOtpSent(true)
      setPhoneOtpVerified(false)
      // The server owns the cooldown; it rejects an early resend with 429.
      const cooldown =
        result && typeof result === "object" && typeof result.retry_after === "number"
          ? result.retry_after
          : PHONE_OTP_RESEND_COOLDOWN_SECONDS
      setPhoneOtpResendAvailableAt(Date.now() + cooldown * 1000)
      setPhoneOtpCooldownSeconds(cooldown)
      setFieldError("phoneNumber", undefined)
      setFieldError("phoneOtpCode", undefined)

      toast("A 6-digit code was sent to your number.", {
        toasterId: "center",
        position: "top-center",
        duration: 5000,
      })
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message || "Could not send SMS code. Check your number and try again."
          : error instanceof Error
            ? error.message
            : "Could not send SMS code. Check your number and try again."
      // Prefer field-level errors from DRF (e.g. phone already registered).
      let fieldMessage = message
      if (error instanceof ApiError && error.data && typeof error.data === "object") {
        const data = error.data as Record<string, unknown>
        const phoneErr = data.phone_number
        if (Array.isArray(phoneErr) && typeof phoneErr[0] === "string") {
          fieldMessage = phoneErr[0]
        } else if (typeof phoneErr === "string") {
          fieldMessage = phoneErr
        } else if (typeof data.detail === "string") {
          fieldMessage = data.detail
        }
        // 429: the server is enforcing the resend cooldown or an hourly cap.
        if (typeof data.retry_after === "number" && data.retry_after > 0) {
          setPhoneOtpResendAvailableAt(Date.now() + data.retry_after * 1000)
          setPhoneOtpCooldownSeconds(data.retry_after)
        }
      }
      setFieldError("phoneNumber", fieldMessage)
      toast.error(fieldMessage, {
        toasterId: "center",
        position: "top-center",
        duration: 5000,
      })
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

  /** Back from phone OTP screen to edit the number (keeps the number, clears code). */
  function editPhoneFromOtp() {
    setPhoneOtpSent(false)
    setPhoneOtpVerified(false)
    setPhoneOtpResendAvailableAt(null)
    setPhoneOtpCooldownSeconds(0)
    setValues((current) => {
      const next = { ...current, phoneOtpCode: "" }
      valuesRef.current = next
      return next
    })
    setFieldError("phoneOtpCode", undefined)
    setFieldError("phoneNumber", undefined)
    setErrors({})
    setSubmitError("")
  }

  async function submitRegistration() {
    const address =
      values.address ||
      (values.street ? buildAddressFromParts(values.street, values.houseNumber) : "")
    const payloadValues: SignUpValues = {
      ...values,
      address,
    }

    const fieldErrors = flattenErrors(payloadValues)
    const selectedOption = proofOptions.find((option) => option.key === payloadValues.proofType)
    const needsFrontBack =
      !!selectedOption &&
      selectedOption.required_sides.includes("front") &&
      selectedOption.required_sides.includes("back")
    const missingBack =
      needsFrontBack && payloadValues.proofOfResidency.length < 2
        ? "This document requires both front and back photos. Open capture again and complete both sides."
        : undefined

    const nextErrors: SignUpErrors = {
      ...fieldErrors,
      ...(missingBack ? { proofOfResidency: missingBack } : {}),
      ...(!emailOtpVerified
        ? {
            emailOtpCode: "Email must be verified.",
          }
        : {}),
      ...(!phoneOtpVerified
        ? {
            phoneNumber: "Phone number must be verified.",
            phoneOtpCode: undefined,
          }
        : {}),
    }

    setErrors(nextErrors)

    if (Object.values(nextErrors).some(Boolean)) {
      setSubmitError("Please fix the highlighted fields and try again.")
      // Jump to first step that has errors
      if (nextErrors.email || nextErrors.password || nextErrors.agreeToTerms) setStep(0)
      else if (nextErrors.emailOtpCode) setStep(1)
      else if (nextErrors.firstName || nextErrors.lastName) setStep(2)
      else if (nextErrors.middleName) setStep(3)
      else if (nextErrors.gender) setStep(4)
      else if (nextErrors.dateOfBirth) setStep(5)
      else if (nextErrors.address || nextErrors.street) setStep(6)
      else if (nextErrors.proofOfResidency || nextErrors.proofType) setStep(7)
      else if (nextErrors.phoneNumber || nextErrors.phoneOtpCode) setStep(9)
      return
    }

    const formData = new FormData()
    formData.append("email", payloadValues.email)
    formData.append("email_otp_code", payloadValues.emailOtpCode ?? "")
    formData.append("phone_number", payloadValues.phoneNumber)
    formData.append("phone_otp_code", payloadValues.phoneOtpCode ?? "")
    formData.append("password", payloadValues.password)
    formData.append("first_name", payloadValues.firstName)
    formData.append("middle_name", payloadValues.middleName ?? "")
    formData.append("last_name", payloadValues.lastName)
    formData.append("date_of_birth", payloadValues.dateOfBirth)
    formData.append("address", address)
    formData.append("barangay", "Marikina Heights")
    if (payloadValues.gender) formData.append("gender", payloadValues.gender)
    if (payloadValues.avatar) formData.append("avatar", payloadValues.avatar)
    if (payloadValues.proofType) formData.append("proof_type", payloadValues.proofType)
    for (const proofFile of payloadValues.proofOfResidency) {
      formData.append("proof", proofFile)
    }
    if (needsFrontBack && payloadValues.proofOfResidency.length >= 2) {
      formData.append("proof_side", "front")
      formData.append("proof_side", "back")
    } else if (
      selectedOption?.required_sides.includes("front") &&
      payloadValues.proofOfResidency.length === 1
    ) {
      formData.append("proof_side", "front")
    } else if (payloadValues.proofOfResidency.length > 0) {
      for (let i = 0; i < payloadValues.proofOfResidency.length; i += 1) {
        formData.append("proof_side", "single")
      }
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
        const mapped: SignUpErrors = {}

        const ocrFieldSet = new Set(["firstName", "lastName", "dateOfBirth", "address", "proofType"])
        const ocrAffected: string[] = []
        for (const [backendField, value] of Object.entries(backendErrors)) {
          const formField = backendFieldMap[backendField]
          const rawMessage = firstErrorMessage(value)
          if (formField && rawMessage) {
            const message =
              formField === "proofOfResidency" || ocrFieldSet.has(formField)
                ? humanizeProofError(rawMessage)
                : rawMessage
            if (ocrFieldSet.has(formField)) {
              ocrAffected.push(formField)
              mapped["proofOfResidency"] = message
              if (formField !== "proofType") {
                mapped[formField] = message
              }
            } else {
              mapped[formField] = message
            }
          }
        }
        setOcrFields(ocrAffected)

        const detailMessage = firstErrorMessage(backendErrors.detail)
        if (detailMessage) {
          const lower = detailMessage.toLowerCase()
          if (lower.includes("phone") || (lower.includes("otp") && lower.includes("sms"))) {
            mapped.phoneOtpCode = detailMessage
          } else if (lower.includes("email") && lower.includes("otp")) {
            mapped.emailOtpCode = detailMessage
          } else if (lower.includes("otp") || lower.includes("expired") || lower.includes("used")) {
            // Final register re-checks OTPs — show on guidelines if we can't jump
            mapped.emailOtpCode = mapped.emailOtpCode ?? detailMessage
          } else if (lower.includes("email") || lower.includes("already")) {
            mapped.email = detailMessage
          } else {
            mapped.email = detailMessage
          }
        }

        // Collect unmapped field messages (e.g. non_field_errors) for the guidelines error line
        const leftover = firstErrorMessage(
          backendErrors.non_field_errors ?? backendErrors.proof ?? backendErrors.email_otp_code,
        )

        if (Object.keys(mapped).length > 0) {
          setErrors((currentErrors) => ({
            ...currentErrors,
            ...mapped,
          }))
          if (mapped.email || mapped.password) setStep(0)
          else if (mapped.emailOtpCode) setStep(1)
          else if (mapped.firstName || mapped.lastName) setStep(2)
          else if (mapped.proofOfResidency || mapped.proofType || mapped.address) setStep(7)
          else if (mapped.phoneNumber || mapped.phoneOtpCode) setStep(9)
          setSubmitError(detailMessage || leftover || "")
          return
        }

        if (detailMessage || leftover) {
          setSubmitError(detailMessage || leftover || "Could not create account.")
          return
        }
      }
      setSubmitError(
        error instanceof ApiError
          ? error.message || "Could not create account. Try again later."
          : "Could not create account. Try again later.",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (step === 10) {
      await submitRegistration()
      return
    }
    goNext()
  }

  const canCaptureProof = useMemo(() => {
    if (proofOptionsLoading) return false
    if (!values.firstName?.trim()) return false
    if (!values.lastName?.trim()) return false
    if (!values.dateOfBirth?.trim()) return false
    if (!values.street?.trim() && (!values.address || values.address.trim().length < 5)) return false
    if (!["male", "female", "prefer_not_to_say"].includes(values.gender)) return false
    return true
  }, [
    proofOptionsLoading,
    values.firstName,
    values.lastName,
    values.dateOfBirth,
    values.address,
    values.street,
    values.gender,
  ])

  const proofCaptureBlockedReason = useMemo(() => {
    if (canCaptureProof) return null
    const missing: string[] = []
    if (!values.firstName?.trim()) missing.push("first name")
    if (!values.lastName?.trim()) missing.push("last name")
    if (!["male", "female", "prefer_not_to_say"].includes(values.gender)) missing.push("gender")
    if (!values.dateOfBirth?.trim()) missing.push("date of birth")
    if (!values.street?.trim() && (!values.address || values.address.trim().length < 5)) {
      missing.push("address")
    }
    if (missing.length === 0) return null
    return `Complete ${missing.join(", ")} first. These are matched against your ID photo.`
  }, [
    canCaptureProof,
    values.firstName,
    values.lastName,
    values.gender,
    values.dateOfBirth,
    values.address,
    values.street,
  ])

  const progressPercent = useMemo(() => {
    if (SIGN_UP_STEP_COUNT <= 1) return 0
    return (step / (SIGN_UP_STEP_COUNT - 1)) * 100
  }, [step])

  return {
    step,
    setStep: goToStep,
    goBack,
    goNext,
    continueFromAccountStep,
    skipMiddleName,
    progressPercent,
    errors,
    handleChange,
    checkEmailOnBlur,
    ensureEmailAvailable,
    handleSendEmailOtp,
    handleVerifyEmailOtp,
    editEmailFromOtp,
    handleSendPhoneOtp,
    handleVerifyPhoneOtp,
    editPhoneFromOtp,
    handleSubmit,
    submitRegistration,
    isSubmitting,
    isCheckingEmail,
    isSendingEmailOtp,
    isVerifyingEmailOtp,
    isSendingPhoneOtp,
    isVerifyingPhoneOtp,
    passwordStrength,
    emailOtpSent,
    emailOtpVerified,
    emailOtpCooldownSeconds,
    phoneOtpSent,
    phoneOtpVerified,
    phoneOtpCooldownSeconds,
    setFieldError,
    setValues,
    submitError,
    values,
    ocrFields,
    proofOptions,
    proofOptionsLoading,
    refreshProofOptions,
    canCaptureProof,
    proofCaptureBlockedReason,
  }
}
