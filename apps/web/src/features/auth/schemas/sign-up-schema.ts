import { z } from "zod"

export const MAX_PROOF_OF_RESIDENCY_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_PROOF_OF_RESIDENCY_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
])
const ALLOWED_PROOF_OF_RESIDENCY_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
])
const MINIMUM_AGE = 18

export function getProofOfResidencyFileError(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase()
  const hasAllowedExtension =
    extension !== undefined &&
    ALLOWED_PROOF_OF_RESIDENCY_EXTENSIONS.has(extension)
  const hasAllowedMimeType =
    file.type === "" || ALLOWED_PROOF_OF_RESIDENCY_MIME_TYPES.has(file.type)

  if (!hasAllowedExtension || !hasAllowedMimeType) {
    return "Only PDF, PNG, and JPG files are allowed."
  }

  if (file.size > MAX_PROOF_OF_RESIDENCY_FILE_SIZE_BYTES) {
    return "Each file must be 5 MB or smaller."
  }

  return null
}

export function isAtLeastMinimumAge(dateString: string, minimumAge = MINIMUM_AGE) {
  const birthDate = new Date(dateString)

  if (Number.isNaN(birthDate.getTime())) {
    return false
  }

  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDifference = today.getMonth() - birthDate.getMonth()

  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < birthDate.getDate())
  ) {
    age -= 1
  }

  return age >= minimumAge
}

export function getLatestAllowedBirthDate(minimumAge = MINIMUM_AGE) {
  const latestBirthDate = new Date()
  latestBirthDate.setFullYear(latestBirthDate.getFullYear() - minimumAge)
  return latestBirthDate
}

const proofOfResidencyFileSchema = z
  .custom<File>((value) => value instanceof File, {
    message: "Upload a valid file.",
  })
  .superRefine((file, context) => {
    const error = getProofOfResidencyFileError(file)

    if (!error) {
      return
    }

    context.addIssue({
      code: "custom",
      message: error,
    })
  })

export const signUpSchema = z
  .object({
    firstName: z.string().min(1, "First name is required.").max(50, "First name must be 50 characters or fewer."),
    middleName: z.string().max(50, "Middle name must be 50 characters or fewer.").optional().default(""),
    lastName: z.string().min(1, "Last name is required.").max(50, "Last name must be 50 characters or fewer."),
    dateOfBirth: z
      .string()
      .min(1, "Date of birth is required.")
      .refine((value) => isAtLeastMinimumAge(value), {
        message: "You must be at least 18 years old.",
      }),
    address: z.string().min(5, "Enter a valid address.").max(200, "Address must be 200 characters or fewer."),
    proofOfResidency: z
      .array(proofOfResidencyFileSchema)
      .min(1, "Upload at least one valid government-issued ID or bill."),
    phoneNumber: z
      .string()
      .regex(/^\+63\d{10}$/, "Enter a valid Philippine mobile number (e.g. +639821921234)."),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(128, "Password must be 128 characters or fewer.")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
      .regex(/[0-9]/, "Password must contain at least one number.")
      .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character."),
    confirmPassword: z.string(),
    agreeToTerms: z.boolean().refine((v) => v, {
      message: "You must agree to the terms and conditions.",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })

export type SignUpValues = z.infer<typeof signUpSchema>

export type SignUpErrors = Partial<Record<keyof SignUpValues, string>>
