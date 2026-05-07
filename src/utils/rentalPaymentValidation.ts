import { z } from 'zod';
import { RentalPaymentStatus } from '@prisma/client';

export const updateCurrentPaymentSchema = z.object({
  status: z.nativeEnum(RentalPaymentStatus),
});

export type UpdateCurrentPaymentInput = z.infer<typeof updateCurrentPaymentSchema>;

// LL-009 — GET /api/properties/:propertyId/payments?tenantId=<uuid>
// Ambos os UUIDs são obrigatórios (400 VALIDATION_ERROR). `propertyId` chega
// no path via `req.params`, `tenantId` na query string via `req.query`.
export const listPaymentsParamsSchema = z.object({
  propertyId: z.string().uuid(),
});

export const listPaymentsQuerySchema = z.object({
  tenantId: z.string().uuid(),
});
