"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatController = void 0;
const chatService_1 = require("../services/chatService");
const chatValidation_1 = require("../utils/chatValidation");
const whatsappService_1 = require("../services/whatsappService");
const chatSocketService_1 = require("../services/chatSocketService");
const logger_1 = require("../config/logger");
const db_1 = __importDefault(require("../config/db"));
exports.chatController = {
    async getOrCreateSession(req, res, next) {
        try {
            const { tenantId } = chatValidation_1.createSessionSchema.parse(req.body);
            const session = await (0, chatService_1.getOrCreateSession)(tenantId);
            return res.status(200).json(session);
        }
        catch (err) {
            next(err);
        }
    },
    async listSessions(req, res, next) {
        try {
            const tenantId = req.query.tenantId;
            const status = req.query.status;
            const landlordId = req.query.landlordId;
            const sessions = await (0, chatService_1.listSessions)({ tenantId, status, landlordId });
            return res.status(200).json(sessions);
        }
        catch (err) {
            next(err);
        }
    },
    async getSession(req, res, next) {
        try {
            const session = await (0, chatService_1.getSessionById)(req.params.id);
            if (!session) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Session not found' }],
                });
            }
            return res.status(200).json(session);
        }
        catch (err) {
            next(err);
        }
    },
    async sendMessage(req, res, next) {
        try {
            const data = chatValidation_1.sendMessageSchema.parse(req.body);
            const message = await (0, chatService_1.saveMessage)(data);
            // Se o remetente é LANDLORD, enviar também via WhatsApp para o tenant
            if (data.senderType === 'LANDLORD') {
                const session = await (0, chatService_1.getSessionById)(data.sessionId);
                const tenantPhone = session?.tenant?.phoneNumber;
                if (tenantPhone) {
                    try {
                        const waResponse = await (0, whatsappService_1.sendMessage)(tenantPhone, data.content);
                        const outboundWamid = waResponse.messages?.[0]?.id ?? null;
                        if (outboundWamid) {
                            await (0, chatService_1.saveMessage)({
                                sessionId: data.sessionId,
                                senderType: 'LANDLORD',
                                content: data.content,
                                wamid: outboundWamid,
                            });
                        }
                    }
                    catch (waErr) {
                        logger_1.logger.error({ err: waErr, sessionId: data.sessionId }, '[chat] failed to send landlord message via WhatsApp');
                    }
                }
            }
            const session = await (0, chatService_1.getSessionById)(data.sessionId);
            if (session) {
                chatSocketService_1.chatSocketService.emitNewMessage(session.tenantId, {
                    sessionId: data.sessionId,
                    message: {
                        id: message.id,
                        sessionId: message.sessionId,
                        senderType: message.senderType,
                        content: message.content,
                        mediaUrl: message.mediaUrl,
                        status: message.status,
                        timestamp: message.timestamp,
                        wamid: message.wamid ?? null,
                    },
                });
            }
            return res.status(201).json(message);
        }
        catch (err) {
            next(err);
        }
    },
    async updateStatus(req, res, next) {
        try {
            const { status } = chatValidation_1.updateSessionStatusSchema.parse(req.body);
            const session = await db_1.default.chatSession.update({
                where: { id: req.params.id },
                data: { status },
                include: { property: { select: { landlordId: true } } },
            });
            if (session) {
                chatSocketService_1.chatSocketService.emitSessionUpdated(session.tenantId, {
                    sessionId: session.id,
                    status: session.status,
                }, session.property?.landlordId ?? null);
            }
            return res.status(200).json(session);
        }
        catch (err) {
            next(err);
        }
    },
};
