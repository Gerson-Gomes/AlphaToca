import { Router } from 'express';
import { visitController } from '../controllers/visitController';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Visitas
 *     description: Agendamento de visitas a imóveis
 *
 * components:
 *   schemas:
 *     Visit:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         propertyId: { type: string, format: uuid }
 *         tenantId: { type: string, format: uuid }
 *         landlordId: { type: string, format: uuid }
 *         rentalProcessId: { type: string, format: uuid, nullable: true }
 *         scheduledAt: { type: string, format: date-time }
 *         durationMinutes: { type: integer, minimum: 15, maximum: 180 }
 *         status: { type: string, enum: [SCHEDULED, CANCELLED, COMPLETED, NO_SHOW] }
 *         source:
 *           type: string
 *           enum: [MANUAL, AI]
 *           default: MANUAL
 *           description: >-
 *             Origem da visita. `MANUAL` = agendada por humano (cliente normal).
 *             `AI` é reservado para um fluxo interno de agente que ainda não tem
 *             writer no backend (grep `leadExtractionService` callers — hoje só
 *             detecta intent em conversas WhatsApp, não cria Visit). Clientes
 *             humanos sempre gravam `MANUAL`.
 *         notes: { type: string, nullable: true }
 */

/**
 * @swagger
 * /visits:
 *   post:
 *     summary: Criar um agendamento de visita
 *     tags: [Visitas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId, tenantId, scheduledAt]
 *             properties:
 *               propertyId: { type: string, format: uuid }
 *               tenantId: { type: string, format: uuid }
 *               rentalProcessId: { type: string, format: uuid }
 *               scheduledAt: { type: string, format: date-time }
 *               durationMinutes: { type: integer, minimum: 15, maximum: 180, default: 45 }
 *               source:
 *                 type: string
 *                 enum: [MANUAL, AI]
 *                 default: MANUAL
 *                 description: >-
 *                   Opcional. Clientes humanos devem omitir ou enviar `MANUAL`;
 *                   `AI` é reservado para um futuro fluxo interno de agente
 *                   (ver `leadExtractionService` callers).
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Visita agendada com sucesso
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Visit' }
 *       400: { description: Erro de validação }
 *       404: { description: Propriedade não encontrada }
 *       409: { description: Conflito de agenda (propriedade ou locador ocupado) }
 */
router.post('/visits', visitController.create);

/**
 * @swagger
 * /visits:
 *   get:
 *     summary: Listar visitas com filtros opcionais
 *     tags: [Visitas]
 *     parameters:
 *       - in: query
 *         name: propertyId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: tenantId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: landlordId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [SCHEDULED, CANCELLED, COMPLETED, NO_SHOW] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Lista de visitas
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Visit' }
 */
router.get('/visits', visitController.list);

/**
 * @swagger
 * /visits/availability:
 *   get:
 *     summary: Consultar horários livres de uma propriedade
 *     tags: [Visitas]
 *     parameters:
 *       - in: query
 *         name: propertyId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         required: true
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         required: true
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: slotMinutes
 *         schema: { type: integer, minimum: 15, maximum: 180, default: 45 }
 *     responses:
 *       200:
 *         description: Slots disponíveis
 *       404: { description: Propriedade não encontrada }
 */
router.get('/visits/availability', visitController.availability);

/**
 * @swagger
 * /visits/{id}:
 *   get:
 *     summary: Consultar uma visita pelo ID
 *     tags: [Visitas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Visita encontrada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Visit' }
 *       404: { description: Visita não encontrada }
 */
router.get('/visits/:id', visitController.getById);

/**
 * @swagger
 * /visits/{id}:
 *   patch:
 *     summary: Atualizar uma visita (remarcar, cancelar, etc.)
 *     tags: [Visitas]
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
 *             properties:
 *               scheduledAt: { type: string, format: date-time }
 *               durationMinutes: { type: integer }
 *               status: { type: string, enum: [SCHEDULED, CANCELLED, COMPLETED, NO_SHOW] }
 *               notes: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Visita atualizada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Visit' }
 *       400: { description: Erro de validação }
 *       404: { description: Visita não encontrada }
 *       409: { description: Conflito de agenda }
 */
router.patch('/visits/:id', visitController.update);

/**
 * @swagger
 * /visits/{id}:
 *   delete:
 *     summary: Cancelar uma visita (soft delete — status vai para CANCELLED)
 *     tags: [Visitas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Visita cancelada }
 *       404: { description: Visita não encontrada }
 */
router.delete('/visits/:id', visitController.cancel);

export default router;
