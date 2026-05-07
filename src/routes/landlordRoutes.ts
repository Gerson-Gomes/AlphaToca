import { Router } from 'express';
import { landlordController } from '../controllers/landlordController';

const router = Router();

/**
 * @swagger
 * /landlord/metrics:
 *   get:
 *     summary: Dashboard top-card metrics for the authenticated landlord
 *     description: |
 *       Retorna, em uma única round-trip, as três métricas que o home do
 *       landlord usa para popular os cards no topo da tela:
 *
 *       - `profileViews` — abertura do perfil público do landlord nos últimos
 *         30 dias (`ProfileView.viewedAt >= now() - 30d`, LL-001).
 *       - `proposalsPending` — propostas em `PENDING` em qualquer imóvel deste
 *         landlord (sem filtro de janela — enquanto não forem aceitas/recusadas
 *         aparecem na lista).
 *       - `unreadMessages` — mensagens escritas pela contraparte em qualquer
 *         conversa do landlord que ainda não tiveram `readAt` setado. Até a
 *         LL-010 materializar a tabela `ConversationMessage`, o campo é
 *         retornado como `0` (fallback gracioso — 404 / 500 aqui forçaria o
 *         dashboard a mostrar mock).
 *
 *       O `landlordId` é derivado do JWT (`req.localUser.id`) — nenhum query
 *       param é aceito, para evitar enumeração de métricas de outros landlords.
 *
 *       Autenticação:
 *       - JWT válido (`checkJwt` + `authSyncMiddleware` aplicados no mount em
 *         app.ts). Ausente → 401.
 *       - Role `LANDLORD` (`requireRole(LANDLORD)` aplicado no mount). Um
 *         TENANT ou ADMIN autenticado recebe 403.
 *     tags: [Landlord]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Métricas calculadas com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [profileViews, proposalsPending, unreadMessages]
 *               properties:
 *                 profileViews:
 *                   type: integer
 *                   minimum: 0
 *                   example: 142
 *                 proposalsPending:
 *                   type: integer
 *                   minimum: 0
 *                   example: 3
 *                 unreadMessages:
 *                   type: integer
 *                   minimum: 0
 *                   example: 7
 *       401:
 *         description: Token ausente ou inválido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Autenticado mas a role não é LANDLORD.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/landlord/metrics', landlordController.getMetrics);

export default router;
