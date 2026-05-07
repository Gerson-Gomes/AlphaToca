import prisma from '../config/db';
import { logger } from '../config/logger';

// Dedup window para viewers autenticados: F5 do mesmo usuário logado dentro de
// 24h não incrementa o contador. Visitantes anônimos (viewerId=null) sempre
// inserem linha — sem identidade estável não dá para deduplicar.
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export const profileViewService = {
  /**
   * Registra uma abertura do perfil público do landlord. Chamada fire-and-forget
   * pelo controller — erros são logados mas não propagados, porque uma falha no
   * tracking não deve derrubar o GET da propriedade.
   *
   * Regras (LL-001):
   *   - viewerId null (anônimo): sempre insere uma linha.
   *   - viewerId não-null: verifica se já existe uma linha (landlordId, viewerId)
   *     dentro da janela de 24h. Se sim, não insere. Se não, insere.
   */
  async record(landlordId: string, viewerId: string | null = null): Promise<void> {
    try {
      if (viewerId) {
        const since = new Date(Date.now() - DEDUP_WINDOW_MS);
        const recent = await prisma.profileView.findFirst({
          where: {
            landlordId,
            viewerId,
            viewedAt: { gte: since },
          },
          select: { id: true },
        });
        if (recent) return;
      }

      await prisma.profileView.create({
        data: {
          landlordId,
          viewerId,
        },
      });
    } catch (err) {
      logger.error({ err, landlordId, viewerId }, '[profileViewService] record failed');
    }
  },
};
