import { Router } from 'express';
import { conversationController } from '../controllers/conversationController';

const router = Router();

/**
 * @swagger
 * /conversations/resolve:
 *   get:
 *     summary: Resolve (create-or-get) da thread canônica de chat
 *     description: |
 *       Retorna o `id` canônico da conversa entre o landlord dono do imóvel
 *       e o tenant indicado — criando a linha atomicamente quando não existe
 *       (upsert via chave única composta `(propertyId, landlordId, tenantId)`).
 *       Chamadas concorrentes com os mesmos parâmetros retornam o MESMO `id`:
 *       a constraint de unicidade garante uma única linha mesmo sob race.
 *
 *       O campo `landlordId` é derivado do servidor a partir de
 *       `Property.landlordId` — nunca é aceito da query. Isso bloqueia a forja
 *       de threads com um landlord diferente do real dono do imóvel.
 *
 *       Autorização: o caller deve ser o landlord dono do imóvel OU o tenant
 *       informado. Qualquer outro usuário autenticado recebe 403.
 *
 *       O campo `messages` é SEMPRE `[]` neste PRD — o histórico de chat está
 *       fora do escopo desta versão (futura tabela dedicada).
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: propertyId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Thread canônica (criada ou existente).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Conversation'
 *       400:
 *         description: Query params inválidos (propertyId ou tenantId fora do formato UUID).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token ausente ou inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Caller não é nem o landlord dono do imóvel nem o tenant especificado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Propriedade não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/conversations/resolve', conversationController.resolve);

export default router;
