import { Router } from 'express';
import { conversationController } from '../controllers/conversationController';

const router = Router();

/**
 * @swagger
 * /conversations:
 *   get:
 *     summary: Lista as conversas do caller (inbox)
 *     description: |
 *       Retorna todas as threads a que o caller pertence — como landlord OU
 *       como tenant. Role-agnóstico: a identidade do contraparte vem da
 *       comparação direta com `conversation.landlordId`/`tenantId`; não usa
 *       `localUser.role`. Um LANDLORD vê o tenant como counterpart; um TENANT
 *       vê o landlord.
 *
 *       Campos de resposta:
 *         - `counterpartName`: nome do OUTRO participante.
 *         - `counterpartAvatarUrl`: sempre `null` no momento — a tabela `users`
 *           não carrega avatar neste PRD; o cliente renderiza iniciais.
 *         - `lastMessage` / `lastMessageAt`: texto + createdAt da última
 *           mensagem; em threads SEM mensagens, `lastMessage=null` e
 *           `lastMessageAt=conversation.createdAt`.
 *         - `unread`: `true` se existe alguma mensagem com `readAt IS NULL`
 *           autorada pelo contraparte (não pelo próprio caller).
 *         - `linkedPropertyId`, `linkedTenantId`: identificadores estáveis
 *           para a UI montar deep links — `linkedTenantId` é sempre o tenantId
 *           da thread, não o id do caller.
 *
 *       Ordenação: `lastMessageAt DESC`. Como ISO strings ordenam
 *       lexicograficamente, threads recentes ficam no topo; threads sem
 *       mensagens caem para o tempo de criação da própria conversa.
 *
 *       `unreadOnly=true` mantém apenas threads com `unread=true`.
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         required: false
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Se 'true', filtra threads com mensagens não lidas do contraparte.
 *     responses:
 *       200:
 *         description: Lista de conversas (pode estar vazia).
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string, format: uuid }
 *                   counterpartName: { type: string }
 *                   counterpartAvatarUrl: { type: string, nullable: true }
 *                   lastMessage: { type: string, nullable: true }
 *                   lastMessageAt: { type: string, format: date-time }
 *                   unread: { type: boolean }
 *                   linkedPropertyId: { type: string, format: uuid }
 *                   linkedTenantId: { type: string, format: uuid }
 *       400:
 *         description: `unreadOnly` fora de 'true'|'false'.
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
router.get('/conversations', conversationController.list);

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
