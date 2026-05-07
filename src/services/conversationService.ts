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
};
