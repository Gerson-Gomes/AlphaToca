"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatSocketService = void 0;
const socket_1 = require("../config/socket");
const logger_1 = require("../config/logger");
function safeEmit(room, event, data, context) {
    try {
        const io = (0, socket_1.getIO)();
        io.to(room).emit(event, data);
    }
    catch (err) {
        logger_1.logger.error({ err, room, event, ...context }, '[chatSocket] emit failed');
    }
}
exports.chatSocketService = {
    emitNewMessage(tenantId, payload, landlordId) {
        const { message } = payload;
        const ctx = { tenantId, sessionId: payload.sessionId, messageId: message.id, landlordId };
        safeEmit(`user:${tenantId}`, 'new_message', payload, ctx);
        if (message.senderType === 'TENANT' || message.senderType === 'BOT') {
            if (landlordId) {
                safeEmit(`landlord:${landlordId}`, 'new_message', payload, ctx);
            }
            safeEmit('provider:all', 'new_message', payload, ctx);
        }
        logger_1.logger.info(ctx, '[chatSocket] new_message emitted');
    },
    emitSessionUpdated(tenantId, payload, landlordId) {
        const ctx = { tenantId, sessionId: payload.sessionId, status: payload.status, landlordId };
        safeEmit(`user:${tenantId}`, 'session_updated', payload, ctx);
        if (landlordId) {
            safeEmit(`landlord:${landlordId}`, 'session_updated', payload, ctx);
        }
        safeEmit('provider:all', 'session_updated', payload, ctx);
        logger_1.logger.info(ctx, '[chatSocket] session_updated emitted');
    },
};
