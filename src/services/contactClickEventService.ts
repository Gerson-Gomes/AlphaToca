import prisma from '../config/db';
import { logger } from '../config/logger';

export const contactClickEventService = {
  /**
   * Registra um evento de clique em "Contatar" para um Property. Ao contrário
   * de ProfileView (24h) e PropertyView (1h), NÃO há dedup — analytics de
   * cliques deve contar cada intenção de contato, inclusive a mesma pessoa
   * clicando várias vezes (sinal de alta intenção).
   *
   * Erros de DB são logados e re-propagados: o controller usa este retorno
   * para decidir o status HTTP (201 em sucesso). Diferente do padrão
   * fire-and-forget de view tracking, o cliente está esperando explicitamente
   * o 201 — se o insert falhar, é legítimo retornar 500 para o frontend
   * reportar e tentar de novo.
   */
  async record(propertyId: string, viewerId: string | null = null): Promise<void> {
    try {
      await prisma.contactClickEvent.create({
        data: {
          propertyId,
          viewerId,
        },
      });
    } catch (err) {
      logger.error({ err, propertyId, viewerId }, '[contactClickEventService] record failed');
      throw err;
    }
  },
};
