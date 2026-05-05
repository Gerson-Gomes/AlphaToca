import { Router } from 'express';
import { contractController } from '../controllers/contractController';

const router = Router();

/**
 * @swagger
 * /contracts:
 *   post:
 *     summary: Cria um novo contrato de aluguel
 *     tags: [Contratos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId, tenantId, landlordId, startDate, endDate, monthlyRent, dueDay]
 *             properties:
 *               propertyId: { type: 'string', format: 'uuid' }
 *               tenantId: { type: 'string', format: 'uuid' }
 *               landlordId: { type: 'string', format: 'uuid' }
 *               startDate: { type: 'string', format: 'date-time' }
 *               endDate: { type: 'string', format: 'date-time' }
 *               monthlyRent: { type: 'number' }
 *               dueDay: { type: 'integer', minimum: 1, maximum: 31 }
 *               contractUrl: { type: 'string', format: 'uri' }
 *     responses:
 *       201:
 *         description: Contrato criado com sucesso
 */
router.post('/contracts', contractController.create);

/**
 * @swagger
 * /contracts/{id}:
 *   get:
 *     summary: Busca detalhes de um contrato
 *     tags: [Contratos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Detalhes do contrato
 */
router.get('/contracts/:id', contractController.getById);

/**
 * @swagger
 * /tenants:
 *   get:
 *     summary: Lista inquilinos de um proprietário
 *     tags: [Inquilinos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: landlordId
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Lista de inquilinos e seus contratos ativos
 */
router.get('/tenants', contractController.listTenants);

/**
 * @swagger
 * /tenants/{tenantId}/contracts:
 *   get:
 *     summary: Lista contratos de um inquilino específico
 *     tags: [Inquilinos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Lista de contratos
 */
router.get('/tenants/:tenantId/contracts', contractController.listByTenant);

/**
 * @swagger
 * /payments/{paymentId}:
 *   patch:
 *     summary: Atualiza o status de um pagamento de aluguel
 *     tags: [Financeiro]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
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
 *               status: { type: 'string', enum: [PENDING, PAID, OVERDUE, CANCELLED] }
 *               paidDate: { type: 'string', format: 'date-time' }
 *     responses:
 *       200:
 *         description: Pagamento atualizado
 */
router.patch('/payments/:paymentId', contractController.updatePayment);

export default router;
