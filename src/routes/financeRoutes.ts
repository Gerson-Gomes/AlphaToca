import { Router } from 'express';
import { financeController } from '../controllers/financeController';

const router = Router();

/**
 * @swagger
 * /finance/expenses:
 *   post:
 *     summary: Registra uma nova despesa de um imóvel (IPTU, Condomínio, etc)
 *     tags: [Financeiro]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId, type, amount, dueDate, year, month]
 *             properties:
 *               propertyId: { type: 'string', format: 'uuid' }
 *               type: { type: 'string', example: 'IPTU' }
 *               amount: { type: 'number' }
 *               dueDate: { type: 'string', format: 'date-time' }
 *               year: { type: 'integer' }
 *               month: { type: 'integer', minimum: 1, maximum: 12 }
 *     responses:
 *       201:
 *         description: Despesa registrada
 */
router.post('/finance/expenses', financeController.addExpense);

/**
 * @swagger
 * /finance/maintenance:
 *   post:
 *     summary: Registra um log de manutenção ou reparo no imóvel
 *     tags: [Dossiê]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId, title, date]
 *             properties:
 *               propertyId: { type: 'string', format: 'uuid' }
 *               title: { type: 'string', example: 'Pintura da Sala' }
 *               description: { type: 'string' }
 *               cost: { type: 'number' }
 *               date: { type: 'string', format: 'date-time' }
 *     responses:
 *       201:
 *         description: Manutenção registrada
 */
router.post('/finance/maintenance', financeController.addMaintenance);

/**
 * @swagger
 * /properties/{propertyId}/dossier:
 *   get:
 *     summary: Retorna o dossiê completo do imóvel (histórico de gastos e manutenções)
 *     tags: [Dossiê]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: propertyId
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Dados do dossiê
 */
router.get('/properties/:propertyId/dossier', financeController.getDossier);

/**
 * @swagger
 * /finance/analytics:
 *   get:
 *     summary: Retorna dados agregados mensais (Receita, Despesa, Lucro) para gráficos
 *     tags: [Financeiro]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: landlordId
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *       - in: query
 *         name: year
 *         schema: { type: 'integer' }
 *     responses:
 *       200:
 *         description: Dados analíticos mensais
 */
router.get('/finance/analytics', financeController.getAnalytics);

export default router;
