"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportTicketSocketService = void 0;
const socket_1 = require("../config/socket");
const logger_1 = require("../config/logger");
function safeEmit(room, event, data, context) {
    try {
        const io = (0, socket_1.getIO)();
        io.to(room).emit(event, data);
    }
    catch (err) {
        logger_1.logger.error({ err, room, event, ...context }, '[supportTicketSocket] emit failed');
    }
}
exports.supportTicketSocketService = {
    /**
     * Emite nova mensagem de ticket para:
     * - ticket:<ticketId> (todos acompanhando o ticket)
     * - user:<openerId> (o landlord/tenant que abriu)
     * - provider:all (admins logados)
     */
    emitTicketMessage(ticketId, openerId, payload) {
        const ctx = { ticketId, messageId: payload.message.id, openerId };
        safeEmit(`ticket:${ticketId}`, 'support_ticket_message', payload, ctx);
        safeEmit(`user:${openerId}`, 'support_ticket_message', payload, ctx);
        safeEmit('provider:all', 'support_ticket_message', payload, ctx);
        logger_1.logger.info(ctx, '[supportTicketSocket] ticket_message emitted');
    },
    /**
     * Emite mudança de status/resolution do ticket.
     */
    emitTicketUpdated(ticketId, openerId, payload) {
        const ctx = { ticketId, status: payload.status };
        safeEmit(`ticket:${ticketId}`, 'support_ticket_updated', payload, ctx);
        safeEmit(`user:${openerId}`, 'support_ticket_updated', payload, ctx);
        safeEmit('provider:all', 'support_ticket_updated', payload, ctx);
        logger_1.logger.info(ctx, '[supportTicketSocket] ticket_updated emitted');
    },
};
