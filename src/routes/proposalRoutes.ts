import { Router } from 'express';
import { proposalController } from '../controllers/proposalController';

const router = Router();

/**
 * @swagger
 * /proposals:
 *   post:
 *     summary: Cria uma nova proposta para um imóvel
 *     tags: [Propostas]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId, tenantId, proposedPrice]
 *             properties:
 *               propertyId: { type: 'string', format: 'uuid' }
 *               tenantId: { type: 'string', format: 'uuid' }
 *               proposedPrice: { type: 'number', minimum: 0 }
 *               message: { type: 'string' }
 *     responses:
 *       201:
 *         description: Proposta criada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Proposal'
 *       400:
 *         description: Erro na requisição ou imóvel indisponível
 *       404:
 *         description: Imóvel ou inquilino não encontrado
 *       409:
 *         description: Inquilino já possui proposta ativa para este imóvel
 */
router.post('/proposals', proposalController.create);

/**
 * @swagger
 * /proposals:
 *   get:
 *     summary: Lista propostas (filtros opcionais)
 *     tags: [Propostas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tenantId
 *         schema: { type: 'string', format: 'uuid' }
 *       - in: query
 *         name: propertyId
 *         schema: { type: 'string', format: 'uuid' }
 *       - in: query
 *         name: landlordId
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Lista de propostas
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Proposal'
 */
router.get('/proposals', proposalController.list);

/**
 * @swagger
 * /proposals/{id}:
 *   get:
 *     summary: Detalhes de uma proposta específica
 *     tags: [Propostas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Dados da proposta
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Proposal'
 *       404:
 *         description: Proposta não encontrada
 */
router.get('/proposals/:id', proposalController.getById);

/**
 * @swagger
 * /proposals/{id}/status:
 *   patch:
 *     summary: Atualiza o status de uma proposta (Aceitar/Recusar/Contra-proposta)
 *     tags: [Propostas]
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
 *               status:
 *                 type: string
 *                 enum: [PENDING, ACCEPTED, REJECTED, COUNTER_OFFER, WITHDRAWN]
 *     responses:
 *       200:
 *         description: Status atualizado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Proposal'
 *       404:
 *         description: Proposta não encontrada
 */
router.patch('/proposals/:id/status', proposalController.updateStatus);

export default router;
