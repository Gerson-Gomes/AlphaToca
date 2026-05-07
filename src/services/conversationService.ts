import prisma from '../config/db';

// Forma da resposta de GET /api/conversations/resolve. `messages` é sempre []
// neste PRD — a tabela `conversations` só carrega metadata da thread; o
// histórico de mensagens é uma tabela futura (fora do escopo US-012).
export type ConversationView = {
  id: string;
  propertyId: string;
  landlordId: string;
  tenantId: string;
  messages: unknown[];
  createdAt: string;
};

// Forma da resposta de GET /api/conversations (LL-011 — lista inbox). Uma linha
// por thread a que o caller pertence (como landlord OU tenant). `counterpart*`
// referencia o OUTRO participante — landlord vê tenant, tenant vê landlord.
// `linkedTenantId` é SEMPRE o tenantId da thread, independente do papel do
// caller (o cliente usa para linkar para a ficha de aluguel do tenant).
export type ConversationSummary = {
  id: string;
  counterpartName: string;
  counterpartAvatarUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: string;
  unread: boolean;
  linkedPropertyId: string;
  linkedTenantId: string;
};

export const conversationService = {
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
  async resolve(
    propertyId: string,
    landlordId: string,
    tenantId: string,
  ): Promise<ConversationView> {
    const row = await prisma.conversation.upsert({
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
  async list(userId: string, unreadOnly: boolean = false): Promise<ConversationSummary[]> {
    const rows = await prisma.conversation.findMany({
      where: {
        OR: [{ landlordId: userId }, { tenantId: userId }],
      },
      select: {
        id: true,
        propertyId: true,
        landlordId: true,
        tenantId: true,
        createdAt: true,
        landlord: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, content: true, createdAt: true },
        },
      },
    });

    if (rows.length === 0) return [];

    // Segunda query: agrupa contagem de mensagens NÃO lidas, escritas pelo
    // OUTRO participante (authorId != userId), por conversationId. Uma query
    // para o conjunto inteiro evita N+1 e mantém o custo linear. Rows com
    // count > 0 marcam `unread=true`; ausentes ficam false por omissão.
    const unreadAgg = await prisma.conversationMessage.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: rows.map((r) => r.id) },
        readAt: null,
        authorId: { not: userId },
      },
      _count: { _all: true },
    });
    const unreadMap = new Map<string, boolean>(
      unreadAgg.map((u) => [u.conversationId, (u._count?._all ?? 0) > 0]),
    );

    const summaries: ConversationSummary[] = rows.map((row) => {
      const isUserLandlord = row.landlordId === userId;
      const counterpart = isUserLandlord ? row.tenant : row.landlord;
      const lastMsg = row.messages[0] ?? null;
      const lastMessageAt = (lastMsg?.createdAt ?? row.createdAt).toISOString();
      return {
        id: row.id,
        counterpartName: counterpart.name,
        counterpartAvatarUrl: null,
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
};
