import { Request, Response, NextFunction } from 'express';
import { ChatStatus } from '@prisma/client';
import {
  getOrCreateSession,
  listSessions,
  getSessionById,
  saveMessage,
} from '../services/chatService';
import {
  sendMessageSchema,
  createSessionSchema,
  updateSessionStatusSchema,
} from '../utils/chatValidation';
import { sendMessage as sendWhatsAppMessage } from '../services/whatsappService';
import { chatSocketService } from '../services/chatSocketService';
import { logger } from '../config/logger';
import prisma from '../config/db';

export const chatController = {
  async getOrCreateSession(req: Request, res: Response, next: NextFunction) {
    try {
      const { tenantId } = createSessionSchema.parse(req.body);
      const session = await getOrCreateSession(tenantId);
      return res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  },

  async listSessions(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.query.tenantId as string | undefined;
      const status = req.query.status as ChatStatus | undefined;
      const landlordId = req.query.landlordId as string | undefined;
      const sessions = await listSessions({ tenantId, status, landlordId });
      return res.status(200).json(sessions);
    } catch (err) {
      next(err);
    }
  },

  async getSession(req: Request, res: Response, next: NextFunction) {
    try {
      const session = await getSessionById(req.params.id);
      if (!session) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Session not found' }],
        });
      }
      return res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  },

  async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const data = sendMessageSchema.parse(req.body);
      const message = await saveMessage(data);

      // Se o remetente é LANDLORD, enviar também via WhatsApp para o tenant
      if (data.senderType === 'LANDLORD') {
        const session = await getSessionById(data.sessionId);
        const tenantPhone = session?.tenant?.phoneNumber;
        if (tenantPhone) {
          try {
            const waResponse = await sendWhatsAppMessage(tenantPhone, data.content);
            const outboundWamid = waResponse.messages?.[0]?.id ?? null;
            if (outboundWamid) {
              await saveMessage({
                sessionId: data.sessionId,
                senderType: 'LANDLORD',
                content: data.content,
                wamid: outboundWamid,
              } as any);
            }
          } catch (waErr) {
            logger.error({ err: waErr, sessionId: data.sessionId }, '[chat] failed to send landlord message via WhatsApp');
          }
        }
      }

      const session = await getSessionById(data.sessionId);

      if (session) {
        chatSocketService.emitNewMessage(session.tenantId, {
          sessionId: data.sessionId,
          message: {
            id: message.id,
            sessionId: message.sessionId,
            senderType: message.senderType,
            content: message.content,
            mediaUrl: message.mediaUrl,
            status: message.status,
            timestamp: message.timestamp,
            wamid: (message as any).wamid ?? null,
          },
        });
      }

      return res.status(201).json(message);
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = updateSessionStatusSchema.parse(req.body);
      const session = await prisma.chatSession.update({
        where: { id: req.params.id },
        data: { status },
        include: { property: { select: { landlordId: true } } },
      });

      if (session) {
        chatSocketService.emitSessionUpdated(session.tenantId, {
          sessionId: session.id,
          status: session.status,
        }, session.property?.landlordId ?? null);
      }

      return res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  },
};
