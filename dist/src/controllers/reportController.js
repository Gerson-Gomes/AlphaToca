"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportController = void 0;
const reportService = __importStar(require("../services/reportService"));
const PAGE_MIN = 1;
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;
const parseIntParam = (raw, fallback, min, max) => {
    if (typeof raw !== 'string')
        return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
};
const VALID_REASONS = ['inappropriate_behavior', 'fake_listing', 'fraud', 'other'];
const VALID_TARGET_TYPES = ['USER', 'PROPERTY'];
const VALID_STATUSES = ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'];
exports.reportController = {
    async create(req, res, next) {
        try {
            const localUser = req.localUser;
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
        }
        catch (error) {
            next(error);
        }
    },
    async listForAdmin(req, res, next) {
        try {
            const statusParam = typeof req.query.status === 'string'
                ? req.query.status.toUpperCase()
                : undefined;
            const status = statusParam && VALID_STATUSES.includes(statusParam)
                ? statusParam
                : undefined;
            const targetType = typeof req.query.targetType === 'string'
                ? req.query.targetType.toUpperCase()
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
        }
        catch (error) {
            next(error);
        }
    },
    async updateForAdmin(req, res, next) {
        try {
            const { id } = req.params;
            const { status, resolution } = req.body;
            const adminId = req.localUser?.id;
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
        }
        catch (error) {
            next(error);
        }
    },
};
