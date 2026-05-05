import { z } from 'zod';
import { ContractStatus, PaymentStatus } from '@prisma/client';

export const createContractSchema = z.object({
  propertyId: z.string().uuid(),
  tenantId: z.string().uuid(),
  landlordId: z.string().uuid(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  monthlyRent: z.number().positive(),
  dueDay: z.number().int().min(1).max(31),
  contractUrl: z.string().url().optional(),
});

export const updateContractStatusSchema = z.object({
  status: z.nativeEnum(ContractStatus),
});

export const updatePaymentStatusSchema = z.object({
  status: z.nativeEnum(PaymentStatus),
  paidDate: z.string().datetime().optional(),
});
