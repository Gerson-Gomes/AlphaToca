import { z } from 'zod';

// Query params de GET /api/conversations/resolve. Ambos os ids devem ser UUIDs
// canônicos — valores fora do formato retornam 400 VALIDATION_ERROR antes de
// qualquer acesso ao banco. `landlordId` NÃO vem da query: é derivado do
// Property.landlordId pelo controller, para impedir que um tenant forje um
// landlord diferente do real dono do imóvel (e assim crie linhas órfãs na
// tabela conversations).
export const resolveConversationQuerySchema = z.object({
  propertyId: z.string().uuid(),
  tenantId: z.string().uuid(),
});

export type ResolveConversationQuery = z.infer<typeof resolveConversationQuerySchema>;

// Query params de GET /api/conversations (LL-011 — inbox list). `unreadOnly`
// é opcional; quando presente precisa ser literalmente 'true' ou 'false' (é um
// query-string, então sempre chega como string). Valores inválidos disparam
// 400 VALIDATION_ERROR antes do DB — evita que "unreadOnly=1" silenciosamente
// não filtre e gaste round-trips.
export const listConversationsQuerySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
});

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
