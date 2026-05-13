"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adminController_1 = require("../controllers/adminController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
const adminOnly = (0, authMiddleware_1.requireRole)('ADMIN');
/**
 * @swagger
 * /admin/metrics:
 *   get:
 *     summary: Métricas agregadas para o painel admin
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Agregados do sistema
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totals:
 *                   type: object
 *                   properties:
 *                     users:
 *                       type: integer
 *                     properties:
 *                       type: integer
 *                     visits:
 *                       type: integer
 *                     pendingModeration:
 *                       type: integer
 *                 usersByRole:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *                 propertiesByStatus:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *                 propertiesByModeration:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *                 generatedAt:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Token ausente ou inválido
 *       403:
 *         description: Usuário sem role ADMIN
 */
router.get('/admin/metrics', adminOnly, adminController_1.adminController.getMetrics);
/**
 * @swagger
 * /admin/properties:
 *   get:
 *     summary: Lista imóveis por status de moderação (default PENDING)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED]
 *         description: Default PENDING
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Lista paginada de imóveis
 *       401:
 *         description: Token ausente ou inválido
 *       403:
 *         description: Usuário sem role ADMIN
 */
router.get('/admin/properties', adminOnly, adminController_1.adminController.listPendingProperties);
/**
 * @swagger
 * /admin/broadcast:
 *   post:
 *     summary: Envia notificação push para todos os usuários com fcmToken registrado
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, body]
 *             properties:
 *               title:
 *                 type: string
 *                 maxLength: 100
 *                 example: "Nova funcionalidade disponível!"
 *               body:
 *                 type: string
 *                 maxLength: 500
 *                 example: "Confira os novos imóveis disponíveis na sua região."
 *     responses:
 *       200:
 *         description: Broadcast enviado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 sent:
 *                   type: integer
 *                 failed:
 *                   type: integer
 *       400:
 *         description: Payload inválido
 *       401:
 *         description: Token ausente ou inválido
 *       403:
 *         description: Usuário sem role ADMIN
 */
router.post('/admin/broadcast', adminOnly, adminController_1.adminController.sendBroadcast);
router.get('/admin/contracts', adminOnly, adminController_1.adminController.listContracts);
exports.default = router;
