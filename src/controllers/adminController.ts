import { Request, Response, NextFunction } from 'express';
import { ContractStatus, ModerationStatus, Prisma } from '@prisma/client';
import prisma from '../config/db';
import { propertyService } from '../services/propertyService';
import { broadcastService, broadcastSchema } from '../services/broadcastService';

const PAGE_MIN = 1;
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;

const parseIntParam = (raw: unknown, fallback: number, min: number, max: number): number => {
  if (typeof raw !== 'string') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

export const adminController = {
  async getMetrics(_req: Request, res: Response, next: NextFunction) {
    try {
      const [
        totalUsers,
        totalProperties,
        totalVisits,
        usersByRole,
        propertiesByStatus,
        propertiesByModeration,
        openSupportTickets,
        pendingReports,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.property.count(),
        prisma.visit.count(),
        prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
        prisma.property.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.property.groupBy({ by: ['moderationStatus'], _count: { _all: true } }),
        prisma.supportTicket.count({ where: { status: 'OPEN' } }),
        prisma.report.count({ where: { status: 'PENDING' } }),
      ]);

      const toCountMap = <K extends string>(rows: any[], key: K) =>
        rows.reduce<Record<string, number>>((acc, row) => {
          acc[row[key] as string] = row._count._all;
          return acc;
        }, {});

      const pendingModeration =
        propertiesByModeration.find((r) => r.moderationStatus === ModerationStatus.PENDING)
          ?._count._all ?? 0;

      return res.status(200).json({
        totals: {
          users: totalUsers,
          properties: totalProperties,
          visits: totalVisits,
          pendingModeration,
          openSupportTickets,
          pendingReports,
        },
        usersByRole: toCountMap(usersByRole, 'role'),
        propertiesByStatus: toCountMap(propertiesByStatus, 'status'),
        propertiesByModeration: toCountMap(propertiesByModeration, 'moderationStatus'),
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  },

  async listPendingProperties(req: Request, res: Response, next: NextFunction) {
    try {
      const statusParam = typeof req.query.status === 'string'
        ? (req.query.status as string).toUpperCase()
        : undefined;

      const status =
        statusParam && (Object.values(ModerationStatus) as string[]).includes(statusParam)
          ? (statusParam as ModerationStatus)
          : ModerationStatus.PENDING;

      const page = parseIntParam(req.query.page, 1, PAGE_MIN, Number.MAX_SAFE_INTEGER);
      const limit = parseIntParam(req.query.limit, 20, LIMIT_MIN, LIMIT_MAX);

      const result = await propertyService.listForModeration({ status, page, limit });
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /admin/broadcast
   * Envia uma notificação push para todos os usuários com fcmToken registrado.
   * Apenas ADMIN.
   */
  async sendBroadcast(req: Request, res: Response, next: NextFunction) {
    try {
      const input = broadcastSchema.parse(req.body);
      const result = await broadcastService.sendToAll(input);
      return res.status(200).json({
        message: 'Broadcast enviado com sucesso.',
        sent: result.sent,
        failed: result.failed,
        persisted: result.persisted,
      });
    } catch (error) {
      next(error);
    }
  },

  async listContracts(req: Request, res: Response, next: NextFunction) {
    try {
      const statusParam = typeof req.query.status === 'string'
        ? (req.query.status as string).toUpperCase()
        : undefined;

      const expiringInDays = typeof req.query.expiringInDays === 'string'
        ? parseIntParam(req.query.expiringInDays, 0, 0, 365)
        : undefined;

      const page = parseIntParam(req.query.page, 1, PAGE_MIN, Number.MAX_SAFE_INTEGER);
      const pageSize = parseIntParam(req.query.limit, 20, LIMIT_MIN, LIMIT_MAX);

      const now = new Date();
      const where: Prisma.ContractWhereInput = {};
      if (statusParam && ['ACTIVE', 'TERMINATED', 'COMPLETED'].includes(statusParam)) {
        where.status = statusParam as ContractStatus;
      }
      if (expiringInDays && expiringInDays > 0) {
        const futureDate = new Date(now);
        futureDate.setDate(futureDate.getDate() + expiringInDays);
        where.endDate = { gte: now, lte: futureDate };
        where.status = 'ACTIVE';
      }

      const [total, contracts] = await Promise.all([
        prisma.contract.count({ where }),
        prisma.contract.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            property: { select: { id: true, address: true, city: true, state: true } },
            tenant: { select: { id: true, name: true } },
          },
        }),
      ]);

      const data = contracts.map((c: any) => ({
        id: c.id,
        status: c.status,
        tenantName: c.tenant?.name ?? 'N/A',
        tenantId: c.tenant?.id ?? null,
        propertyAddress: c.property
          ? [c.property.address, c.property.city, c.property.state].filter(Boolean).join(', ')
          : 'N/A',
        propertyId: c.property?.id ?? null,
        monthlyRent: c.monthlyRent instanceof Object && 'toNumber' in c.monthlyRent
          ? (c.monthlyRent as any).toNumber()
          : Number(c.monthlyRent),
        startDate: c.startDate instanceof Date ? c.startDate.toISOString() : c.startDate,
        endDate: c.endDate instanceof Date ? c.endDate.toISOString() : c.endDate,
        documentStatus: c.documentStatus,
      }));

      return res.status(200).json({
        data,
        meta: {
          page,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
