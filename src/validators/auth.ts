import { z } from "zod";
import { emailSchema, passwordSchema } from "./common";

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(72),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const acceptInviteSchema = z
  .object({
    token: z.string().regex(/^[a-f\d]{64}$/, "This invite link is invalid"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
