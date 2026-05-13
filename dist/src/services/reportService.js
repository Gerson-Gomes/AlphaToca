"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReport = createReport;
exports.listReports = listReports;
exports.updateReport = updateReport;
const db_1 = __importDefault(require("../config/db"));
async function createReport(payload) {
    return db_1.default.report.create({
        data: {
            reporterId: payload.reporterId,
            targetType: payload.targetType,
            targetId: payload.targetId,
            reason: payload.reason,
            description: payload.description,
        },
        include: {
            reporter: { select: { id: true, name: true } },
        },
    });
}
function toAdminView(r) {
    return {
        id: r.id,
        reporterId: r.reporterId,
        reporterName: r.reporter?.name ?? 'Usuário excluído',
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        description: r.description,
        status: r.status,
        resolution: r.resolution,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    };
}
async function listReports(params) {
    const { status, targetType, page, pageSize } = params;
    const where = {};
    if (status)
        where.status = status;
    if (targetType)
        where.targetType = targetType;
    const [total, rows] = await Promise.all([
        db_1.default.report.count({ where }),
        db_1.default.report.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: {
                reporter: { select: { id: true, name: true } },
            },
        }),
    ]);
    return {
        data: rows.map(toAdminView),
        page,
        pageSize,
        total,
    };
}
async function updateReport(id, payload, adminId) {
    const existing = await db_1.default.report.findUnique({ where: { id } });
    if (!existing)
        return null;
    const data = { status: payload.status };
    if (payload.resolution !== undefined)
        data.resolution = payload.resolution;
    if (payload.status === 'RESOLVED' || payload.status === 'DISMISSED') {
        data.resolvedBy = adminId;
        data.resolvedAt = new Date();
    }
    const updated = await db_1.default.report.update({
        where: { id },
        data,
        include: {
            reporter: { select: { id: true, name: true } },
        },
    });
    return toAdminView(updated);
}
