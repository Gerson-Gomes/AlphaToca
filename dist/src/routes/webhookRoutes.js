"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const webhookController_1 = require("../controllers/webhookController");
const router = (0, express_1.Router)();
const webhookRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'EVENT_RECEIVED',
    skip: () => process.env.NODE_ENV === 'test',
});
/**
 * @swagger
 * /webhook:
 *   get:
 *     summary: Verificar Webhook da Meta
 *     description: Endpoint utilizado pela Meta para verificar o servidor durante a configuração do webhook.
 *     tags: [Webhooks]
 *     parameters:
 *       - in: query
 *         name: hub.mode
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: hub.verify_token
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: hub.challenge
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Verificação bem-sucedida, retorna a string challenge
 *       403:
 *         description: Falha na verificação
 */
router.get('/webhook', webhookController_1.verifyWebhook);
/**
 * @swagger
 * /webhook:
 *   post:
 *     summary: Receber Mensagens do WhatsApp
 *     description: Endpoint para receber mensagens e eventos em tempo real da API do WhatsApp Business.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WhatsAppPayload'
 *     responses:
 *       200:
 *         description: Mensagem recebida com sucesso
 *       400:
 *         description: Payload inválido ou malformatado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/webhook', webhookRateLimiter, webhookController_1.receiveMessage);
exports.default = router;
