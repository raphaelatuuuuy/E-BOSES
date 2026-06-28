import { type FormEvent, useState } from "react"

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
  const [statusMessage, setStatusMessage] = useState("")

  function handleChange<K extends keyof ForgotPasswordValues>(
    field: K,
    value: ForgotPasswordValues[K],
  ) {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }))

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const fieldErrors = flattenErrors(values)
    const nextErrors: ForgotPasswordErrors = {
      email: fieldErrors.email?.[0],
    }

    setErrors(nextErrors)

    if (nextErrors.email) {
      setStatusMessage("")
      return
    }

    setStatusMessage("")
    onSuccess?.(values.email)
  }

  return {
    errors,
    handleChange,
    handleSubmit,
    statusMessage,
    values,
  }
}
