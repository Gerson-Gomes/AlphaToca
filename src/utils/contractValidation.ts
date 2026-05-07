import { z } from 'zod';
import { ContractStatus, ContractDocumentStatus, PaymentStatus } from '@prisma/client';

export const createContractSchema = z.object({
  propertyId: z.string().uuid(),
  tenantId: z.string().uuid(),
  landlordId: z.string().uuid(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  monthlyRent: z.number().positive(),
  dueDay: z.number().int().min(1).max(31),
  pdfUrl: z.string().url().optional(),
});

export const updateContractStatusSchema = z.object({
  status: z.nativeEnum(ContractStatus),
});

export const updatePaymentStatusSchema = z.object({
  status: z.nativeEnum(PaymentStatus),
  paidDate: z.string().datetime().optional(),
});

// Query params para GET /api/contracts?propertyId=&tenantId= (US-014). Ambos
// obrigatórios e em formato UUID canônico — qualquer valor fora do formato
// resulta em 400 VALIDATION_ERROR antes de qualquer acesso ao banco.
export const getContractQuerySchema = z.object({
  propertyId: z.string().uuid(),
  tenantId: z.string().uuid(),
});

export type GetContractQuery = z.infer<typeof getContractQuerySchema>;

// Body do PATCH /api/contracts/:id/document-status (LL-016). O único campo
// é `documentStatus`, validado contra o enum Prisma — qualquer valor fora
// de PENDING_DOCUMENTS/AWAITING_SIGNATURE/APPROVED retorna 400 VALIDATION_ERROR
// sem tocar no banco.
export const updateContractDocumentStatusSchema = z.object({
  documentStatus: z.nativeEnum(ContractDocumentStatus),
});

export type UpdateContractDocumentStatusInput = z.infer<
  typeof updateContractDocumentStatusSchema
>;
