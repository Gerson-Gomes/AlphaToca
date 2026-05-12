import { Request, Response, NextFunction } from 'express';
import * as reportService from '../services/reportService';

const PAGE_MIN = 1;
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;

const parseIntParam = (raw: unknown, fallback: number, min: number, max: number): number => {
  if (typeof raw !== 'string') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const VALID_REASONS = ['inappropriate_behavior', 'fake_listing', 'fraud', 'other'];
const VALID_TARGET_TYPES = ['USER', 'PROPERTY'];
const VALID_STATUSES = ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'];

export const reportController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = (req as any).localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const { targetType, targetId, reason, description } = req.body;

      if (!targetId || typeof targetId !== 'string') {
        return res.status(400).json({
          status: 400,
          code: 'VALIDATION_ERROR',
          messages: [{ message: 'targetId is required.' }],
        });
      }

      if (!targetType || !VALID_TARGET_TYPES.includes(targetType)) {
        return res.status(400).json({
          status: 400,
          code: 'VALIDATION_ERROR',
          messages: [{ message: `targetType must be one of: ${VALID_TARGET_TYPES.join(', ')}` }],
        });
      }

      if (!reason || !VALID_REASONS.includes(reason)) {
        return res.status(400).json({
          status: 400,
          code: 'VALIDATION_ERROR',
          messages: [{ message: `reason must be one of: ${VALID_REASONS.join(', ')}` }],
        });
      }

      if (!description || typeof description !== 'string') {
        return res.status(400).json({
          status: 400,
          code: 'VALIDATION_ERROR',
          messages: [{ message: 'description is required.' }],
        });
      }

      const report = await reportService.createReport({
        reporterId: localUser.id,
        targetType,
        targetId,
        reason,
        description,
      });

      return res.status(201).json({
        id: report.id,
        status: report.status,
        createdAt: report.createdAt instanceof Date ? report.createdAt.toISOString() : report.createdAt,
      });
    } catch (error) {
      next(error);
    }
  },

  async listForAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const statusParam = typeof req.query.status === 'string'
        ? (req.query.status as string).toUpperCase()
        : undefined;

      const status = statusParam && VALID_STATUSES.includes(statusParam)
        ? (statusParam as any)
        : undefined;

      const targetType = typeof req.query.targetType === 'string'
        ? (req.query.targetType as string).toUpperCase()
        : undefined;

      const page = parseIntParam(req.query.page, 1, PAGE_MIN, Number.MAX_SAFE_INTEGER);
      const pageSize = parseIntParam(req.query.limit, 20, LIMIT_MIN, LIMIT_MAX);

      const result = await reportService.listReports({
        status,
        targetType,
        page,
        pageSize,
      });

      return res.status(200).json({
        data: result.data,
        meta: {
          page: result.page,
          total: result.total,
          totalPages: Math.ceil(result.total / result.pageSize),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async updateForAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status, resolution } = req.body;
      const adminId = (req as any).localUser?.id;

      if (!status || !VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          status: 400,
          code: 'VALIDATION_ERROR',
          messages: [{ message: `status must be one of: ${VALID_STATUSES.join(', ')}` }],
        });
      }

      const updated = await reportService.updateReport(id, { status, resolution }, adminId);

      if (!updated) {
        return res.status(404).json({
          status: 404,
          code: 'REPORT_NOT_FOUND',
          messages: [{ message: `Report ${id} not found.` }],
        });
      }

      return res.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  },
};
