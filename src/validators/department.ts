import { z } from "zod";
import { emailSchema, idSchema, paletteColorSchema, personNameSchema } from "./common";

const name = z.string().trim().min(2, "Enter a department name").max(60);
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,8}$/, "Use 2 to 8 letters or digits");
const description = z.string().trim().max(500).default("");

export const managerAssignmentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), userId: idSchema }),
  z.object({ mode: z.literal("new"), name: personNameSchema, email: emailSchema }),
]);
export type ManagerAssignment = z.infer<typeof managerAssignmentSchema>;

export const createDepartmentSchema = z.object({
  name,
  code,
  description,
  color: paletteColorSchema,
  manager: managerAssignmentSchema,
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({
    name,
    code,
    description: z.string().trim().max(500),
    color: paletteColorSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
