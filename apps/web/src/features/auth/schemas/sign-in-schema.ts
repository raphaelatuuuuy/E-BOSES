import { z } from "zod"

export const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(128, "Password must be 128 characters or fewer."),
})

export type SignInValues = z.infer<typeof signInSchema>

export type SignInErrors = Partial<Record<keyof SignInValues, string>>
