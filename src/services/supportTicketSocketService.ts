import { getIO } from '../config/socket';
import { logger } from '../config/logger';

interface TicketMessagePayload {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: string;
  content: string;
  timestamp: Date;
}

function safeEmit(room: string, event: string, data: unknown, context: Record<string, unknown>): void {
  try {
    const io = getIO();
    io.to(room).emit(event, data);
  } catch (err) {
    logger.error({ err, room, event, ...context }, '[supportTicketSocket] emit failed');
  }
}

export const supportTicketSocketService = {
  /**
   * Emite nova mensagem de ticket para:
   * - ticket:<ticketId> (todos acompanhando o ticket)
   * - user:<openerId> (o landlord/tenant que abriu)
   * - provider:all (admins logados)
   */
  emitTicketMessage(
    ticketId: string,
    openerId: string,
    payload: { ticketId: string; message: TicketMessagePayload },
  ): void {
    const ctx = { ticketId, messageId: payload.message.id, openerId };

    safeEmit(`ticket:${ticketId}`, 'support_ticket_message', payload, ctx);
    safeEmit(`user:${openerId}`, 'support_ticket_message', payload, ctx);
    safeEmit('provider:all', 'support_ticket_message', payload, ctx);

    logger.info(ctx, '[supportTicketSocket] ticket_message emitted');
  },

  /**
   * Emite mudança de status/resolution do ticket.
   */
  emitTicketUpdated(
    ticketId: string,
    openerId: string,
    payload: { ticketId: string; status: string; resolution?: string | null },
  ): void {
    const ctx = { ticketId, status: payload.status };

    safeEmit(`ticket:${ticketId}`, 'support_ticket_updated', payload, ctx);
    safeEmit(`user:${openerId}`, 'support_ticket_updated', payload, ctx);
    safeEmit('provider:all', 'support_ticket_updated', payload, ctx);

    logger.info(ctx, '[supportTicketSocket] ticket_updated emitted');
  },
};
