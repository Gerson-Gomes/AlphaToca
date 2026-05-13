"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminController = void 0;
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
const propertyService_1 = require("../services/propertyService");
const broadcastService_1 = require("../services/broadcastService");
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
exports.adminController = {
    async getMetrics(_req, res, next) {
        try {
            const [totalUsers, totalProperties, totalVisits, usersByRole, propertiesByStatus, propertiesByModeration, openSupportTickets, pendingReports,] = await Promise.all([
                db_1.default.user.count(),
                db_1.default.property.count(),
                db_1.default.visit.count(),
                db_1.default.user.groupBy({ by: ['role'], _count: { _all: true } }),
                db_1.default.property.groupBy({ by: ['status'], _count: { _all: true } }),
                db_1.default.property.groupBy({ by: ['moderationStatus'], _count: { _all: true } }),
                db_1.default.supportTicket.count({ where: { status: 'OPEN' } }),
                db_1.default.report.count({ where: { status: 'PENDING' } }),
            ]);
            const toCountMap = (rows, key) => rows.reduce((acc, row) => {
                acc[row[key]] = row._count._all;
                return acc;
            }, {});
            const pendingModeration = propertiesByModeration.find((r) => r.moderationStatus === client_1.ModerationStatus.PENDING)
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
        }
        catch (error) {
            next(error);
        }
    },
    async listPendingProperties(req, res, next) {
        try {
            const statusParam = typeof req.query.status === 'string'
                ? req.query.status.toUpperCase()
                : undefined;
            const status = statusParam && Object.values(client_1.ModerationStatus).includes(statusParam)
                ? statusParam
                : client_1.ModerationStatus.PENDING;
            const page = parseIntParam(req.query.page, 1, PAGE_MIN, Number.MAX_SAFE_INTEGER);
            const limit = parseIntParam(req.query.limit, 20, LIMIT_MIN, LIMIT_MAX);
            const result = await propertyService_1.propertyService.listForModeration({ status, page, limit });
            return res.status(200).json(result);
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * POST /admin/broadcast
     * Envia uma notificação push para todos os usuários com fcmToken registrado.
     * Apenas ADMIN.
     */
    async sendBroadcast(req, res, next) {
        try {
            const input = broadcastService_1.broadcastSchema.parse(req.body);
            const result = await broadcastService_1.broadcastService.sendToAll(input);
            return res.status(200).json({
                message: 'Broadcast enviado com sucesso.',
                sent: result.sent,
                failed: result.failed,
                persisted: result.persisted,
            });
        }
        catch (error) {
            next(error);
        }
    },
    async listContracts(req, res, next) {
        try {
            const statusParam = typeof req.query.status === 'string'
                ? req.query.status.toUpperCase()
                : undefined;
            const expiringInDays = typeof req.query.expiringInDays === 'string'
                ? parseIntParam(req.query.expiringInDays, 0, 0, 365)
                : undefined;
            const page = parseIntParam(req.query.page, 1, PAGE_MIN, Number.MAX_SAFE_INTEGER);
            const pageSize = parseIntParam(req.query.limit, 20, LIMIT_MIN, LIMIT_MAX);
            const now = new Date();
            const where = {};
            if (statusParam && ['ACTIVE', 'TERMINATED', 'COMPLETED'].includes(statusParam)) {
                where.status = statusParam;
            }
            if (expiringInDays && expiringInDays > 0) {
                const futureDate = new Date(now);
                futureDate.setDate(futureDate.getDate() + expiringInDays);
                where.endDate = { gte: now, lte: futureDate };
                where.status = 'ACTIVE';
            }
            const [total, contracts] = await Promise.all([
                db_1.default.contract.count({ where }),
                db_1.default.contract.findMany({
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
            const data = contracts.map((c) => ({
                id: c.id,
                status: c.status,
                tenantName: c.tenant?.name ?? 'N/A',
                tenantId: c.tenant?.id ?? null,
                propertyAddress: c.property
                    ? [c.property.address, c.property.city, c.property.state].filter(Boolean).join(', ')
                    : 'N/A',
                propertyId: c.property?.id ?? null,
                monthlyRent: c.monthlyRent instanceof Object && 'toNumber' in c.monthlyRent
                    ? c.monthlyRent.toNumber()
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
        }
        catch (error) {
            next(error);
        }
    },
};
