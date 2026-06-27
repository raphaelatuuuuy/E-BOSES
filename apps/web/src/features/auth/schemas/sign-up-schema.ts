import { z } from "zod"

export const signUpSchema = z
  .object({
    firstName: z.string().min(1, "First name is required.").max(50, "First name must be 50 characters or fewer."),
    middleName: z.string().max(50, "Middle name must be 50 characters or fewer.").optional().default(""),
    lastName: z.string().min(1, "Last name is required.").max(50, "Last name must be 50 characters or fewer."),
    dateOfBirth: z.string().min(1, "Date of birth is required."),
    address: z.string().min(5, "Enter a valid address.").max(200, "Address must be 200 characters or fewer."),
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
