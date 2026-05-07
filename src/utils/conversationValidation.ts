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
