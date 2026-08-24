import { z } from "zod"


export const MAX_PROOF_OF_RESIDENCY_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_PROOF_OF_RESIDENCY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
])
const ALLOWED_PROOF_OF_RESIDENCY_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
])
const MINIMUM_AGE = 18
const NAME_PATTERN = /^[A-Za-zÑñ ]+$/
const NAME_MESSAGE = "Use letters only, including Ñ/ñ."

export const SIGN_UP_STEP_COUNT = 11

/** 0 account · 1 email OTP · 2 name … 7 proof · 8 peek · 9 phone · 10 guidelines */
export type SignUpStepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export function getProofOfResidencyFileError(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase()
  const hasAllowedExtension =
    extension !== undefined &&
    ALLOWED_PROOF_OF_RESIDENCY_EXTENSIONS.has(extension)
  const hasAllowedMimeType =
    file.type === "" || ALLOWED_PROOF_OF_RESIDENCY_MIME_TYPES.has(file.type)

  if (!hasAllowedExtension || !hasAllowedMimeType) {
    return "Only photo files are allowed (JPG, PNG, or WebP). HEIC/PDF are not supported."
  }

  if (file.size > MAX_PROOF_OF_RESIDENCY_FILE_SIZE_BYTES) {
    return "Each file must be 10 MB or smaller."
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

const nameField = (label: string) =>
  z
    .string()
    .min(1, `${label} is required.`)
    .max(50, `${label} must be 50 characters or fewer.`)
    .regex(NAME_PATTERN, NAME_MESSAGE)

export const accountStepSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password must be 128 characters or fewer.")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
    .regex(/[0-9]/, "Password must contain at least one number.")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character."),
  agreeToTerms: z.boolean().refine((v) => v, {
    message: "You must agree to the Privacy Policy and Terms of Service.",
  }),
})

export const nameStepSchema = z.object({
  firstName: nameField("First name"),
  lastName: nameField("Last name"),
})

export const middleNameStepSchema = z.object({
  middleName: z
    .string()
    .max(50, "Middle name must be 50 characters or fewer.")
    .refine((value) => value === "" || NAME_PATTERN.test(value), {
      message: NAME_MESSAGE,
    })
    .optional()
    .default(""),
})

export const genderStepSchema = z.object({
  gender: z
    .string()
    .refine((v) => ["male", "female", "prefer_not_to_say"].includes(v), {
      message: "Select your gender.",
    }),
})

export const dobStepSchema = z.object({
  dateOfBirth: z
    .string()
    .min(1, "Date of birth is required.")
    .refine((value) => isAtLeastMinimumAge(value), {
      message: "You must be at least 18 years old.",
    }),
})

export const addressStepSchema = z.object({
    street: z.string().min(1, "Enter your street."),
    houseNumber: z.string().max(40, "House number is too long.").optional().default(""),
    address: z.string().optional().default(""),
  })

export const proofStepSchema = z.object({
  proofOfResidency: z
    .array(proofOfResidencyFileSchema)
    .min(1, "Upload at least one valid government-issued ID or bill.")
    .max(2, "You can upload a maximum of 2 files."),
  proofType: z.string().min(1, "Select an ID type."),
})

export const emailOtpStepSchema = z.object({
  emailOtpCode: z
    .string()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your email."),
})

export const phoneStepSchema = z.object({
  phoneNumber: z
    .string()
    // Stored as E.164 (+639XXXXXXXXX); UI accepts local 9XXXXXXXXX without typing +63.
    .regex(/^\+639\d{9}$/, "Enter a valid PH mobile number (e.g. 9123456789)."),
  phoneOtpCode: z.string().optional().default(""),
})

export const signUpSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  emailOtpCode: z.string().optional().default(""),
  firstName: nameField("First name"),
  middleName: z
    .string()
    .max(50, "Middle name must be 50 characters or fewer.")
    .refine((value) => value === "" || NAME_PATTERN.test(value), {
      message: NAME_MESSAGE,
    })
    .optional()
    .default(""),
  lastName: nameField("Last name"),
  dateOfBirth: z
    .string()
    .min(1, "Date of birth is required.")
    .refine((value) => isAtLeastMinimumAge(value), {
      message: "You must be at least 18 years old.",
    }),
  street: z.string().min(1, "Select your street."),
  houseNumber: z.string().max(40).optional().default(""),
  address: z.string().min(5, "Enter a valid address.").max(200, "Address must be 200 characters or fewer."),
  homeLatitude: z.number().nullable().default(null),
  homeLongitude: z.number().nullable().default(null),
  homeAccuracyMeters: z.number().nullable().default(null),
  homeLocationSource: z.enum(["gps", "search", "manual"]).nullable().default(null),
  communityResolutionToken: z.string().default(""),
  communityMatch: z.object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
    boundary: z.record(z.string(), z.unknown()),
    center: z.object({ latitude: z.number(), longitude: z.number() }),
    neighbors: z.number(),
  }).nullable().default(null),
  proofOfResidency: z
    .array(proofOfResidencyFileSchema)
    .min(1, "Upload at least one valid government-issued ID or bill.")
    .max(2, "You can upload a maximum of 2 files."),
  proofType: z.string().min(1, "Select an ID type."),
  phoneNumber: z
    .string()
    .regex(/^\+639\d{9}$/, "Enter a valid PH mobile number (e.g. 9123456789)."),
  phoneOtpCode: z.string().optional().default(""),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password must be 128 characters or fewer.")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
    .regex(/[0-9]/, "Password must contain at least one number.")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character."),
  gender: z
    .string()
    .default("")
    .refine((v) => ["male", "female", "prefer_not_to_say"].includes(v), {
      message: "Select your gender.",
    }),
  avatar: z.string().optional().default(""),
  agreeToTerms: z.boolean().refine((v) => v, {
    message: "You must agree to the Privacy Policy and Terms of Service.",
  }),
})

export type SignUpValues = z.infer<typeof signUpSchema>

export type SignUpErrors = Partial<Record<keyof SignUpValues | "street" | "houseNumber", string>>

export function buildAddressFromParts(street: string, houseNumber?: string) {
  const house = houseNumber?.trim()
  return house ? `${house} ${street}` : street
}

export function validateSignUpStep(
  step: SignUpStepIndex,
  values: SignUpValues,
): SignUpErrors {
  const pick = <T extends z.ZodTypeAny>(schema: T, data: unknown): SignUpErrors => {
    const parsed = schema.safeParse(data)
    if (parsed.success) return {}
    const flat = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>
    const result: SignUpErrors = {}
    for (const [key, messages] of Object.entries(flat)) {
      result[key as keyof SignUpErrors] = messages?.[0]
    }
    return result
  }

  switch (step) {
    case 0:
      return pick(accountStepSchema, {
        email: values.email,
        password: values.password,
        agreeToTerms: values.agreeToTerms,
      })
    case 1:
      return pick(emailOtpStepSchema, {
        emailOtpCode: values.emailOtpCode ?? "",
      })
    case 2:
      return pick(nameStepSchema, {
        firstName: values.firstName,
        lastName: values.lastName,
      })
    case 3:
      return pick(middleNameStepSchema, { middleName: values.middleName ?? "" })
    case 4:
      return pick(genderStepSchema, { gender: values.gender })
    case 5:
      return pick(dobStepSchema, { dateOfBirth: values.dateOfBirth })
    case 6:
      return pick(addressStepSchema, {
        street: values.street,
        houseNumber: values.houseNumber ?? "",
        address: values.address,
      })
    case 7:
      return values.communityResolutionToken && values.communityMatch
        ? {}
        : { address: "Confirm your home pin and community." }
    case 8:
      return pick(proofStepSchema, {
        proofOfResidency: values.proofOfResidency,
        proofType: values.proofType,
      })
    case 9:
      return pick(phoneStepSchema, {
        phoneNumber: values.phoneNumber,
        phoneOtpCode: values.phoneOtpCode ?? "",
      })
    case 10:
      return {}
    default:
      return {}
  }
}
