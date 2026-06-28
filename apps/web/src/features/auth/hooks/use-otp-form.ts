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
  const [statusMessage, setStatusMessage] = useState("")

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
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (values.code.length !== OTP_LENGTH) {
      setErrors({ code: "Enter the 6-digit code." })
      setStatusMessage("")
      return
    }

    setErrors({})
    setStatusMessage("")
    onSuccess?.(values.code)
  }

  return {
    errors,
    handleChange,
    handleSubmit,
    statusMessage,
    values,
  }
}
