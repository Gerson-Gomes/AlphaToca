"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateSession = getOrCreateSession;
exports.listSessions = listSessions;
exports.getSessionById = getSessionById;
exports.saveMessage = saveMessage;
exports.updateSessionStatus = updateSessionStatus;
const db_1 = __importDefault(require("../config/db"));
async function getOrCreateSession(tenantId) {
    // Try to find an active session (not resolved and not expired)
    let session = await db_1.default.chatSession.findFirst({
        where: {
            tenantId,
            status: { not: 'RESOLVED' },
            expiresAt: { gt: new Date() }
        },
        include: {
            messages: {
                orderBy: { timestamp: 'desc' },
                take: 50
            }
        }
    });
    if (!session) {
        session = await db_1.default.chatSession.create({
            data: {
                tenantId,
                status: 'ACTIVE_BOT'
            },
            include: {
                messages: true
            }
        });
    }
    return session;
}
async function listSessions(filters) {
    const where = {};
    if (filters.tenantId)
        where.tenantId = filters.tenantId;
    if (filters.status)
        where.status = filters.status;
    if (filters.landlordId) {
        where.property = { landlordId: filters.landlordId };
    }
    return db_1.default.chatSession.findMany({
        where,
        include: {
            tenant: { select: { id: true, name: true, phoneNumber: true } },
            property: { select: { id: true, title: true, landlordId: true } },
            _count: { select: { messages: true } },
            messages: {
                orderBy: { timestamp: 'desc' },
                take: 1,
                select: { content: true, timestamp: true, senderType: true },
            },
        },
        orderBy: { startedAt: 'desc' },
    });
}
async function getSessionById(sessionId) {
    return db_1.default.chatSession.findUnique({
        where: { id: sessionId },
        include: {
            tenant: { select: { id: true, name: true, phoneNumber: true } },
            messages: {
                orderBy: { timestamp: 'asc' }
            }
        }
    });
}
async function saveMessage(data) {
    return db_1.default.message.create({
        data: {
            sessionId: data.sessionId,
            senderType: data.senderType,
            content: data.content,
            mediaUrl: data.mediaUrl,
            wamid: data.wamid ?? null,
            status: 'sent',
        },
    });
}
async function updateSessionStatus(sessionId, status) {
    return db_1.default.chatSession.update({
        where: { id: sessionId },
        data: { status }
    });
}
