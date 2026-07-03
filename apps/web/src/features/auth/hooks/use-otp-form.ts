import { type FormEvent, useState } from "react"

export interface OtpFormValues {
  code: string
}

export interface OtpFormErrors {
  code?: string
}

const OTP_LENGTH = 6
const initialValues: OtpFormValues = {
  code: "",
}

interface UseOtpFormOptions {
  onSuccess?: (code: string) => void
}

export function useOtpForm(options: UseOtpFormOptions = {}) {
  const { onSuccess } = options
  const [values, setValues] = useState<OtpFormValues>(initialValues)
  const [errors, setErrors] = useState<OtpFormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")

  function handleChange(code: string) {
    const digitsOnly = code.replace(/\D/g, "")

    setValues({ code: digitsOnly })

    setErrors((currentErrors) => {
      if (!currentErrors.code) {
        return currentErrors
      }

      return {
        ...currentErrors,
        code: undefined,
      }
    })
    setSubmitError("")

    if (digitsOnly.length === OTP_LENGTH && !isSubmitting) {
      onSuccess?.(digitsOnly)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    if (values.code.length !== OTP_LENGTH) {
      setErrors({ code: "Enter the 6-digit code." })
      return
    }
    setErrors({})
    setSubmitError("")
    setIsSubmitting(true)
    try {
      await onSuccess?.(values.code)
    } catch (error) {
      setErrors({
        code: error instanceof Error
          ? error.message
          : "Invalid or expired code. Request a new one.",
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
