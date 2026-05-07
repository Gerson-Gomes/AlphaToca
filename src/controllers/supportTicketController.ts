import { Request, Response, NextFunction } from 'express';
import { SupportUserRole } from '@prisma/client';
import { supportTicketService, SupportTicketError } from '../services/supportTicketService';
import { supportEmailService } from '../services/supportEmailService';
import {
  createSupportTicketSchema,
  listSupportTicketsQuerySchema,
} from '../utils/supportTicketValidation';
import { logger } from '../config/logger';

// Mapeia o Role global (TENANT|LANDLORD|ADMIN) para o SupportUserRole, que
// é uma cópia do conjunto de valores porém um enum Prisma separado. Uma
// futura divisão do Role principal (ex.: LANDLORD_VERIFIED vs LANDLORD_PENDING)
// NÃO deve retroativamente mudar o userRole histórico dos tickets — por isso
// a cópia e o mapeamento explícito.
function mapAuthorRole(role: string): SupportUserRole {
  switch (role) {
    case 'TENANT':
      return SupportUserRole.TENANT;
    case 'LANDLORD':
      return SupportUserRole.LANDLORD;
    case 'ADMIN':
      return SupportUserRole.ADMIN;
    default:
      // Roles futuros não mapeados caem em TENANT por segurança — o pior caso
      // é um ticket abrir com role "errado" para auditoria, que é melhor do que
      // 500 no caller. Logado para triage.
      logger.warn({ role }, '[supportTicket] unknown author role; defaulting to TENANT');
      return SupportUserRole.TENANT;
  }
}

export const supportTicketController = {
  /**
   * POST /api/support/tickets
   *
   * Abre um ticket de suporte. Qualquer usuário autenticado (TENANT, LANDLORD
   * ou ADMIN) pode abrir — a autorização é apenas "JWT presente". O servidor
   * gera o protocolo humano `SUP-AAMMDD-XXXX`, preenche `userId`/`userName`/
   * `userRole` a partir do `req.localUser` (nunca do body), e dispara a
   * notificação de abertura via supportEmailService (que é no-op quando
   * SUPPORT_EMAIL_ENABLED != 'true', conforme US-017).
   *
   * Falhas no envio do email NÃO derrubam a request — o serviço swallowa
   * internamente (contrato do US-017), então aqui não precisamos de try/catch
   * em volta do send.
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const payload = createSupportTicketSchema.parse(req.body);

      const ticket = await supportTicketService.create(
        {
          id: localUser.id,
          name: localUser.name,
          role: mapAuthorRole(localUser.role),
        },
        payload,
      );

      // Side-effect não-fatal: se o email falhar por qualquer razão, o ticket
      // já foi persistido e respondemos 201 normalmente. O próprio serviço
      // engole exceções de transport.send e loga — aqui só colocamos um
      // .catch defensivo caso o próprio sendTicketCreated lance síncrono
      // (não deveria, mas o contrato é "best-effort").
      void supportEmailService.sendTicketCreated(ticket).catch((err) => {
        logger.error(
          { err, ticketId: ticket.id, code: ticket.code },
          '[supportTicket] sendTicketCreated threw unexpectedly',
        );
      });

      return res.status(201).json({
        id: ticket.id,
        code: ticket.code,
        createdAt: ticket.createdAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof SupportTicketError) {
        return res.status(error.httpStatus).json({
          status: error.httpStatus,
          code: error.code,
          messages: [{ message: error.message }],
        });
      }
      next(error);
    }
  },

  /**
   * GET /api/admin/support/tickets
   *
   * Lista tickets de suporte para triage do admin. Requer role ADMIN — o
   * `requireRole` middleware no router já garantiu 401 (token ausente/inválido)
   * e 403 (role não-admin) antes de chegar aqui.
   *
   * Query params opcionais: status, role, from, to, page, pageSize. Todos
   * validados via Zod — erros caem no errorHandler global como 400
   * VALIDATION_ERROR.
   *
   * Response envelope: `{ data, page, pageSize, total }` ordenado por
   * createdAt DESC.
   */
  async listForAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = listSupportTicketsQuerySchema.parse(req.query);
      const result = await supportTicketService.list({
        status: parsed.status,
        role: parsed.role,
        from: parsed.from ? new Date(parsed.from) : undefined,
        to: parsed.to ? new Date(parsed.to) : undefined,
        page: parsed.page,
        pageSize: parsed.pageSize,
      });
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
};
