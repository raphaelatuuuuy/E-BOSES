import { type FormEvent, useState } from "react"

import { ApiError } from "@/lib/api"
import { login, type AuthUser } from "@/features/auth/api"
import { readyOfflineMap } from "@/features/dashboard/components/map/tile-layers"
import { refreshOfflineSosConfig } from "@/features/dashboard/components/sos/offline-sos-config"
import {
  type SignInErrors,
  type SignInValues,
  signInSchema,
} from "@/features/auth/schemas/sign-in-schema"

const initialValues: SignInValues = {
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
  beforeSuccess?: (result: {
    user: AuthUser
    access: string
    identifier: string
    values: SignInValues
  }) => Promise<void> | void
}

export function useSignInForm(options: UseSignInFormOptions = {}) {
  const { beforeSuccess, onSuccess } = options
  const [values, setValues] = useState<SignInValues>(initialValues)
  const [errors, setErrors] = useState<SignInErrors>({})
  const [submitError, setSubmitError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  function handleChange<K extends keyof SignInValues>(
    field: K,
    value: SignInValues[K]
  ) {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }))
    setSubmitError("")

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

    const typed = values.identifier.trim()

    setIsSubmitting(true)
    setSubmitError("")
    try {
      const response = await login({
        identifier: typed,
        password: values.password,
      })
      await beforeSuccess?.({
        user: response.user,
        access: response.access,
        identifier: typed,
        values,
      })
      onSuccess?.(response.user, response.access)
      void (async () => {
        try {
          await refreshOfflineSosConfig()
        } catch {
          // The bundled coverage copy still warms below.
        }
        readyOfflineMap()
      })()
    } catch (error) {
      const fallback = "Invalid email or password."
      const message = apiMessage(error, fallback)
      if (error instanceof ApiError && error.data) {
        const code =
          typeof error.data === "object" && error.data !== null
            ? (error.data as Record<string, unknown>).code
            : null
        if (code === "account_rejected") {
          setErrors({
            identifier: SILENT_SIGN_IN_ERROR,
            password:
              "Account not approved. Contact your barangay administrator for details.",
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
    submitError,
    values,
  }
}
