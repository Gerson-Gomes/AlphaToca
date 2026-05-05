import { Request, Response, NextFunction } from 'express';
import {
  getOrCreateSession,
  listSessions,
  getSessionById,
  saveMessage,
  updateSessionStatus
} from '../services/chatService';
import {
  sendMessageSchema,
  createSessionSchema,
  updateSessionStatusSchema
} from '../utils/chatValidation';

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
      const tenantId = req.query.tenantId as string;
      const sessions = await listSessions({ tenantId });
      return res.status(200).json(sessions);
    } catch (err) {
      next(err);
    }
  },

  async getSession(req: Request, res: Response, next: NextFunction) {
    try {
      const session = await getSessionById(req.params.id);
      if (!session) {
        return res.status(404).json({ status: 404, code: 'NOT_FOUND', messages: [{ message: 'Session not found' }] });
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
      return res.status(201).json(message);
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = updateSessionStatusSchema.parse(req.body);
      const session = await updateSessionStatus(req.params.id, status);
      return res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  }
};
