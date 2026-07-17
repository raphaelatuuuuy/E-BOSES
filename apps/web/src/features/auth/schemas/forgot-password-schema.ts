import { z } from "zod"

export const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address."),
})

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>

export type ForgotPasswordErrors = Partial<Record<keyof ForgotPasswordValues, string>>
