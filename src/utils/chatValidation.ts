import { z } from 'zod';
import { SenderType, ChatStatus } from '@prisma/client';

export const sendMessageSchema = z.object({
  sessionId: z.string().uuid(),
  senderType: z.nativeEnum(SenderType),
  content: z.string().min(1),
  mediaUrl: z.string().url().optional(),
});

export const createSessionSchema = z.object({
  tenantId: z.string().uuid(),
});

export const updateSessionStatusSchema = z.object({
  status: z.nativeEnum(ChatStatus),
});
