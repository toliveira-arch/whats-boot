import { z } from 'zod';

export const createCompanySchema = z.object({
  name: z.string().min(2).max(120),
  legalName: z.string().max(160).nullable().optional(),
  document: z.string().max(20).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  closerName: z.string().max(120).nullable().optional(),
  closerPhone: z.string().max(20).nullable().optional(),
});

export const updateCompanySchema = createCompanySchema.partial();
