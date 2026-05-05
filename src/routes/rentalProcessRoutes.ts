import { Router } from 'express';
import { rentalProcessController } from '../controllers/rentalProcessController';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Processo de Locação
 *     description: Gerenciamento das etapas do processo de locação
 *
 * components:
 *   schemas:
 *     RentalProcess:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         tenantId: { type: string, format: uuid }
 *         propertyId: { type: string, format: uuid, nullable: true }
 *         status: { type: string, enum: [TRIAGE, VISIT_SCHEDULED, CONTRACT_ANALYSIS, CLOSED] }
 *         createdAt: { type: string, format: date-time }
 */

/**
 * @swagger
 * /rental-process:
 *   get:
 *     summary: Listar processos de locação do inquilino logado
 *     tags: [Processo de Locação]
 *     responses:
 *       200:
 *         description: Lista de processos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/RentalProcess' }
 */
router.get('/rental-process', rentalProcessController.list);

/**
 * @swagger
 * /rental-process/{id}:
 *   get:
 *     summary: Detalhes de um processo de locação
 *     tags: [Processo de Locação]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Dados do processo
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/RentalProcess' }
 *       404: { description: Processo não encontrado }
 */
router.get('/rental-process/:id', rentalProcessController.getById);

/**
 * @swagger
 * /rental-process/{id}/status:
 *   patch:
 *     summary: Atualizar o status (etapa) do processo de locação
 *     description: |
 *       Muda o status do processo. Gatilhos:
 *       - Se status for CLOSED, notifica Locador e Inquilino.
 *       - Se for qualquer outra mudança, notifica o Inquilino sobre a nova etapa.
 *     tags: [Processo de Locação]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [TRIAGE, VISIT_SCHEDULED, CONTRACT_ANALYSIS, CLOSED] }
 *     responses:
 *       200:
 *         description: Status atualizado com sucesso
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/RentalProcess' }
 *       400: { description: Status inválido }
 *       404: { description: Processo não encontrado }
 */
router.patch('/rental-process/:id/status', rentalProcessController.updateStatus);

export default router;
