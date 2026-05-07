import { getIO } from '../config/socket';
import { logger } from '../config/logger';

interface MessagePayload {
  id: string;
  sessionId: string;
  senderType: string;
  content: string;
  mediaUrl?: string | null;
  status?: string;
  timestamp: Date;
  wamid?: string | null;
}

export interface NewMessageEvent {
  sessionId: string;
  message: MessagePayload;
}

export interface SessionUpdatedEvent {
  sessionId: string;
  status: string;
}

function safeEmit(room: string, event: string, data: unknown, context: Record<string, unknown>): void {
  try {
    const io = getIO();
    io.to(room).emit(event, data);
  } catch (err) {
    logger.error({ err, room, event, ...context }, '[chatSocket] emit failed');
  }
}

export const chatSocketService = {
  emitNewMessage(
    tenantId: string,
    payload: NewMessageEvent,
    landlordId?: string | null,
  ): void {
    const { message } = payload;
    const ctx = { tenantId, sessionId: payload.sessionId, messageId: message.id, landlordId };

    safeEmit(`user:${tenantId}`, 'new_message', payload, ctx);

    if (message.senderType === 'TENANT' || message.senderType === 'BOT') {
      if (landlordId) {
        safeEmit(`landlord:${landlordId}`, 'new_message', payload, ctx);
      }
      safeEmit('provider:all', 'new_message', payload, ctx);
    }

    logger.info(ctx, '[chatSocket] new_message emitted');
  },

  emitSessionUpdated(
    tenantId: string,
    payload: SessionUpdatedEvent,
    landlordId?: string | null,
  ): void {
    const ctx = { tenantId, sessionId: payload.sessionId, status: payload.status, landlordId };

    safeEmit(`user:${tenantId}`, 'session_updated', payload, ctx);
    if (landlordId) {
      safeEmit(`landlord:${landlordId}`, 'session_updated', payload, ctx);
    }
    safeEmit('provider:all', 'session_updated', payload, ctx);

    logger.info(ctx, '[chatSocket] session_updated emitted');
  },
};
