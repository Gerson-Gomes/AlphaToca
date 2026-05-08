import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../config/db';
import { notificationService } from '../services/notificationService';

const listNotificationsQuerySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
});

export const notificationController = {
  /**
   * GET /notifications?unreadOnly=true
   *
   * Lists the authenticated user's cross-device notification history (US-013).
   * Returns a bare array of `NotificationView` items, newest first.
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).localUser?.id;
      if (!userId) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Unauthenticated.' }],
        });
      }

      const parsed = listNotificationsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          status: 400,
          code: 'VALIDATION_ERROR',
          messages: parsed.error.issues.map((i) => ({ message: i.message, path: i.path })),
        });
      }

      const notifications = await notificationService.listForUser(userId, {
        unreadOnly: parsed.data.unreadOnly === 'true',
      });

      return res.status(200).json(notifications);
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /notifications/:id/read
   * Marca uma notificação específica como lida.
   */
  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).localUser.id;
      const { id } = req.params;

      const notification = await prisma.notification.findUnique({ where: { id } });

      if (!notification) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Notificação não encontrada.' }],
        });
      }

      if (notification.userId !== userId) {
        return res.status(403).json({
          status: 403,
          code: 'FORBIDDEN',
          messages: [{ message: 'Acesso negado.' }],
        });
      }

      const updated = await prisma.notification.update({
        where: { id },
        data: { readAt: new Date() },
      });

      return res.status(200).json({ data: updated });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /notifications/:id/read — US-014 (cross-device sync)
   *
   * Idempotent mark-as-read. If the notification is already read, returns 204
   * without touching the row (no timestamp overwrite — the original readAt is
   * what the user actually saw it on the first device). Always returns 204 on
   * success so the client can fire-and-forget without parsing the body.
   *
   * Errors: 403 for non-owner, 404 for missing id. The 403/404 split is
   * explicit in the AC (no existence-hiding here — notification ids are not
   * enumerable like conversation UUIDs, and the frontend relies on 403 to
   * surface "you lost access" state distinctly from "this notification was
   * deleted").
   */
  async markAsReadIdempotent(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).localUser?.id;
      if (!userId) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Unauthenticated.' }],
        });
      }

      const { id } = req.params;

      const notification = await prisma.notification.findUnique({
        where: { id },
        select: { id: true, userId: true, readAt: true },
      });

      if (!notification) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Notificação não encontrada.' }],
        });
      }

      if (notification.userId !== userId) {
        return res.status(403).json({
          status: 403,
          code: 'FORBIDDEN',
          messages: [{ message: 'Acesso negado.' }],
        });
      }

      if (notification.readAt === null) {
        await prisma.notification.update({
          where: { id },
          data: { readAt: new Date() },
        });
      }

      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /notifications/read-all
   * Marca todas as notificações do usuário como lidas.
   */
  async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).localUser.id;

      const { count } = await prisma.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      });

      return res.status(200).json({ updated: count });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /notifications/unread-count
   * Retorna a contagem de notificações não lidas (badge do app).
   */
  async unreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).localUser.id;

      const count = await prisma.notification.count({
        where: { userId, readAt: null },
      });

      return res.status(200).json({ count });
    } catch (error) {
      next(error);
    }
  },
};
