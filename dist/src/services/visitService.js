"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisitError = void 0;
exports.createVisit = createVisit;
exports.getVisitById = getVisitById;
exports.listVisits = listVisits;
exports.updateVisit = updateVisit;
exports.cancelVisit = cancelVisit;
exports.listAvailableSlots = listAvailableSlots;
const db_1 = __importDefault(require("../config/db"));
const visits_1 = require("../config/visits");
const pushNotificationService_1 = require("./pushNotificationService");
const logger_1 = require("../config/logger");
class VisitError extends Error {
    code;
    httpStatus;
    details;
    constructor(code, httpStatus, details) {
        super(code);
        this.name = 'VisitError';
        this.code = code;
        this.httpStatus = httpStatus;
        this.details = details;
    }
}
exports.VisitError = VisitError;
const defaultDeps = {
    prisma: db_1.default,
};
// Busca candidatos a conflito numa janela larga ([start - MAX, end]) e filtra
// em JS pela sobreposição real. MAX_VISIT_DURATION_MINUTES cobre o maior
// durationMinutes permitido pela validação Zod — derivar daqui garante que
// a janela SQL e o limite da API permanecem sincronizados.
const MAX_DURATION_MINUTES = visits_1.MAX_VISIT_DURATION_MINUTES;
function endOf(v) {
    return new Date(v.scheduledAt.getTime() + v.durationMinutes * 60_000);
}
function overlaps(aStart, aDurationMin, bStart, bDurationMin) {
    const aEnd = aStart.getTime() + aDurationMin * 60_000;
    const bEnd = bStart.getTime() + bDurationMin * 60_000;
    // Back-to-back (aEnd == bStart) NÃO conta como conflito.
    return aStart.getTime() < bEnd && aEnd > bStart.getTime();
}
async function findConflicting(args, deps) {
    const { propertyId, landlordId, scheduledAt, durationMinutes, excludeVisitId } = args;
    const windowStart = new Date(scheduledAt.getTime() - MAX_DURATION_MINUTES * 60_000);
    const windowEnd = new Date(scheduledAt.getTime() + durationMinutes * 60_000);
    const where = {
        status: 'SCHEDULED',
        OR: [{ propertyId }, { landlordId }],
        scheduledAt: { gte: windowStart, lte: windowEnd },
        ...(excludeVisitId ? { NOT: { id: excludeVisitId } } : {}),
    };
    const candidates = (await deps.prisma.visit.findMany({
        where: where,
        orderBy: { scheduledAt: 'asc' },
    }));
    for (const c of candidates) {
        if (overlaps(scheduledAt, durationMinutes, c.scheduledAt, c.durationMinutes)) {
            return c;
        }
    }
    return null;
}
async function createVisit(input, deps = defaultDeps) {
    const property = await deps.prisma.property.findUnique({
        where: { id: input.propertyId },
        select: {
            id: true,
            landlordId: true,
            title: true,
            landlord: {
                select: { fcmToken: true }
            }
        },
    });
    if (!property) {
        throw new VisitError('PROPERTY_NOT_FOUND', 404, { propertyId: input.propertyId });
    }
    const landlordId = property.landlordId;
    const conflict = await findConflicting({
        propertyId: input.propertyId,
        landlordId,
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes,
    }, deps);
    if (conflict) {
        throw new VisitError('CONFLICT', 409, { conflictWith: conflict.id });
    }
    const visit = await deps.prisma.visit.create({
        data: {
            propertyId: input.propertyId,
            tenantId: input.tenantId,
            landlordId,
            rentalProcessId: input.rentalProcessId ?? null,
            scheduledAt: input.scheduledAt,
            durationMinutes: input.durationMinutes,
            source: input.source,
            notes: input.notes ?? null,
        },
    });
    // Gatilho Isolado: Dispara notificação push + persiste no histórico para o locador
    const landlordFcmToken = property.landlord?.fcmToken;
    const landlordId2 = property.landlordId;
    const propertyTitle = property.title;
    pushNotificationService_1.pushNotificationService.notify({
        userId: landlordId2,
        fcmToken: landlordFcmToken,
        type: 'VISIT_SCHEDULED',
        title: 'Nova Visita Agendada!',
        body: `Uma visita foi agendada para o seu imóvel: ${propertyTitle}`,
        data: {
            visitId: visit.id,
            propertyId: input.propertyId,
            type: 'VISIT_SCHEDULED'
        }
    }).catch(err => {
        logger_1.logger.error({ err, visitId: visit.id }, '[visitService] Falha ao disparar notificação de nova visita');
    });
    return visit;
}
async function getVisitById(id, deps = defaultDeps) {
    return deps.prisma.visit.findUnique({ where: { id } });
}
async function listVisits(query, deps = defaultDeps) {
    const where = {};
    if (query.propertyId)
        where.propertyId = query.propertyId;
    if (query.tenantId)
        where.tenantId = query.tenantId;
    if (query.landlordId)
        where.landlordId = query.landlordId;
    if (query.status)
        where.status = query.status;
    if (query.from || query.to) {
        const range = {};
        if (query.from)
            range.gte = query.from;
        if (query.to)
            range.lte = query.to;
        where.scheduledAt = range;
    }
    return deps.prisma.visit.findMany({
        where: where,
        orderBy: { scheduledAt: 'asc' },
    });
}
async function updateVisit(id, input, deps = defaultDeps) {
    const existing = await deps.prisma.visit.findUnique({ where: { id } });
    if (!existing)
        return null;
    const scheduledAt = input.scheduledAt ?? existing.scheduledAt;
    const durationMinutes = input.durationMinutes ?? existing.durationMinutes;
    const nextStatus = (input.status ?? existing.status);
    const scheduleChanged = input.scheduledAt !== undefined || input.durationMinutes !== undefined;
    const reactivating = input.status !== undefined && input.status === 'SCHEDULED' && existing.status !== 'SCHEDULED';
    if (nextStatus === 'SCHEDULED' && (scheduleChanged || reactivating)) {
        const conflict = await findConflicting({
            propertyId: existing.propertyId,
            landlordId: existing.landlordId,
            scheduledAt,
            durationMinutes,
            excludeVisitId: id,
        }, deps);
        if (conflict) {
            throw new VisitError('CONFLICT', 409, { conflictWith: conflict.id });
        }
    }
    const updated = await deps.prisma.visit.update({
        where: { id },
        data: {
            ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}),
            ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
    });
    // Gatilho: notifica o inquilino quando a visita é concluída
    if (input.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
        const tenant = await db_1.default.user.findUnique({
            where: { id: existing.tenantId },
            select: { fcmToken: true },
        });
        const property = await db_1.default.property.findUnique({
            where: { id: existing.propertyId },
            select: { title: true },
        });
        pushNotificationService_1.pushNotificationService.notify({
            userId: existing.tenantId,
            fcmToken: tenant?.fcmToken,
            type: 'VISIT_COMPLETED',
            title: 'Como foi a visita?',
            body: `Você visitou o imóvel "${property?.title}". Continue o processo de locação pelo app!`,
            data: { visitId: id, propertyId: existing.propertyId, type: 'VISIT_COMPLETED' },
        }).catch(err => logger_1.logger.error({ err, visitId: id }, '[visitService] Falha ao disparar notificação VISIT_COMPLETED'));
    }
    return updated;
}
async function cancelVisit(id, deps = defaultDeps) {
    const existing = await deps.prisma.visit.findUnique({ where: { id } });
    if (!existing)
        return false;
    await deps.prisma.visit.update({
        where: { id },
        data: { status: 'CANCELLED' },
    });
    // Busca dados de locador, inquilino e imóvel para as notificações
    const [landlord, tenant, property] = await Promise.all([
        db_1.default.user.findUnique({ where: { id: existing.landlordId }, select: { fcmToken: true } }),
        db_1.default.user.findUnique({ where: { id: existing.tenantId }, select: { fcmToken: true } }),
        db_1.default.property.findUnique({ where: { id: existing.propertyId }, select: { title: true } }),
    ]);
    const propertyTitle = property?.title ?? 'imóvel';
    // Notifica o locador (confirmação de cancelamento)
    pushNotificationService_1.pushNotificationService.notify({
        userId: existing.landlordId,
        fcmToken: landlord?.fcmToken,
        type: 'VISIT_CANCELLED',
        title: 'Visita Cancelada',
        body: `A visita ao imóvel "${propertyTitle}" foi cancelada com sucesso.`,
        data: { visitId: id, propertyId: existing.propertyId, type: 'VISIT_CANCELLED' },
    }).catch(err => logger_1.logger.error({ err, visitId: id }, '[visitService] Falha ao notificar locador sobre VISIT_CANCELLED'));
    // Notifica o inquilino (aviso de cancelamento)
    pushNotificationService_1.pushNotificationService.notify({
        userId: existing.tenantId,
        fcmToken: tenant?.fcmToken,
        type: 'VISIT_CANCELLED',
        title: 'Visita Cancelada',
        body: `Sua visita ao imóvel "${propertyTitle}" foi cancelada.`,
        data: { visitId: id, propertyId: existing.propertyId, type: 'VISIT_CANCELLED' },
    }).catch(err => logger_1.logger.error({ err, visitId: id }, '[visitService] Falha ao notificar inquílino sobre VISIT_CANCELLED'));
    return true;
}
async function listAvailableSlots(query, deps = defaultDeps) {
    const property = await deps.prisma.property.findUnique({
        where: { id: query.propertyId },
        select: { id: true, landlordId: true },
    });
    if (!property) {
        throw new VisitError('PROPERTY_NOT_FOUND', 404, { propertyId: query.propertyId });
    }
    // const landlordId = (property as { landlordId: string }).landlordId;
    const landlordId = property.landlordId;
    // Busca tudo que possa colidir no intervalo — property OU landlord ocupados
    const busy = (await deps.prisma.visit.findMany({
        where: {
            status: 'SCHEDULED',
            OR: [{ propertyId: query.propertyId }, { landlordId }],
            scheduledAt: {
                gte: new Date(query.from.getTime() - MAX_DURATION_MINUTES * 60_000),
                lte: query.to,
            },
        },
        orderBy: { scheduledAt: 'asc' },
    }));
    const slotMs = query.slotMinutes * 60_000;
    const slots = [];
    let cursor = query.from.getTime();
    const windowEnd = query.to.getTime();
    while (cursor + slotMs <= windowEnd) {
        const start = new Date(cursor);
        const end = new Date(cursor + slotMs);
        const collides = busy.some((b) => overlaps(start, query.slotMinutes, b.scheduledAt, b.durationMinutes));
        if (!collides) {
            slots.push({ startsAt: start, endsAt: end });
        }
        cursor += slotMs;
    }
    return slots;
}
