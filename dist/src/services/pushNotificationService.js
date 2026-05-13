"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushNotificationService = void 0;
const firebase_1 = __importDefault(require("../config/firebase"));
const db_1 = __importDefault(require("../config/db"));
const logger_1 = require("../config/logger");
// ---------------------------------------------------------------------------
// Serviço
// ---------------------------------------------------------------------------
exports.pushNotificationService = {
    /**
     * Método principal — persiste a notificação no banco E dispara o push FCM.
     *
     * Use este método em todos os gatilhos de negócio (visitas, locação, etc.).
     * A persistência no banco garante o histórico mesmo se o FCM falhar.
     */
    async notify(payload) {
        const { userId, fcmToken, type, title, body, data } = payload;
        // 1. Persiste no banco (histórico do app) — sempre, independente do FCM
        try {
            await db_1.default.notification.create({
                data: {
                    userId,
                    type,
                    title,
                    body,
                    data: data ?? undefined,
                },
            });
        }
        catch (err) {
            logger_1.logger.error({ err, userId, type }, '[Notification] Falha ao persistir notificação no banco.');
        }
        // 2. Dispara push FCM — somente se o usuário tiver um token registrado
        if (fcmToken) {
            await exports.pushNotificationService.sendPushNotification({ token: fcmToken, title, body, data });
        }
        else {
            logger_1.logger.info(`[Notification] Usuário ${userId} sem fcmToken. Notificação persistida no banco, mas push não enviado.`);
        }
    },
    /**
     * Envia uma notificação push via Firebase Cloud Messaging (FCM) para um único token.
     * Não persiste no banco — use notify() para o fluxo completo.
     */
    async sendPushNotification(payload) {
        const { token, title, body, data } = payload;
        if (!firebase_1.default.apps.length) {
            logger_1.logger.warn('[Firebase] Tentativa de enviar push notification, mas o Admin SDK não está inicializado.');
            return false;
        }
        try {
            const message = {
                notification: { title, body },
                data: data || {},
                token,
            };
            const response = await firebase_1.default.messaging().send(message);
            logger_1.logger.info(`[Firebase] Notificação push enviada com sucesso. Message ID: ${response}`);
            return true;
        }
        catch (error) {
            logger_1.logger.error({ err: error, token }, '[Firebase] Falha ao enviar notificação push');
            return false;
        }
    },
    /**
     * Broadcast — envia a mesma notificação push para TODOS os usuários com fcmToken registrado.
     * Usado pela rota POST /admin/broadcast (sistema de notícias).
     * Não persiste no banco (mensagem genérica sem userId específico).
     */
    async broadcastToAll(title, body, data) {
        if (!firebase_1.default.apps.length) {
            logger_1.logger.warn('[Firebase] Tentativa de broadcast, mas o Admin SDK não está inicializado.');
            return { sent: 0, failed: 0 };
        }
        // Busca todos os tokens ativos no banco
        const users = await db_1.default.user.findMany({
            where: { fcmToken: { not: null } },
            select: { fcmToken: true },
        });
        const tokens = users.map((u) => u.fcmToken);
        if (tokens.length === 0) {
            logger_1.logger.info('[Firebase] Broadcast: nenhum usuário com fcmToken registrado.');
            return { sent: 0, failed: 0 };
        }
        try {
            const message = {
                notification: { title, body },
                data: data || {},
                tokens,
            };
            const response = await firebase_1.default.messaging().sendEachForMulticast(message);
            logger_1.logger.info(`[Firebase] Broadcast enviado. Sucessos: ${response.successCount}, Falhas: ${response.failureCount}`);
            return { sent: response.successCount, failed: response.failureCount };
        }
        catch (error) {
            logger_1.logger.error({ err: error }, '[Firebase] Falha ao enviar broadcast');
            return { sent: 0, failed: tokens.length };
        }
    },
    /**
     * Envia a mesma notificação push para múltiplos tokens específicos.
     * @deprecated Prefira notify() ou broadcastToAll() para novos usos.
     */
    async sendMulticastPushNotification(tokens, title, body, data) {
        if (!firebase_1.default.apps.length) {
            logger_1.logger.warn('[Firebase] Tentativa de enviar multicast push, mas o Admin SDK não está inicializado.');
            return false;
        }
        if (!tokens || tokens.length === 0) {
            return false;
        }
        try {
            const message = {
                notification: { title, body },
                data: data || {},
                tokens,
            };
            const response = await firebase_1.default.messaging().sendEachForMulticast(message);
            logger_1.logger.info(`[Firebase] Multicast push enviado. Sucessos: ${response.successCount}, Falhas: ${response.failureCount}`);
            return response.successCount > 0;
        }
        catch (error) {
            logger_1.logger.error({ err: error }, '[Firebase] Falha ao enviar multicast push notification');
            return false;
        }
    },
};
