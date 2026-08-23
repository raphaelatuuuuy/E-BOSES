import { type FormEvent, useState } from "react"

import { ApiError } from "@/lib/api"
import { login, type AuthUser } from "@/features/auth/api"
import {
  normalizePhoneNumber,
  type SignInErrors,
  type SignInMode,
  type SignInValues,
  signInSchema,
} from "@/features/auth/schemas/sign-in-schema"

const initialValues: SignInValues = {
  mode: "email",
  identifier: "",
  password: "",
}

export const SILENT_SIGN_IN_ERROR = "__silent_sign_in_error__"

function flattenErrors(values: SignInValues) {
  const parsed = signInSchema.safeParse(values)

  if (parsed.success) {
    return {}
  }

  return parsed.error.flatten().fieldErrors
}

function apiMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback
}

interface UseSignInFormOptions {
  onSuccess?: (user: AuthUser, access: string) => void
}

export function useSignInForm(options: UseSignInFormOptions = {}) {
  const { onSuccess } = options
  const [values, setValues] = useState<SignInValues>(initialValues)
  const [errors, setErrors] = useState<SignInErrors>({})
  const [submitError, setSubmitError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  function handleChange<K extends keyof SignInValues>(
    field: K,
    value: SignInValues[K],
  ) {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }))
    setSubmitError("")

    if (field === "mode") {
      // The old error described the old field, so it cannot survive the switch.
      setErrors((currentErrors) => ({ ...currentErrors, identifier: undefined }))
      return
    }

    setErrors((currentErrors) => {
      if (!currentErrors[field as "identifier" | "password"]) {
        return currentErrors
      }

      return {
        ...currentErrors,
        [field]: undefined,
      }
    })
  }

  function setMode(mode: SignInMode) {
    // An email is never a valid phone number, so carrying the text across the
    // switch only ever leaves a field that cannot pass validation.
    setValues((currentValues) => ({ ...currentValues, mode, identifier: "" }))
    setSubmitError("")
    setErrors((currentErrors) => ({ ...currentErrors, identifier: undefined }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const fieldErrors = flattenErrors(values)
    const nextErrors: SignInErrors = {
      identifier: fieldErrors.identifier?.[0],
      password: fieldErrors.password?.[0],
    }

    setErrors(nextErrors)

    if (nextErrors.identifier || nextErrors.password) {
      setSubmitError("")
      return
    }

    // The account stores a phone number as +63XXXXXXXXXX, so send that rather
    // than whatever local shape was typed.
    const typed = values.identifier.trim()
    const identifier =
      values.mode === "phone" ? normalizePhoneNumber(typed) ?? typed : typed

    setIsSubmitting(true)
    setSubmitError("")
    try {
      const response = await login({ identifier, password: values.password })
      onSuccess?.(response.user, response.access)
    } catch (error) {
      const fallback =
        values.mode === "phone"
          ? "Invalid phone number or password."
          : "Invalid email or password."
      const message = apiMessage(error, fallback)
      if (error instanceof ApiError && error.data) {
        const code = typeof error.data === "object" && error.data !== null
          ? (error.data as Record<string, unknown>).code
          : null
        if (code === "account_rejected") {
          setErrors({
            identifier: SILENT_SIGN_IN_ERROR,
            password: "Account not approved. Contact your barangay administrator for details.",
          })
          setSubmitError("")
          return
        }
      }
      setErrors({
        identifier: SILENT_SIGN_IN_ERROR,
        password: message,
      })
      setSubmitError("")
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    errors,
    handleChange,
    handleSubmit,
    isSubmitting,
    setMode,
    submitError,
    values,
  }
}
