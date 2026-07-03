import { type FormEvent, useState } from "react"

import { requestPasswordReset } from "@/features/auth/api"
import {
  type ForgotPasswordErrors,
  type ForgotPasswordValues,
  forgotPasswordSchema,
} from "@/features/auth/schemas/forgot-password-schema"

const initialValues: ForgotPasswordValues = {
  email: "",
}

function flattenErrors(values: ForgotPasswordValues) {
  const parsed = forgotPasswordSchema.safeParse(values)

  if (parsed.success) {
    return {}
  }

  return parsed.error.flatten().fieldErrors
}

interface UseForgotPasswordFormOptions {
  onSuccess?: (email: string) => void
}

export function useForgotPasswordForm(options: UseForgotPasswordFormOptions = {}) {
  const { onSuccess } = options
  const [values, setValues] = useState<ForgotPasswordValues>(initialValues)
  const [errors, setErrors] = useState<ForgotPasswordErrors>({})
  const [submitError, setSubmitError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  function handleChange<K extends keyof ForgotPasswordValues>(
    field: K,
    value: ForgotPasswordValues[K],
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
    const nextErrors: ForgotPasswordErrors = {
      email: fieldErrors.email?.[0],
    }

    setErrors(nextErrors)

    if (nextErrors.email) {
      setSubmitError("")
      return
    }

    setIsSubmitting(true)
    setSubmitError("")
    try {
      await requestPasswordReset({ identifier: values.email, channel: "email" })
      onSuccess?.(values.email)
    } catch {
      setSubmitError("Could not send reset code. Try again later.")
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
