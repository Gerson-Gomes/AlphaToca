import { Router } from 'express';
import { notificationController } from '../controllers/notificationController';

const router = Router();

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Retorna a contagem de notificações não lidas (badge do app)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Contagem de não lidas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                   example: 3
 *       401:
 *         description: Token ausente ou inválido
 */
router.get('/notifications/unread-count', notificationController.unreadCount);

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: Lista as notificações do usuário autenticado (US-013, histórico cross-device)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Quando 'true', filtra apenas notificações com readAt IS NULL.
 *     responses:
 *       200:
 *         description: Lista de notificações (array) ordenada por receivedAt DESC
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   title:
 *                     type: string
 *                   body:
 *                     type: string
 *                   receivedAt:
 *                     type: string
 *                     format: date-time
 *                   read:
 *                     type: boolean
 *                   category:
 *                     type: string
 *                     enum: [update, announcement, system]
 *       400:
 *         description: Parâmetro de query inválido
 *       401:
 *         description: Token ausente ou inválido
 */
router.get('/notifications', notificationController.list);

/**
 * @swagger
 * /notifications/read-all:
 *   patch:
 *     summary: Marca todas as notificações do usuário como lidas
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Quantidade de notificações atualizadas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 updated:
 *                   type: integer
 *       401:
 *         description: Token ausente ou inválido
 */
router.patch('/notifications/read-all', notificationController.markAllAsRead);

/**
 * @swagger
 * /notifications/{id}/read:
 *   patch:
 *     summary: Marca uma notificação específica como lida
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notificação marcada como lida
 *       403:
 *         description: Notificação não pertence ao usuário
 *       404:
 *         description: Notificação não encontrada
 *       401:
 *         description: Token ausente ou inválido
 */
router.patch('/notifications/:id/read', notificationController.markAsRead);

/**
 * @swagger
 * /notifications/{id}/read:
 *   put:
 *     summary: Marca uma notificação como lida (idempotente, cross-device — US-014)
 *     description: |
 *       Variante idempotente do mark-as-read. Se a notificação já está lida,
 *       retorna 204 sem atualizar `readAt` (preserva o timestamp original do
 *       primeiro dispositivo que a leu). Sempre retorna 204 em caminhos
 *       felizes — clientes podem usar fire-and-forget sem parsear o body.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Notificação marcada (ou já estava marcada — idempotente)
 *       401:
 *         description: Token ausente ou inválido
 *       403:
 *         description: Notificação não pertence ao usuário
 *       404:
 *         description: Notificação não encontrada
 */
router.put('/notifications/:id/read', notificationController.markAsReadIdempotent);

export default router;
