import { Request, Response, NextFunction } from 'express';
import { propertyService } from '../services/propertyService';
import { conversationService } from '../services/conversationService';
import { conversationSocketService } from '../services/conversationSocketService';
import prisma from '../config/db';
import {
  resolveConversationQuerySchema,
  listConversationsQuerySchema,
  listConversationMessagesParamsSchema,
  listConversationMessagesQuerySchema,
  createConversationMessageParamsSchema,
  createConversationMessageBodySchema,
  markConversationReadParamsSchema,
} from '../utils/conversationValidation';

export const conversationController = {
  /**
   * GET /api/conversations/resolve?propertyId=<uuid>&tenantId=<uuid>
   *
   * Resolve a thread canônica (create-or-get atômico) entre o landlord dono do
   * imóvel e o tenant indicado. O `landlordId` NUNCA vem da query — é derivado
   * do Property.landlordId para impedir que um caller forje uma thread com um
   * landlord diferente do real dono (isso criaria linhas órfãs na tabela
   * conversations e divergência com a UI, que mostra landlordId pelo imóvel).
   *
   * Ordem dos guards:
   *   1. 401 se não autenticado — nunca toca no banco para ids anônimos.
   *   2. 400 se query params inválidos (UUID check via Zod).
   *   3. 404 se o imóvel não existe (antes de checar autorização, para não
   *      vazar existência de imóveis a não-donos).
   *   4. 403 se o caller não é nem o landlord do imóvel nem o tenant da query.
   *   5. 200 com o upsert resultante — mesmo id em chamadas subsequentes com
   *      os mesmos parâmetros (garantia via índice único).
   */
  async resolve(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const { propertyId, tenantId } = resolveConversationQuerySchema.parse(req.query);

      const property = await propertyService.getPropertyById(propertyId);
      if (!property) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Property not found' }],
        });
      }

      const isLandlord = localUser.id === property.landlordId;
      const isTenant = localUser.id === tenantId;
      if (!isLandlord && !isTenant) {
        return res.status(403).json({
          status: 403,
          code: 'FORBIDDEN',
          messages: [
            {
              message:
                'Only the property owner or the specified tenant can resolve this conversation.',
            },
          ],
        });
      }

      const conversation = await conversationService.resolve(
        propertyId,
        property.landlordId,
        tenantId,
      );
      return res.status(200).json(conversation);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/conversations?unreadOnly=true
   *
   * Lista o inbox do caller — todas as threads a que ele pertence (seja como
   * landlord OU como tenant). Role-agnóstico: a identidade do contraparte é
   * decidida pela comparação direta `conversation.landlordId === localUser.id`,
   * não pelo papel global do usuário — isso mantém a consistência caso um
   * mesmo User apareça em threads com papéis distintos.
   *
   * Guards: 401 para não autenticado; 400 para `unreadOnly` fora de
   * 'true'|'false'. Role não é gatekeeping: mesmo um ADMIN que nunca figurou
   * em uma conversa simplesmente recebe `[]`.
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const { unreadOnly } = listConversationsQuerySchema.parse(req.query);
      const summaries = await conversationService.list(localUser.id, unreadOnly === 'true');
      return res.status(200).json(summaries);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/conversations/:id/messages?before=<uuid>&limit=50
   *
   * Retorna um lote paginado (cursor-based) de mensagens da thread, ordenado
   * createdAt ASC dentro da página. Sem `before`, retorna as `limit` mais
   * recentes. Com `before`, retorna as `limit` imediatamente anteriores ao id
   * cursor.
   *
   * Autorização usa "existence-hiding 404": tanto conversa inexistente QUANTO
   * conversa existente-mas-não-sou-participante devolvem 404. Isso previne
   * que um atacante autenticado descubra quais UUIDs correspondem a conversas
   * reais sondando respostas 403 vs 404. A mesma regra vale para LL-013 e
   * LL-015.
   *
   * Efeito colateral: toda mensagem do OUTRO participante com readAt=null
   * retornada nesta página tem readAt=now() gravado numa única updateMany.
   * Em LL-014, o conversationSocketService emitirá o evento
   * `conversation:message_read` para o outro participante.
   */
  async listMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const { id } = listConversationMessagesParamsSchema.parse(req.params);
      const { before, limit } = listConversationMessagesQuerySchema.parse(req.query);

      // Checagem de existência + participação colapsada em um findUnique com
      // select minimal — existence-hiding 404 para ambos os ramos.
      const conversation = await prisma.conversation.findUnique({
        where: { id },
        select: { landlordId: true, tenantId: true },
      });
      if (
        !conversation ||
        (conversation.landlordId !== localUser.id && conversation.tenantId !== localUser.id)
      ) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Conversation not found' }],
        });
      }

      const { messages, markedReadIds } = await conversationService.listMessages(
        id,
        localUser.id,
        limit,
        before,
      );

      // LL-014: read-receipt sidecar via socket. O service já atualizou o
      // readAt no banco; aqui apenas notificamos o OUTRO participante — o
      // próprio leitor não precisa de echo. safeEmit é no-op quando não há
      // ids (ex.: todas já estavam lidas, ou página só tem mensagens do
      // próprio leitor).
      if (markedReadIds.length > 0) {
        conversationSocketService.emitMessagesRead(
          { id, landlordId: conversation.landlordId, tenantId: conversation.tenantId },
          localUser.id,
          markedReadIds,
        );
      }

      return res.status(200).json(messages);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/conversations/:id/messages
   *
   * Persiste uma mensagem nova. Mesma regra "existence-hiding 404" que LL-012:
   * tanto conversa inexistente quanto conversa existente-mas-não-sou-participante
   * devolvem 404 — NÃO 403 — para fechar o oráculo de enumeração de ids.
   *
   * Ordem dos guards:
   *   1. 401 se não autenticado.
   *   2. 400 se path :id ou body.content falham Zod.
   *   3. 404 se conversa não existe OU caller não é nem landlord nem tenant.
   *   4. 201 com a mensagem recém-criada (inclui `readAt: null`).
   *
   * Em LL-014 o conversationSocketService.emitNewMessage será invocado após o
   * insert ter sucesso, nunca antes — uma mensagem não persistida não pode
   * fazer eco pelo socket.
   */
  async createMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const { id } = createConversationMessageParamsSchema.parse(req.params);
      const { content } = createConversationMessageBodySchema.parse(req.body);

      const conversation = await prisma.conversation.findUnique({
        where: { id },
        select: { landlordId: true, tenantId: true },
      });
      if (
        !conversation ||
        (conversation.landlordId !== localUser.id && conversation.tenantId !== localUser.id)
      ) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Conversation not found' }],
        });
      }

      const message = await conversationService.createMessage(id, localUser.id, content);

      // LL-014: broadcast para ambas as rooms APÓS o insert ter sucesso.
      // Fazer o emit antes seria incorreto — uma falha no service deixaria os
      // clientes com uma mensagem fantasma. safeEmit absorve erros do socket
      // engine, então o 201 nunca é bloqueado por problemas de pub/sub.
      conversationSocketService.emitNewMessage(
        { id, landlordId: conversation.landlordId, tenantId: conversation.tenantId },
        message,
      );

      return res.status(201).json(message);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/conversations/:id/read
   *
   * Endpoint explícito de "marcar tudo como lido" — pensado para recuperação
   * de sockets (o cliente perdeu conexão, reconecta, e quer sincronizar o
   * estado de leitura sem pedir paginação de mensagens). Em operação normal,
   * LL-012 (GET /messages) já marca como lidas as mensagens da página; este
   * endpoint cobre o caso onde o cliente não vai re-buscar as páginas.
   *
   * Ordem dos guards (mesma invariante de LL-012/LL-013):
   *   1. 401 se não autenticado.
   *   2. 400 se path :id falha Zod.
   *   3. 404 se conversa não existe OU caller não é participante
   *      (existence-hiding — não distingue "ausente" de "proibido").
   *   4. 200 { markedRead: number } — sempre sucesso quando chega aqui.
   *
   * Side-effect socket: quando existe pelo menos uma linha atualizada, emite
   * `conversation:message_read` para o OUTRO participante via
   * conversationSocketService. Pula o emit quando updatedIds é vazio — nada
   * transicionou; um evento vazio seria puro ruído.
   */
  async markAllRead(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const { id } = markConversationReadParamsSchema.parse(req.params);

      const conversation = await prisma.conversation.findUnique({
        where: { id },
        select: { landlordId: true, tenantId: true },
      });
      if (
        !conversation ||
        (conversation.landlordId !== localUser.id && conversation.tenantId !== localUser.id)
      ) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Conversation not found' }],
        });
      }

      const updatedIds = await conversationService.markAllRead(id, localUser.id);

      if (updatedIds.length > 0) {
        conversationSocketService.emitMessagesRead(
          { id, landlordId: conversation.landlordId, tenantId: conversation.tenantId },
          localUser.id,
          updatedIds,
        );
      }

      return res.status(200).json({ markedRead: updatedIds.length });
    } catch (error) {
      next(error);
    }
  },
};
