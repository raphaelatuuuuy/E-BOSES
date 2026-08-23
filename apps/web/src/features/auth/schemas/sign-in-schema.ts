import { z } from "zod"
import { normalizePhoneNumber } from "@/lib/phone"

export type SignInMode = "email" | "phone"

export { normalizePhoneNumber }

export const signInSchema = z
  .object({
    mode: z.enum(["email", "phone"]),
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
        message:
          values.mode === "phone" ? "Enter your phone number." : "Enter your email address.",
      })
      return
    }

    if (values.mode === "email") {
      if (!z.email().safeParse(identifier).success) {
        ctx.addIssue({
          code: "custom",
          path: ["identifier"],
          message: "Enter a valid email address.",
        })
      }
      return
    }

    if (!normalizePhoneNumber(identifier)) {
      ctx.addIssue({
        code: "custom",
        path: ["identifier"],
        message: "Enter the 10 digits after +63, like 9171234567.",
      })
    }
  })

export type SignInValues = z.infer<typeof signInSchema>

export type SignInErrors = Partial<Record<"identifier" | "password", string>>
