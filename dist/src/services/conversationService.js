"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.conversationService = void 0;
const db_1 = __importDefault(require("../config/db"));
exports.conversationService = {
    /**
     * Resolve (create-or-get) da thread canônica entre (landlord, tenant) para
     * um Property. Usa `prisma.conversation.upsert` com o where da chave única
     * composta (`conversations_property_landlord_tenant_key`), garantindo que
     * duas chamadas concorrentes com os mesmos parâmetros resultem em UMA única
     * linha — a constraint single-row da US-011 é quem protege a race (upsert
     * fica idempotente no caminho "linha existe"; no caminho "linha não existe",
     * o INSERT duplicado na segunda call é convertido pelo Prisma em SELECT da
     * linha recém-inserida pela primeira call).
     *
     * O `landlordId` é fornecido pelo controller a partir do Property — NUNCA
     * aceito de query params. Isso impede forjar threads com um landlord
     * diferente do real dono do imóvel (o índice composto incluiria landlordId
     * errado e criaria uma linha órfã).
     */
    async resolve(propertyId, landlordId, tenantId) {
        const row = await db_1.default.conversation.upsert({
            where: {
                conversations_property_landlord_tenant_key: {
                    propertyId,
                    landlordId,
                    tenantId,
                },
            },
            create: {
                propertyId,
                landlordId,
                tenantId,
            },
            update: {},
            select: {
                id: true,
                propertyId: true,
                landlordId: true,
                tenantId: true,
                createdAt: true,
            },
        });
        return {
            id: row.id,
            propertyId: row.propertyId,
            landlordId: row.landlordId,
            tenantId: row.tenantId,
            messages: [],
            createdAt: row.createdAt.toISOString(),
        };
    },
    /**
     * Lista as threads a que o caller pertence (como landlord OU tenant) para a
     * inbox `/chat`. Role-agnóstico: decidimos a identidade do contraparte via
     * comparação `conversation.landlordId === userId` — mais robusto do que ler
     * `req.localUser.role` (permite que o mesmo usuário apareça como tenant em
     * uma thread e landlord em outra).
     *
     * Conversas sem mensagens ainda aparecem na lista: `lastMessage=null` e
     * `lastMessageAt=conversation.createdAt` — o ordering DESC por lastMessageAt
     * naturalmente intercala threads novas (sem msg) entre threads antigas com
     * última mensagem recente.
     *
     * `unreadOnly=true` filtra em memória APÓS o join com a última mensagem —
     * fazer isso no SQL exigiria um subquery/EXISTS por linha; para o volume
     * esperado (~10-50 threads por landlord) o filtro in-process é barato e
     * mantém a query de base simples. Se a cardinalidade crescer muito, mover
     * para um EXISTS no WHERE via `$queryRaw` é trivial.
     */
    async list(userId, unreadOnly = false) {
        const rows = await db_1.default.conversation.findMany({
            where: {
                OR: [{ landlordId: userId }, { tenantId: userId }],
            },
            select: {
                id: true,
                propertyId: true,
                landlordId: true,
                tenantId: true,
                createdAt: true,
                lastMessageAt: true,
                landlord: {
                    select: {
                        id: true,
                        name: true,
                        isIdentityVerified: true,
                        identityVerifiedAt: true,
                    },
                },
                tenant: {
                    select: {
                        id: true,
                        name: true,
                        isIdentityVerified: true,
                        identityVerifiedAt: true,
                    },
                },
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { id: true, content: true, createdAt: true },
                },
            },
        });
        if (rows.length === 0)
            return [];
        // Segunda query: agrupa contagem de mensagens NÃO lidas, escritas pelo
        // OUTRO participante (authorId != userId), por conversationId. Uma query
        // para o conjunto inteiro evita N+1 e mantém o custo linear. Rows com
        // count > 0 marcam `unread=true`; ausentes ficam false por omissão.
        const unreadAgg = await db_1.default.conversationMessage.groupBy({
            by: ['conversationId'],
            where: {
                conversationId: { in: rows.map((r) => r.id) },
                readAt: null,
                authorId: { not: userId },
            },
            _count: { _all: true },
        });
        const unreadMap = new Map(unreadAgg.map((u) => [u.conversationId, (u._count?._all ?? 0) > 0]));
        const summaries = rows.map((row) => {
            const isUserLandlord = row.landlordId === userId;
            const counterpart = isUserLandlord ? row.tenant : row.landlord;
            const lastMsg = row.messages[0] ?? null;
            // US-006: prefer the authoritative lastMessageAt column (updated in the
            // createMessage transaction). Fall back to the included messages relation
            // for conversations predating the column backfill (rare now that the
            // migration populated existing rows), and finally to createdAt for
            // empty threads.
            const lastMessageAt = (row.lastMessageAt ?? lastMsg?.createdAt ?? row.createdAt).toISOString();
            return {
                id: row.id,
                counterpartName: counterpart.name,
                counterpartAvatarUrl: null,
                counterpartIsIdentityVerified: counterpart.isIdentityVerified,
                counterpartIdentityVerifiedAt: counterpart.identityVerifiedAt
                    ? counterpart.identityVerifiedAt.toISOString()
                    : null,
                lastMessage: lastMsg?.content ?? null,
                lastMessageAt,
                unread: unreadMap.get(row.id) ?? false,
                linkedPropertyId: row.propertyId,
                linkedTenantId: row.tenantId,
            };
        });
        const filtered = unreadOnly ? summaries.filter((s) => s.unread) : summaries;
        // ISO strings ordenam lexicograficamente = ordenação cronológica.
        filtered.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
        return filtered;
    },
    /**
     * LL-012 — GET /api/conversations/:id/messages paginado + read receipts.
     *
     * Paginação "página anterior a um cursor":
     *   - Sem `before`: retorna os `limit` itens mais recentes (orderBy createdAt
     *     DESC + take + reverse → ASC no retorno).
     *   - Com `before`: busca o `createdAt` da mensagem cursor (`before` é id,
     *     não timestamp — ids são oponíveis publicamente mas createdAt é o que
     *     define a ordem). Depois retorna os `limit` itens com `createdAt < cursor.createdAt`
     *     (ordenados DESC → reverse para ASC). Se o cursor não pertence à
     *     conversa (ou não existe), retorna `[]` — comportamento "fim da lista".
     *
     * Autorização é no CALLER: o controller já checou `conversation` existe e o
     * caller é landlord OU tenant. Este método assume esses invariantes — seu
     * único job é pegar a janela de mensagens e marcar como lidas as que foram
     * enviadas pelo OUTRO lado (`authorId != userId AND readAt IS NULL`).
     *
     * Retorna `markedReadIds` separado do payload principal pra LL-014 poder
     * emitir `conversation:message_read` via socket sem re-inferir quais rows
     * transicionaram (updateMany não retorna ids; fazemos um SELECT antes do
     * UPDATE — o race é mínimo: em pior caso outra request poderia ter marcado
     * concorrentemente e nossa segunda request marca 0 rows, sem divergência).
     */
    async listMessages(conversationId, userId, limit, before) {
        // Resolve o cursor em createdAt. Usamos findUnique em vez de findFirst
        // porque `id` é PK — um lookup direto. Se o cursor não existe ou pertence
        // a outra conversa, tratamos como "fim da lista" e retornamos []. Isso
        // também desarma cursor-forging entre conversas.
        let cursorCreatedAt = null;
        if (before) {
            const cursor = await db_1.default.conversationMessage.findUnique({
                where: { id: before },
                select: { conversationId: true, createdAt: true },
            });
            if (!cursor || cursor.conversationId !== conversationId) {
                return { messages: [], markedReadIds: [] };
            }
            cursorCreatedAt = cursor.createdAt;
        }
        const rows = await db_1.default.conversationMessage.findMany({
            where: {
                conversationId,
                ...(cursorCreatedAt ? { createdAt: { lt: cursorCreatedAt } } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                id: true,
                authorId: true,
                content: true,
                createdAt: true,
                readAt: true,
            },
        });
        // Reversão local transforma DESC (ordenação eficiente do take) em ASC
        // (contrato público).
        rows.reverse();
        // Read-receipt side effect: marca como lidas APENAS mensagens NOS ROWS
        // RETORNADOS que sejam do OUTRO participante e ainda não lidas. Batch
        // UPDATE usando `id IN (...)`. `updateMany` não retorna ids, então
        // preservamos a lista de ids a partir dos rows que acabamos de selecionar.
        const unreadFromOther = rows.filter((r) => r.authorId !== userId && r.readAt === null);
        const unreadIds = unreadFromOther.map((r) => r.id);
        const now = new Date();
        if (unreadIds.length > 0) {
            await db_1.default.conversationMessage.updateMany({
                where: { id: { in: unreadIds } },
                data: { readAt: now },
            });
        }
        const readAtByNewly = new Set(unreadIds);
        // Batch resolve author names (no relation in Prisma schema for ConversationMessage.author)
        const authorIds = [...new Set(rows.map((r) => r.authorId))];
        const authors = authorIds.length > 0
            ? await db_1.default.user.findMany({
                where: { id: { in: authorIds } },
                select: { id: true, name: true },
            })
            : [];
        const authorNameMap = new Map(authors.map((a) => [a.id, a.name]));
        const messages = rows.map((r) => ({
            id: r.id,
            conversationId,
            authorId: r.authorId,
            authorName: authorNameMap.get(r.authorId) ?? 'Usuário',
            content: r.content,
            createdAt: r.createdAt.toISOString(),
            readAt: readAtByNewly.has(r.id)
                ? now.toISOString()
                : r.readAt
                    ? r.readAt.toISOString()
                    : null,
            isMine: r.authorId === userId,
        }));
        return { messages, markedReadIds: unreadIds };
    },
    /**
     * LL-015 — mark-all-as-read. Marca TODAS as mensagens da thread ainda não
     * lidas cujo autor NÃO é o caller, retornando a lista de ids atingidos.
     *
     * Implementado com `UPDATE ... RETURNING` via `$queryRaw` (em vez do padrão
     * select-then-updateMany do LL-012) por dois motivos: (1) casa a redação da
     * PRD ("capture updated ids via RETURNING") byte-a-byte; (2) remove o SELECT
     * intermediário, o que fecha a janela de race entre ler/gravar — a transição
     * "unread → read" fica atômica numa única query. `updateMany` não expõe ids
     * atualizados no Prisma atual; `RETURNING` é a única rota direta aqui.
     *
     * O caller (controller) já validou participação via o mesmo guard
     * existence-hiding 404 de LL-012/LL-013; este método assume esse invariante e
     * só se preocupa com a semântica do UPDATE. Retorna `[]` quando não há nada
     * a marcar — o controller usa isso pra evitar emitir socket barulhento.
     */
    async markAllRead(conversationId, userId) {
        const rows = await db_1.default.$queryRaw `
      UPDATE "conversation_messages"
      SET "read_at" = NOW()
      WHERE "conversation_id" = ${conversationId}::uuid
        AND "author_id" != ${userId}::uuid
        AND "read_at" IS NULL
      RETURNING "id"
    `;
        return rows.map((r) => r.id);
    },
    /**
     * LL-013 / US-006 — Persiste uma mensagem nova na thread. Assume que o caller
     * já passou pelo guard do controller (existe a conversa + o caller é
     * participante); este método NÃO re-valida autorização para evitar um
     * segundo round-trip ao banco.
     *
     * Retorna a linha recém-criada no mesmo shape que o `listMessages` devolve —
     * o que permite reuso direto pelo socket emitter (LL-014) sem reshaping.
     * `readAt` sempre começa `null` numa mensagem recém-enviada: o próprio autor
     * não conta como leitor.
     *
     * US-006: o INSERT da mensagem e o UPDATE de `Conversation.lastMessageAt`
     * correm na mesma transação (`$transaction` com callback interativo). Assim
     * o ordering DESC por `lastMessageAt` usado pela inbox (GET /api/conversations)
     * nunca observa uma mensagem persistida com a thread "antiga" — um crash
     * entre os dois comandos desfaria o INSERT. `lastMessageAt` recebe
     * literalmente `message.createdAt` (não `new Date()`) para garantir que os
     * dois valores sejam byte-idênticos, o que facilita o debugging de ordenação.
     */
    async createMessage(conversationId, authorId, authorName, content) {
        const row = await db_1.default.$transaction(async (tx) => {
            const message = await tx.conversationMessage.create({
                data: {
                    conversationId,
                    authorId,
                    content,
                },
                select: {
                    id: true,
                    authorId: true,
                    content: true,
                    createdAt: true,
                    readAt: true,
                },
            });
            await tx.conversation.update({
                where: { id: conversationId },
                data: { lastMessageAt: message.createdAt },
            });
            return message;
        });
        return {
            id: row.id,
            conversationId,
            authorId: row.authorId,
            authorName,
            content: row.content,
            createdAt: row.createdAt.toISOString(),
            readAt: row.readAt ? row.readAt.toISOString() : null,
            isMine: true,
        };
    },
};
