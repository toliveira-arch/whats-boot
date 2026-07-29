import { z } from 'zod';

const password = z
  .string()
  .min(8, 'A senha deve ter ao menos 8 caracteres')
  .max(128)
  .regex(/[a-z]/, 'Inclua uma letra minúscula')
  .regex(/[A-Z]/, 'Inclua uma letra maiúscula')
  .regex(/\d/, 'Inclua um número');

export const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password,
  companyName: z.string().min(2).max(160).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
