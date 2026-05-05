import { Router } from 'express';
import { chatController } from '../controllers/chatController';

const router = Router();

/**
 * @swagger
 * /chat/sessions:
 *   post:
 *     summary: Obtém ou cria uma sessão de chat para um inquilino
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tenantId]
 *             properties:
 *               tenantId: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Sessão de chat retornada com sucesso
 */
router.post('/chat/sessions', chatController.getOrCreateSession);

/**
 * @swagger
 * /chat/sessions:
 *   get:
 *     summary: Lista sessões de chat
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tenantId
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Lista de sessões
 */
router.get('/chat/sessions', chatController.listSessions);

/**
 * @swagger
 * /chat/sessions/{id}:
 *   get:
 *     summary: Busca detalhes de uma sessão e seu histórico de mensagens
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Detalhes da sessão
 */
router.get('/chat/sessions/:id', chatController.getSession);

/**
 * @swagger
 * /chat/messages:
 *   post:
 *     summary: Envia uma nova mensagem em uma sessão
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, senderType, content]
 *             properties:
 *               sessionId: { type: 'string', format: 'uuid' }
 *               senderType: { type: 'string', enum: [BOT, TENANT, LANDLORD] }
 *               content: { type: 'string' }
 *               mediaUrl: { type: 'string', format: 'uri' }
 *     responses:
 *       201:
 *         description: Mensagem enviada
 */
router.post('/chat/messages', chatController.sendMessage);

/**
 * @swagger
 * /chat/sessions/{id}/status:
 *   patch:
 *     summary: Atualiza o status de uma sessão (ex. aguardando humano)
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: 'string', enum: [ACTIVE_BOT, WAITING_HUMAN, RESOLVED] }
 *     responses:
 *       200:
 *         description: Status atualizado
 */
router.patch('/chat/sessions/:id/status', chatController.updateStatus);

export default router;
