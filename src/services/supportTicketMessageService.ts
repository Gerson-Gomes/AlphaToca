import prisma from '../config/db';
import type { SupportUserRole } from '@prisma/client';

export class SupportTicketMessageError extends Error {
  constructor(
    public httpStatus: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SupportTicketMessageError';
  }
}

export const supportTicketMessageService = {
  /**
   * Lista todas as mensagens de um ticket, ordenadas por timestamp ASC.
   * O controller já verificou que o caller é o opener ou admin.
   *
   * @param since Se informado, retorna apenas mensagens com timestamp > since.
   *   Fecha o gap entre o carregamento REST e a assinatura WebSocket.
   */
  async list(ticketId: string, since?: Date) {
    const where: any = { ticketId };
    if (since) where.timestamp = { gt: since };
    return prisma.supportTicketMessage.findMany({
      where,
      orderBy: { timestamp: 'asc' },
    });
  },

  /**
   * Envia uma mensagem no ticket. Valida que:
   * - O ticket existe e está OPEN
   * - O sender é o opener do ticket ou um admin
   *
   * Idempotência via clientMessageId: se o cliente enviar um UUID que
   * já existe no banco, retorna a mensagem existente em vez de criar
   * duplicata (HTTP 200 com o registro original).
   */
  async send(params: {
    ticketId: string;
    senderId: string;
    senderRole: SupportUserRole;
    content: string;
    clientMessageId?: string;
  }) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: params.ticketId },
    });

    if (!ticket) {
      throw new SupportTicketMessageError(
        404,
        'TICKET_NOT_FOUND',
        `Ticket ${params.ticketId} not found.`,
      );
    }

    if (ticket.status === 'RESOLVED') {
      throw new SupportTicketMessageError(
        400,
        'TICKET_RESOLVED',
        'Cannot send messages to a resolved ticket.',
      );
    }

    // Admin pode responder qualquer ticket; opener só o próprio
    if (params.senderRole !== 'ADMIN' && ticket.userId !== params.senderId) {
      throw new SupportTicketMessageError(
        403,
        'FORBIDDEN',
        'Only the ticket opener or an admin can send messages.',
      );
    }

    // Idempotência: se clientMessageId já existe, retorna msg existente
    if (params.clientMessageId) {
      const existing = await prisma.supportTicketMessage.findUnique({
        where: { clientMessageId: params.clientMessageId },
      });
      if (existing) return existing;
    }

    return prisma.supportTicketMessage.create({
      data: {
        ticketId: params.ticketId,
        senderId: params.senderId,
        senderRole: params.senderRole,
        content: params.content,
        clientMessageId: params.clientMessageId,
      },
    });
  },
};
