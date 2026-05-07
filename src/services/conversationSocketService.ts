import { getIO } from '../config/socket';
import { logger } from '../config/logger';
import type { ConversationMessageView } from './conversationService';

// Identificação mínima da thread — o emitter só precisa saber o id da conversa
// e os dois participantes para resolver as rooms `user:${landlordId}` /
// `user:${tenantId}`. Mantemos a superfície fina de propósito: os callers
// (controller LL-013 / LL-012 / LL-015 futuro) já têm esses três campos sem
// round-trip extra ao banco.
export interface ConversationSocketTarget {
  id: string;
  landlordId: string;
  tenantId: string;
}

export interface NewConversationMessagePayload {
  conversationId: string;
  message: ConversationMessageView;
}

export interface MessagesReadPayload {
  conversationId: string;
  messageIds: string[];
}

/**
 * Envelope defensivo em torno de `io.to(room).emit(event, data)`: captura erros
 * do Redis-adapter / socket engine e loga sem propagar. Segue exatamente o
 * mesmo padrão de `chatSocketService.safeEmit` — queremos que um emit falho NÃO
 * derrube o HTTP response do caller (a mensagem já foi persistida; o socket é
 * best-effort).
 */
function safeEmit(room: string, event: string, data: unknown, context: Record<string, unknown>): void {
  try {
    const io = getIO();
    io.to(room).emit(event, data);
  } catch (err) {
    logger.error({ err, room, event, ...context }, '[conversationSocket] emit failed');
  }
}

export const conversationSocketService = {
  /**
   * Emite `conversation:new_message` para AMBOS os participantes da thread
   * (inclui o próprio autor — a UI do autor tipicamente ignora o echo por
   * comparar `message.authorId === localUser.id`, mas o broadcast simétrico
   * simplifica o caso de multi-device: o mesmo usuário logado em celular+web
   * recebe o eco nos dois).
   *
   * PRD §8 Q5: NÃO fanout para `provider:all` — admins não são parte de
   * threads user-to-user. Apenas as rooms dos dois participantes.
   */
  emitNewMessage(conversation: ConversationSocketTarget, message: ConversationMessageView): void {
    const payload: NewConversationMessagePayload = {
      conversationId: conversation.id,
      message,
    };
    const ctx = {
      conversationId: conversation.id,
      messageId: message.id,
      authorId: message.authorId,
    };

    safeEmit(`user:${conversation.landlordId}`, 'conversation:new_message', payload, ctx);
    safeEmit(`user:${conversation.tenantId}`, 'conversation:new_message', payload, ctx);

    logger.info(ctx, '[conversationSocket] new_message emitted');
  },

  /**
   * Emite `conversation:message_read` APENAS para a room do OUTRO participante
   * — o `readerId` marcou as mensagens como lidas, então ele mesmo não precisa
   * receber eco do próprio read. O objetivo do evento é atualizar o indicador
   * de "lida" do autor (tela dele), não re-sincronizar o leitor.
   *
   * Quando `messageIds` chega vazio, não emite — é ruído no canal sem sinal
   * útil (nenhuma mensagem transicionou). Os call sites (LL-012 listMessages e
   * LL-015 mark-all-as-read) já filtram antes de chamar, mas a guarda aqui é
   * defesa-em-profundidade.
   */
  emitMessagesRead(
    conversation: ConversationSocketTarget,
    readerId: string,
    messageIds: string[],
  ): void {
    if (messageIds.length === 0) return;

    const otherParticipantId =
      conversation.landlordId === readerId ? conversation.tenantId : conversation.landlordId;

    const payload: MessagesReadPayload = {
      conversationId: conversation.id,
      messageIds,
    };
    const ctx = {
      conversationId: conversation.id,
      readerId,
      otherParticipantId,
      messageCount: messageIds.length,
    };

    safeEmit(`user:${otherParticipantId}`, 'conversation:message_read', payload, ctx);

    logger.info(ctx, '[conversationSocket] message_read emitted');
  },
};
