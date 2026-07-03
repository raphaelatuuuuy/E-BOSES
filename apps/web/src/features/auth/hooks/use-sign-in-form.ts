import { type FormEvent, useState } from "react"

import { ApiError } from "@/lib/api"
import { login, type AuthUser } from "@/features/auth/api"
import {
  type SignInErrors,
  type SignInValues,
  signInSchema,
} from "@/features/auth/schemas/sign-in-schema"

const initialValues: SignInValues = {
  email: "",
  password: "",
}

function flattenErrors(values: SignInValues) {
  const parsed = signInSchema.safeParse(values)

  if (parsed.success) {
    return {}
  }

  return parsed.error.flatten().fieldErrors
}

interface UseSignInFormOptions {
  onSuccess?: (user: AuthUser, access: string, refresh: string) => void
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const fieldErrors = flattenErrors(values)
    const nextErrors: SignInErrors = {
      email: fieldErrors.email?.[0],
      password: fieldErrors.password?.[0],
    }

    setErrors(nextErrors)

    if (nextErrors.email || nextErrors.password) {
      setSubmitError("")
      return
    }

    setIsSubmitting(true)
    setSubmitError("")
    try {
      const response = await login({
        identifier: values.email,
        password: values.password,
      })
      onSuccess?.(response.user, response.access, response.refresh)
    } catch (error) {
      if (error instanceof ApiError && error.status === 403 && error.data) {
        const detail = typeof error.data === "object" && error.data !== null
          ? (error.data as Record<string, unknown>).detail
          : null
        if (typeof detail === "string" && detail.toLowerCase().includes("suspended")) {
          setSubmitError("Account suspended. Please contact your barangay administrator.")
          return
        }
        if (typeof detail === "string" && detail.toLowerCase().includes("rejected")) {
          setSubmitError("Account not approved. Contact your barangay administrator for details.")
          return
        }
        if (typeof detail === "string" && detail.toLowerCase().includes("pending")) {
          setSubmitError("Account still under verification. Please try again later.")
          return
        }
      }
      setSubmitError("Invalid email or password.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    errors,
    handleChange,
    handleSubmit,
    isSubmitting,
    submitError,
    values,
  }
}
