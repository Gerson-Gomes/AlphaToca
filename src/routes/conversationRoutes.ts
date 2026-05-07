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
 *                   counterpartIsIdentityVerified: { type: boolean }
 *                   counterpartIdentityVerifiedAt: { type: string, format: date-time, nullable: true }
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

/**
 * @swagger
 * /conversations/{id}/messages:
 *   get:
 *     summary: Histórico paginado da thread + read receipts automáticos
 *     description: |
 *       Retorna um lote de até `limit` mensagens (default 50, máx 100) da
 *       thread `:id`, ordenado `createdAt` ASC dentro da página.
 *
 *       Paginação "cursor anterior":
 *         - Sem `before`: as `limit` mais recentes.
 *         - Com `before`: as `limit` imediatamente anteriores ao id cursor.
 *
 *       Autorização segue a regra **existence-hiding 404**: tanto conversa
 *       inexistente quanto conversa existente-mas-não-sou-participante
 *       devolvem 404 — não 403. Isso evita que um atacante autenticado possa
 *       enumerar ids de conversas reais.
 *
 *       Efeito colateral: toda mensagem do OUTRO participante com
 *       `readAt=null` que cair nesta página é automaticamente marcada como
 *       lida (`readAt=now()`) no mesmo request — um único `UPDATE` em batch.
 *       Em LL-014 isso dispara o evento socket `conversation:message_read`
 *       para o outro participante.
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: before
 *         required: false
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Id da mensagem cursor — retorna os `limit` itens mais antigos que este id.
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *     responses:
 *       200:
 *         description: Lista paginada de mensagens (ASC dentro da página).
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string, format: uuid }
 *                   authorId: { type: string, format: uuid }
 *                   content: { type: string }
 *                   createdAt: { type: string, format: date-time }
 *                   readAt: { type: string, format: date-time, nullable: true }
 *       400:
 *         description: `id` não-UUID, `before` não-UUID, ou `limit` fora de [1..100].
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
 *       404:
 *         description: Conversa não encontrada OU caller não é participante (existence-hiding).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/conversations/:id/messages', conversationController.listMessages);

/**
 * @swagger
 * /conversations/{id}/messages:
 *   post:
 *     summary: Envia uma nova mensagem na thread
 *     description: |
 *       Persiste uma `ConversationMessage` na thread `:id` autorada pelo caller.
 *       `readAt` é sempre `null` ao criar — o próprio autor nunca conta como
 *       leitor da sua própria mensagem.
 *
 *       Autorização segue a mesma regra **existence-hiding 404** de LL-012:
 *       conversa inexistente E caller não-participante devolvem 404 (nunca 403).
 *       Isso impede enumeração de ids de conversas reais via probing.
 *
 *       Em LL-014, o servidor emite `conversation:new_message` via Socket.IO
 *       para o OUTRO participante após o insert ter sucesso — nunca antes, pra
 *       não anunciar uma mensagem que não ficou no banco (e.g. se o INSERT
 *       falhar por FK/constraint, nenhum socket emit).
 *     tags: [Conversations]
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
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 4000
 *                 description: Texto da mensagem. Whitespace não é trimado no servidor.
 *     responses:
 *       201:
 *         description: Mensagem criada — retorna a linha recém-inserida.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string, format: uuid }
 *                 authorId: { type: string, format: uuid }
 *                 content: { type: string }
 *                 createdAt: { type: string, format: date-time }
 *                 readAt: { type: string, format: date-time, nullable: true }
 *       400:
 *         description: `id` não-UUID, body ausente, `content` vazio ou acima de 4000.
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
 *       404:
 *         description: Conversa não encontrada OU caller não é participante (existence-hiding).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/conversations/:id/messages', conversationController.createMessage);

/**
 * @swagger
 * /conversations/{id}/read:
 *   post:
 *     summary: Marca todas as mensagens não lidas do contraparte como lidas
 *     description: |
 *       Endpoint explícito de "mark-all-as-read". Pensado para quando o cliente
 *       perdeu o socket e precisa re-sincronizar o estado de leitura sem
 *       paginar pelo histórico inteiro (o GET `/messages` também marca, porém
 *       só o que cai na página consultada).
 *
 *       Efeito: `UPDATE conversation_messages SET read_at = NOW()` onde
 *       `conversation_id = :id AND author_id != localUser.id AND read_at IS NULL`,
 *       retornando os ids atingidos via `RETURNING` para um único round-trip.
 *       Quando pelo menos uma mensagem transiciona, dispara
 *       `conversation:message_read` via Socket.IO ao OUTRO participante.
 *
 *       Autorização segue a regra **existence-hiding 404** de LL-012 e LL-013:
 *       conversa inexistente E caller não-participante respondem 404 (nunca 403)
 *       para fechar o oráculo de enumeração de ids.
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Retorna o total de mensagens marcadas como lidas nesta chamada.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 markedRead:
 *                   type: integer
 *                   minimum: 0
 *                   description: Quantidade de linhas transicionadas de unread para read.
 *       400:
 *         description: `id` não-UUID.
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
 *       404:
 *         description: Conversa não encontrada OU caller não é participante (existence-hiding).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/conversations/:id/read', conversationController.markAllRead);

export default router;
