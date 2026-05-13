"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastService = exports.broadcastSchema = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
const pushNotificationService_1 = require("./pushNotificationService");
const logger_1 = require("../config/logger");
// ---------------------------------------------------------------------------
// Validação do payload de broadcast
// ---------------------------------------------------------------------------
exports.broadcastSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, 'Título é obrigatório').max(100),
    body: zod_1.z.string().min(1, 'Mensagem é obrigatória').max(500),
});
// ---------------------------------------------------------------------------
// Serviço de Broadcast
// ---------------------------------------------------------------------------
exports.broadcastService = {
    /**
     * Envia uma notificação push para TODOS os usuários E persiste um
     * Notification row por target userId — US-013 cross-device.
     *
     * Ordem:
     *   1. SELECT all users (para persistência de histórico, inclusive quem não
     *      tem fcmToken registrado — o objetivo do rollout é exatamente que a
     *      tela /notifications seja cross-device, não FCM-dependent).
     *   2. INSERT em uma transação Prisma, um Notification por user com
     *      `type = BROADCAST`, `category = announcement`.
     *   3. FCM dispatch via pushNotificationService.broadcastToAll (HTTP,
     *      fora da transação — FCM não é transacional com o DB).
     *
     * Se a persistência falhar (DB down, etc.), o broadcast NÃO dispara — o
     * histórico é a fonte da verdade; push sem histórico quebra "cross-device".
     *
     * @returns { sent, failed, persisted } — sent/failed vêm da resposta do
     *   FCM; persisted é o número de Notification rows criados.
     */
    async sendToAll(input) {
        logger_1.logger.info({ title: input.title }, '[broadcastService] Iniciando broadcast para todos os usuários.');
        const users = await db_1.default.user.findMany({
            select: { id: true, fcmToken: true },
        });
        let persisted = 0;
        if (users.length > 0) {
            const result = await db_1.default.$transaction(async (tx) => {
                return tx.notification.createMany({
                    data: users.map((u) => ({
                        userId: u.id,
                        type: client_1.NotificationType.BROADCAST,
                        category: client_1.NotificationCategory.announcement,
                        title: input.title,
                        body: input.body,
                    })),
                });
            });
            persisted = result.count;
        }
        const fcm = await pushNotificationService_1.pushNotificationService.broadcastToAll(input.title, input.body, { type: 'BROADCAST' });
        logger_1.logger.info({ ...fcm, persisted }, '[broadcastService] Broadcast concluído.');
        return { sent: fcm.sent, failed: fcm.failed, persisted };
    },
};
