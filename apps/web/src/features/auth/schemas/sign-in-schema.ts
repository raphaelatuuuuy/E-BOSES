import { z } from "zod"

export const signInSchema = z
  .object({
    identifier: z.string(),
    password: z
      .string()
      .min(1, "Enter your password.")
      .max(128, "Password must be 128 characters or fewer."),
  })
  .superRefine((values, ctx) => {
    const identifier = values.identifier.trim()

    if (identifier === "") {
      ctx.addIssue({
        code: "custom",
        path: ["identifier"],
        message: "Enter your email address.",
      })
      return
    }

    if (!z.email().safeParse(identifier).success) {
      ctx.addIssue({
        code: "custom",
        path: ["identifier"],
        message: "Enter a valid email address.",
      })
    }
  })

export type SignInValues = z.infer<typeof signInSchema>

export type SignInErrors = Partial<Record<"identifier" | "password", string>>
