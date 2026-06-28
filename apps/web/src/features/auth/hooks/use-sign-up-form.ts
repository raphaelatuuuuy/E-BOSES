import { type FormEvent, useMemo, useState } from "react"

import {
  type SignUpErrors,
  type SignUpValues,
  signUpSchema,
} from "@/features/auth/schemas/sign-up-schema"

const initialValues: SignUpValues = {
  firstName: "",
  middleName: "",
  lastName: "",
  dateOfBirth: "",
  address: "",
  proofOfResidency: [],
  phoneNumber: "",
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
  onSuccess?: () => void
}

export function useSignUpForm(options: UseSignUpFormOptions = {}) {
  const { onSuccess } = options
  const [values, setValues] = useState<SignUpValues>(initialValues)
  const [errors, setErrors] = useState<SignUpErrors>({})
  const [statusMessage, setStatusMessage] = useState("")

  function handleChange<K extends keyof SignUpValues>(
    field: K,
    value: SignUpValues[K],
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

  function setFieldError<K extends keyof SignUpValues>(
    field: K,
    message: string | undefined,
  ) {
    setErrors((currentErrors) => ({
      ...currentErrors,
      [field]: message,
    }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const fieldErrors = flattenErrors(values)

    setErrors(fieldErrors)

    if (Object.keys(fieldErrors).length > 0) {
      setStatusMessage("")
      return
    }

    setStatusMessage("")
    onSuccess?.()
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
    handleSubmit,
    passwordStrength,
    setFieldError,
    setValues,
    statusMessage,
    values,
  }
}
