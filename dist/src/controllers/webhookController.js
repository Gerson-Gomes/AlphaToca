"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.receiveMessage = exports.verifyWebhook = void 0;
exports.validateWebhookConfig = validateWebhookConfig;
const zod_1 = require("zod");
const kafkaProducer_1 = require("../services/kafkaProducer");
const whatsappSchema_1 = require("../schemas/whatsappSchema");
const messageStatusService_1 = require("../services/messageStatusService");
const verifyMetaSignature_1 = require("../utils/verifyMetaSignature");
const logger_1 = require("../config/logger");
const db_1 = __importDefault(require("../config/db"));
/**
 * Valida no startup que as variáveis de ambiente necessárias ao webhook
 * estão presentes. Deve ser chamada antes de app.listen() para falhar
 * rápido em caso de configuração ausente.
 */
function validateWebhookConfig() {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!verifyToken || verifyToken.trim() === '') {
        throw new Error('[Webhook] WHATSAPP_VERIFY_TOKEN não configurado. Configure no .env antes de subir o servidor.');
    }
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret || appSecret.trim() === '') {
        throw new Error('[Webhook] META_APP_SECRET não configurado. Obtenha em developers.facebook.com/apps/{id}/settings/basic.');
    }
    logger_1.logger.info('[webhook] configuration validated');
}
const verifyWebhook = (req, res) => {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === verifyToken) {
        logger_1.logger.info('[webhook] verification handshake succeeded');
        res.status(200).send(challenge);
    }
    else {
        logger_1.logger.warn({ mode }, '[webhook] verification handshake failed');
        res.sendStatus(403);
    }
};
exports.verifyWebhook = verifyWebhook;
const receiveMessage = async (req, res, _next) => {
    try {
        const appSecret = process.env.META_APP_SECRET;
        const isTestEnv = process.env.NODE_ENV === 'test';
        if (!isTestEnv) {
            if (!appSecret) {
                logger_1.logger.error('[webhook] META_APP_SECRET missing; rejecting request');
                res.status(500).send('EVENT_RECEIVED');
                return;
            }
            const signatureHeader = req.header('x-hub-signature-256');
            if (!(0, verifyMetaSignature_1.verifyMetaSignature)(req.rawBody, signatureHeader, appSecret)) {
                logger_1.logger.warn('[webhook] HMAC signature invalid; request rejected');
                res.status(401).send('EVENT_RECEIVED');
                return;
            }
        }
        const value = req.body?.entry?.[0]?.changes?.[0]?.value;
        if (value?.statuses) {
            logger_1.logger.info({ statuses: value.statuses }, '[webhook] meta status receipt');
            for (const s of value.statuses) {
                (0, messageStatusService_1.updateMessageStatus)({ id: s.id, status: s.status }).catch((err) => {
                    logger_1.logger.error({ err, statusId: s.id }, '[webhook] failed to persist status');
                });
            }
            res.sendStatus(200);
            return;
        }
        const payload = whatsappSchema_1.WhatsAppWebhookSchema.parse(req.body);
        res.status(200).send('EVENT_RECEIVED');
        if (payload.object === 'whatsapp_business_account') {
            try {
                const phoneNumber = payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id;
                await (0, kafkaProducer_1.produceWhatsAppMessage)(payload, phoneNumber);
                logger_1.logger.info({ phoneNumber }, '[webhook] message produced to kafka successfully');
            }
            catch (err) {
                logger_1.logger.error({ err, phoneNumber: payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id }, '[webhook] failed to produce message to kafka');
                // Não retorna erro (webhook já respondeu 200 OK)
            }
        }
    }
    catch (error) {
        if (error instanceof zod_1.ZodError) {
            logger_1.logger.error({ errors: error.errors }, '[webhook] payload rejected by Zod validation');
            // Persiste payload cru para investigação posterior. Nunca deixar
            // isso bloquear a resposta 200 à Meta (swallow + log on failure).
            db_1.default.webhookFailure
                .create({
                data: {
                    source: 'whatsapp',
                    rawBody: req.body ?? {},
                    headers: req.headers,
                    error: JSON.stringify(error.errors),
                },
            })
                .catch((persistErr) => {
                logger_1.logger.error({ err: persistErr }, '[webhook] failed to persist webhook_failure');
            });
            res.status(200).send('EVENT_RECEIVED');
            return;
        }
        logger_1.logger.error({ err: error }, '[webhook] unexpected error');
        res.status(200).send('EVENT_RECEIVED');
    }
};
exports.receiveMessage = receiveMessage;
