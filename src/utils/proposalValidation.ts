import { z } from 'zod';
import { ProposalStatus } from '@prisma/client';

export const createProposalSchema = z.object({
  propertyId: z.string().uuid(),
  tenantId: z.string().uuid(),
  proposedPrice: z.number().positive(),
  message: z.string().optional(),
});

export const updateProposalStatusSchema = z.object({
  status: z.nativeEnum(ProposalStatus),
});

export const listProposalsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  landlordId: z.string().uuid().optional(),
});
