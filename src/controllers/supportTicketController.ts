import { Request, Response, NextFunction } from 'express';
import { SupportUserRole } from '@prisma/client';
import { supportTicketService, SupportTicketError } from '../services/supportTicketService';
import { supportTicketMessageService, SupportTicketMessageError } from '../services/supportTicketMessageService';
import { supportTicketSocketService } from '../services/supportTicketSocketService';
import { supportEmailService } from '../services/supportEmailService';
import {
  createSupportTicketSchema,
  listSupportTicketsQuerySchema,
  updateSupportTicketSchema,
  sendTicketMessageSchema,
  getTicketMessagesQuerySchema,
} from '../utils/supportTicketValidation';
import { z } from 'zod';
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

      // Echo title/description/status back to the client so the frontend
      // /support screen can display the ticket immediately without having
      // to preserve the request body (US-009). Shape matches
      // SupportTicketUserView — same contract the US-003 listForUser
      // endpoint returns, so the frontend can reuse the same parser.
      return res.status(201).json({
        id: ticket.id,
        code: ticket.code,
        title: ticket.title,
        description: ticket.description,
        createdAt: ticket.createdAt.toISOString(),
        status: ticket.status,
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
   * GET /api/support/tickets
   *
   * Lista os tickets do próprio usuário autenticado (US-003). O filtro por
   * `userId = req.localUser.id` é aplicado no service — o controller apenas
   * extrai o user do req e devolve o array ordenado por createdAt DESC.
   *
   * Resposta: array simples (não o envelope paginado do admin list), porque
   * o volume esperado por usuário é baixo (<100 tickets) e o frontend já
   * tem cache local da tela /support.
   */
  async listForUser(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const tickets = await supportTicketService.listForUser(localUser.id);
      return res.status(200).json(tickets);
    } catch (error) {
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

  /**
   * PUT /api/admin/support/tickets/:id
   *
   * Atualização admin-only de status / resolution / assignedToId. A auth
   * (JWT + role=ADMIN) é gated no router via global authStack + requireRole.
   *
   * Regras:
   *  - Param `id` precisa ser UUID (400 VALIDATION_ERROR caso contrário).
   *  - Body precisa conter pelo menos um campo; `status=RESOLVED` requer
   *    `resolution` na mesma request — Zod schema cobre essas regras.
   *  - 404 TICKET_NOT_FOUND se o ticket não existe.
   *  - 400 ASSIGNEE_NOT_FOUND se `assignedToId` aponta para um User inexistente.
   *  - Em mudança de `status`, dispara `supportEmailService.sendTicketUpdated`
   *    (best-effort, falhas não derrubam o 200).
   *
   * Resposta: `SupportTicketAdminView` — shape idêntica ao item do GET list.
   */
  async updateForAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const idParsed = z.string().uuid().safeParse(req.params.id);
      if (!idParsed.success) {
        return res.status(400).json({
          status: 400,
          code: 'VALIDATION_ERROR',
          messages: idParsed.error.errors.map((e) => ({
            path: ['id', ...e.path].join('.'),
            message: e.message,
          })),
        });
      }

      const payload = updateSupportTicketSchema.parse(req.body);

      const statusChanging = payload.status !== undefined;

      const view = await supportTicketService.updateForAdmin(idParsed.data, payload);

      // Side-effect não-fatal: só dispara email quando o status foi tocado
      // na request. Resoluções/assignees sem mudança de status não alertam
      // o canal (ruído).
      if (statusChanging) {
        // Refetch é caro — usamos o shape retornado pelo service para montar
        // um objeto compatível com SupportTicket (colunas bases + status +
        // resolution). O sendTicketUpdated lê `id`, `code`, `status`,
        // `userName`, `userRole`, `resolution` — tudo disponível na view
        // exceto `userRole`/`userName`: esses vivem no ticket, não no user.
        // O service já devolve a row via include; mas a view omite userRole.
        // Solução: refetchamos o shape necessário através da view + a row
        // interna (via segundo include leve). Para simplicidade e manter o
        // service como única porta, chamamos o email com um shape "mínimo
        // compatível" usando os campos que a view carrega — o build do
        // envelope lê apenas campos públicos expostos na view aqui (id,
        // code, status, resolution). Para userRole/userName, lemos do user
        // projetado no include (sempre presente para tickets com opener
        // existente).
        const ticketForEmail = {
          id: view.id,
          code: view.code,
          title: view.title,
          description: view.description,
          userId: view.user?.id ?? '',
          userName: view.user?.name ?? '',
          userRole: (view.user?.role ?? 'TENANT') as any,
          status: view.status,
          resolution: view.resolution,
          assignedToId: view.assignedTo?.id ?? null,
          createdAt: new Date(view.createdAt),
          updatedAt: new Date(view.updatedAt),
        };
        void supportEmailService.sendTicketUpdated(ticketForEmail).catch((err) => {
          logger.error(
            { err, ticketId: view.id, code: view.code },
            '[supportTicket] sendTicketUpdated threw unexpectedly',
          );
        });

        // Emite mudança de status via WebSocket para o opener e admins
        if (view.user?.id) {
          supportTicketSocketService.emitTicketUpdated(view.id, view.user.id, {
            ticketId: view.id,
            status: view.status,
            resolution: view.resolution,
          });
        }
      }

      return res.status(200).json(view);
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
   * GET /api/support/tickets
   *
   * Lista os tickets do próprio usuário autenticado (tenant, landlord ou admin).
  /**

  /**
   * GET /api/support/tickets/:id/messages
   *
   * Lista todas as mensagens de um ticket. Acesso permitido ao opener do ticket
   * ou a qualquer admin.
   */
  async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const ticketId = req.params.id;
      const ticket = await supportTicketService.findById(ticketId);

      if (!ticket) {
        return res.status(404).json({
          status: 404,
          code: 'TICKET_NOT_FOUND',
          messages: [{ message: `Ticket ${ticketId} not found.` }],
        });
      }

      const isOpener = ticket.userId === localUser.id;
      const isAdmin = localUser.role === 'ADMIN';
      if (!isOpener && !isAdmin) {
        return res.status(403).json({
          status: 403,
          code: 'FORBIDDEN',
          messages: [{ message: 'Only the ticket opener or admins can view messages.' }],
        });
      }

      const { since } = getTicketMessagesQuerySchema.parse(req.query);
      const messages = await supportTicketMessageService.list(
        ticketId,
        since ? new Date(since) : undefined,
      );
      return res.status(200).json(messages);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/support/tickets/:id/messages
   *
   * Envia uma mensagem no chat do ticket. Acesso: opener do ticket ou admin.
   * Side-effect: emite evento support_ticket_message via WebSocket para
   * o opener e para admins.
   */
  async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const ticketId = req.params.id;
      const { content, clientMessageId } = sendTicketMessageSchema.parse(req.body);

      const message = await supportTicketMessageService.send({
        ticketId,
        senderId: localUser.id,
        senderRole: mapAuthorRole(localUser.role),
        content,
        clientMessageId,
      });

      // Emite via WebSocket para o opener e admins
      const ticket = await supportTicketService.findById(ticketId);
      if (ticket) {
        supportTicketSocketService.emitTicketMessage(ticketId, ticket.userId, {
          ticketId,
          message: {
            id: message.id,
            ticketId: message.ticketId,
            senderId: message.senderId,
            senderRole: message.senderRole,
            content: message.content,
            timestamp: message.timestamp,
          },
        });
      }

      return res.status(201).json(message);
    } catch (error) {
      if (error instanceof SupportTicketMessageError) {
        return res.status(error.httpStatus).json({
          status: error.httpStatus,
          code: error.code,
          messages: [{ message: error.message }],
        });
      }
      next(error);
    }
  },
};
