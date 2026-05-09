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
   */
  async list(ticketId: string) {
    return prisma.supportTicketMessage.findMany({
      where: { ticketId },
      orderBy: { timestamp: 'asc' },
    });
  },

  /**
   * Envia uma mensagem no ticket. Valida que:
   * - O ticket existe e está OPEN
   * - O sender é o opener do ticket ou um admin
   */
  async send(params: {
    ticketId: string;
    senderId: string;
    senderRole: SupportUserRole;
    content: string;
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

    return prisma.supportTicketMessage.create({
      data: {
        ticketId: params.ticketId,
        senderId: params.senderId,
        senderRole: params.senderRole,
        content: params.content,
      },
    });
  },
};
