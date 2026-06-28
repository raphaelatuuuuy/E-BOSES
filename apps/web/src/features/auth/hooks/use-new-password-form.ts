import { type FormEvent, useState } from "react"

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
  const [statusMessage, setStatusMessage] = useState("")

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
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const fieldErrors = flattenErrors(values)
    const nextErrors: NewPasswordErrors = {
      password: fieldErrors.password?.[0],
      confirmPassword: fieldErrors.confirmPassword?.[0],
    }

    setErrors(nextErrors)

    if (nextErrors.password || nextErrors.confirmPassword) {
      setStatusMessage("")
      return
    }

    setStatusMessage("")
    onSuccess?.(values.password)
  }

  return {
    errors,
    handleChange,
    handleSubmit,
    statusMessage,
    values,
  }
}
