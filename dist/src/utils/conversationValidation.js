"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConversationMessageBodySchema = exports.markConversationReadParamsSchema = exports.createConversationMessageParamsSchema = exports.listConversationMessagesQuerySchema = exports.listConversationMessagesParamsSchema = exports.listConversationsQuerySchema = exports.resolveConversationQuerySchema = void 0;
const zod_1 = require("zod");
// Query params de GET /api/conversations/resolve. Ambos os ids devem ser UUIDs
// canônicos — valores fora do formato retornam 400 VALIDATION_ERROR antes de
// qualquer acesso ao banco. `landlordId` NÃO vem da query: é derivado do
// Property.landlordId pelo controller, para impedir que um tenant forje um
// landlord diferente do real dono do imóvel (e assim crie linhas órfãs na
// tabela conversations).
exports.resolveConversationQuerySchema = zod_1.z.object({
    propertyId: zod_1.z.string().uuid(),
    tenantId: zod_1.z.string().uuid(),
});
// Query params de GET /api/conversations (LL-011 — inbox list). `unreadOnly`
// é opcional; quando presente precisa ser literalmente 'true' ou 'false' (é um
// query-string, então sempre chega como string). Valores inválidos disparam
// 400 VALIDATION_ERROR antes do DB — evita que "unreadOnly=1" silenciosamente
// não filtre e gaste round-trips.
exports.listConversationsQuerySchema = zod_1.z.object({
    unreadOnly: zod_1.z.enum(['true', 'false']).optional(),
});
// Path/query de GET /api/conversations/:id/messages (LL-012 — paginated
// history). `id` é o id da conversa (uuid). `before` é o cursor opcional: id
// da mensagem "mais nova já vista" pelo cliente — o servidor retorna o próximo
// lote ANTERIOR àquele id. `limit` vem como string via query; Zod coerce +
// clamp 1..100, default 50.
exports.listConversationMessagesParamsSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
exports.listConversationMessagesQuerySchema = zod_1.z.object({
    before: zod_1.z.string().uuid().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).optional().default(50),
});
// Path params de POST /api/conversations/:id/messages (LL-013 — send message).
// Compartilha a mesma validação do GET paginado — `id` deve ser UUID. Mantido
// separado do schema de LL-012 para não acoplar o POST à presença de `before` /
// `limit`, que são estritamente da leitura.
exports.createConversationMessageParamsSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
// Path params de POST /api/conversations/:id/read (LL-015 — mark-all-as-read).
// Mesma regra de UUID no path; mantido separado dos schemas acima para não
// acoplar a semântica de três endpoints diferentes no mesmo tipo. Não há body
// (o cliente só dispara a intenção de marcar todo o backlog como lido).
exports.markConversationReadParamsSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
// Body de POST /api/conversations/:id/messages. `content.min(1)` rejeita
// strings vazias com 400 antes de tocar o banco — evita linhas vazias na
// tabela que seriam inúteis para o leitor e ainda disparariam o emit socket
// (LL-014). `max(4000)` limita o tamanho do conteúdo em um único turno; acima
// disso o cliente deve paginar em múltiplas mensagens. NÃO usamos `.trim()` na
// validação — whitespace significativo pertence ao autor, e trimming no server
// silenciaria mensagens que parecem vazias mas carregam conteúdo intencional
// (ex: "\n" para quebra explícita).
exports.createConversationMessageBodySchema = zod_1.z.object({
    content: zod_1.z.string().min(1).max(4000),
});
