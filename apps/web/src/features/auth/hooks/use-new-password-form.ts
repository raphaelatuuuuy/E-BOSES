import { type FormEvent, useMemo, useState } from "react"

import { getPasswordStrength } from "@/features/auth/lib/password-requirements"
import {
  type NewPasswordErrors,
  type NewPasswordValues,
  newPasswordSchema,
} from "@/features/auth/schemas/new-password-schema"

const initialValues: NewPasswordValues = {
  password: "",
  confirmPassword: "",
}

function flattenErrors(values: NewPasswordValues) {
  const parsed = newPasswordSchema.safeParse(values)

  if (parsed.success) {
    return {}
  }

  return parsed.error.flatten().fieldErrors
}

interface UseNewPasswordFormOptions {
  onSuccess?: (password: string) => void
}

export function useNewPasswordForm(options: UseNewPasswordFormOptions = {}) {
  const { onSuccess } = options
  const [values, setValues] = useState<NewPasswordValues>(initialValues)
  const [errors, setErrors] = useState<NewPasswordErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")

  function handleChange<K extends keyof NewPasswordValues>(
    field: K,
    value: NewPasswordValues[K],
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

    setSubmitError("")
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    const fieldErrors = flattenErrors(values)
    const nextErrors: NewPasswordErrors = {
      password: fieldErrors.password?.[0],
      confirmPassword: fieldErrors.confirmPassword?.[0],
    }

    setErrors(nextErrors)

    if (nextErrors.password || nextErrors.confirmPassword) {
      return
    }

    setSubmitError("")
    setIsSubmitting(true)

    try {
      await onSuccess?.(values.password)
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Could not reset password. Link may have expired. Try again."
      setErrors({
        password: message,
        confirmPassword: message,
      })
      setSubmitError("")
    } finally {
      setIsSubmitting(false)
    }
  }

  const passwordStrength = useMemo(
    () => getPasswordStrength(values.password),
    [values.password],
  )

  return {
    errors,
    handleChange,
    handleSubmit,
    isSubmitting,
    passwordStrength,
    submitError,
    values,
  }
}
