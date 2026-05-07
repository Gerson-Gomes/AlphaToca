import { Router } from 'express';
import { supportTicketController } from '../controllers/supportTicketController';
import { requireRole } from '../middlewares/authMiddleware';

const router = Router();

const adminOnly = requireRole('ADMIN');

/**
 * @swagger
 * /support/tickets:
 *   post:
 *     summary: Abrir novo ticket de suporte
 *     description: |
 *       Qualquer usuário autenticado (TENANT, LANDLORD ou ADMIN) pode abrir
 *       um chamado de suporte. O servidor gera o protocolo humano no formato
 *       `SUP-AAMMDD-XXXX` (AAMMDD = data local do servidor, XXXX = 4 chars
 *       base36 uppercase) e retorna o `id` UUID, o `code` e o `createdAt`.
 *
 *       Campos derivados do servidor (nunca aceitos do body):
 *       - `userId`, `userName`, `userRole` — vêm do JWT via `req.localUser`.
 *       - `code` — gerado no servidor; em caso de colisão UNIQUE, regerado
 *         até 5 vezes antes de bubblar 500.
 *       - `createdAt` — `now()` via Prisma `@default(now())`.
 *
 *       Notificação por email ao canal de suporte (via supportEmailService)
 *       acontece após o insert no banco. Falhas no envio de email NÃO
 *       derrubam a request — o ticket é gravado e respondido 201 normalmente.
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description]
 *             properties:
 *               title:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 120
 *                 example: App trava ao enviar foto no chat
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 4000
 *                 example: |
 *                   Quando eu seleciono a foto na galeria, o app fecha sozinho.
 *                   Acontece sempre no Android 13.
 *     responses:
 *       201:
 *         description: Ticket criado com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [id, code, createdAt]
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 code:
 *                   type: string
 *                   pattern: '^SUP-\d{6}-[A-Z0-9]{4}$'
 *                   example: SUP-260507-A3F2
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Body inválido (title/description ausente ou fora dos limites).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token ausente ou inválido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/support/tickets', supportTicketController.create);

/**
 * @swagger
 * /admin/support/tickets:
 *   get:
 *     summary: Listar tickets de suporte (admin-only triage)
 *     description: |
 *       Retorna a lista paginada de tickets para o painel de triage do admin.
 *       Ordem padrão: `createdAt DESC` (mais recente primeiro).
 *
 *       Autenticação + autorização:
 *       - Requer JWT válido (401 se ausente/inválido).
 *       - Requer role ADMIN (403 se autenticado com role TENANT ou LANDLORD).
 *
 *       Filtros combináveis (todos opcionais, sem filtros retorna tudo):
 *       - `status` — OPEN ou RESOLVED.
 *       - `role` — TENANT ou LANDLORD (não aceita ADMIN; tickets abertos
 *         por admins são ruído no funil de triage normal).
 *       - `from` / `to` — ISO 8601. Aceita `YYYY-MM-DD` ou com hora/offset.
 *         `from > to` retorna 400 VALIDATION_ERROR.
 *
 *       Paginação:
 *       - `page` — default 1, min 1.
 *       - `pageSize` — default 50, min 1, max 200.
 *
 *       Cada item inclui o usuário que abriu (`user: {id,name,email,role}`)
 *       e, quando atribuído, o admin responsável (`assignedTo: {id,name}`).
 *       `resolution` é preenchido via PUT /admin/support/tickets/{id} (US-020).
 *     tags: [Support, Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [OPEN, RESOLVED]
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [TENANT, LANDLORD]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *           example: '2026-05-01T00:00:00Z'
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *           example: '2026-05-31T23:59:59Z'
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 50
 *     responses:
 *       200:
 *         description: Envelope paginado de tickets.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [data, page, pageSize, total]
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     required: [id, code, title, description, user, status, createdAt, updatedAt]
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       code:
 *                         type: string
 *                         pattern: '^SUP-\d{6}-[A-Z0-9]{4}$'
 *                       title: { type: string }
 *                       description: { type: string }
 *                       user:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           name: { type: string }
 *                           email: { type: string, format: email }
 *                           role: { type: string, enum: [TENANT, LANDLORD, ADMIN] }
 *                       status: { type: string, enum: [OPEN, RESOLVED] }
 *                       createdAt: { type: string, format: date-time }
 *                       updatedAt: { type: string, format: date-time }
 *                       assignedTo:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           name: { type: string }
 *                       resolution: { type: string, nullable: true }
 *                 page: { type: integer, example: 1 }
 *                 pageSize: { type: integer, example: 50 }
 *                 total: { type: integer, example: 123 }
 *       400:
 *         description: Query inválida (status/role/datas/page/pageSize fora dos limites).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token ausente ou inválido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Usuário autenticado sem role ADMIN.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/admin/support/tickets', adminOnly, supportTicketController.listForAdmin);

/**
 * @swagger
 * /admin/support/tickets/{id}:
 *   put:
 *     summary: Atualizar ticket de suporte (admin-only)
 *     description: |
 *       Atualiza o status, a resolução e/ou o assignee de um ticket.
 *       Todos os campos do body são opcionais individualmente, mas pelo menos
 *       um deles precisa estar presente.
 *
 *       **Regras de negócio:**
 *       - Quando `status` transita para `RESOLVED`, o campo `resolution`
 *         precisa estar presente **na mesma request** (400 VALIDATION_ERROR
 *         caso contrário). Isso evita fechar um ticket sem registrar a
 *         resolução.
 *       - Quando `assignedToId` é fornecido e não corresponde a um User
 *         existente, a resposta é 400 com `code: 'ASSIGNEE_NOT_FOUND'` (não
 *         um 500 por FK violation).
 *       - Em mudança de `status`, o canal de suporte é notificado via
 *         `supportEmailService.sendTicketUpdated` (best-effort — falha no
 *         envio não derruba a request).
 *
 *       Auth: JWT válido (401) + role ADMIN (403).
 *
 *       Resposta: o ticket atualizado com a mesma shape dos itens retornados
 *       pelo GET /admin/support/tickets (US-019).
 *     tags: [Support, Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: |
 *               Pelo menos um campo é obrigatório. Se `status=RESOLVED`,
 *               `resolution` também é obrigatório na mesma request.
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [OPEN, RESOLVED]
 *               resolution:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 4000
 *               assignedToId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Ticket atualizado.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [id, code, title, description, user, status, createdAt, updatedAt]
 *               properties:
 *                 id: { type: string, format: uuid }
 *                 code:
 *                   type: string
 *                   pattern: '^SUP-\d{6}-[A-Z0-9]{4}$'
 *                 title: { type: string }
 *                 description: { type: string }
 *                 user:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                     email: { type: string, format: email }
 *                     role: { type: string, enum: [TENANT, LANDLORD, ADMIN] }
 *                 status: { type: string, enum: [OPEN, RESOLVED] }
 *                 createdAt: { type: string, format: date-time }
 *                 updatedAt: { type: string, format: date-time }
 *                 assignedTo:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                 resolution:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Body inválido, regra RESOLVED+resolution violada, ou ASSIGNEE_NOT_FOUND.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token ausente ou inválido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Usuário autenticado sem role ADMIN.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Ticket não encontrado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put('/admin/support/tickets/:id', adminOnly, supportTicketController.updateForAdmin);

export default router;
