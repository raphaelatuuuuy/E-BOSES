import { type FormEvent, useState } from "react"

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

export function useSignInForm() {
  const [values, setValues] = useState<SignInValues>(initialValues)
  const [errors, setErrors] = useState<SignInErrors>({})
  const [statusMessage, setStatusMessage] = useState("")

  function handleChange<K extends keyof SignInValues>(
    field: K,
    value: SignInValues[K],
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
    const nextErrors: SignInErrors = {
      email: fieldErrors.email?.[0],
      password: fieldErrors.password?.[0],
    }

    setErrors(nextErrors)

    if (nextErrors.email || nextErrors.password) {
      setStatusMessage("")
      return
    }

    setStatusMessage(
      "Frontend validation passed. Backend sign-in will connect in Phase 2.",
    )
  }

  return {
    errors,
    handleChange,
    handleSubmit,
    statusMessage,
    values,
  }
}
