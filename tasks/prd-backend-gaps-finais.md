# PRD: Backend P4 — Fechar Gaps Finais pós-Landlord Rollout

**Fonte**: `GAPS_FINAIS.md` (snapshot 2026-05-07)
**Contexto**: continuação do rollout "Backend Landlord Integration (P1→P3)" já
entregue 100%. Este PRD cobre o escopo **P4** — fechar os bugs ativos nos logs
do frontend e implementar os endpoints que destrancam telas hoje sem backend.

---

## 1. Introduction / Overview

Depois de US-001 a US-020 terem sido entregues 100% (PRD anterior
"Backend Landlord Integration Rollout P1→P3"), o frontend do I-Móveis
ainda apresenta bugs ativos nos logs (§1 do GAPS_FINAIS.md) e telas
que caem em cache local ou estado vazio por **falta de endpoint**.
Este PRD lista os itens 1–12 da priorização §8 do `GAPS_FINAIS.md`:

- **Alta**: 4 itens que correspondem a bugs visíveis nos logs.
- **Média**: 3 itens que completam funcionalidades já iniciadas.
- **Baixa**: 5 itens de melhoria que fecham cards e filtros cosméticos.

Decisões de produto abertas (chat em thread de ticket §1.3/§4.4 e
`transactionType` §6.3) ficam em §9 Open Questions — não viram trabalho
executável até produto alinhar.

## 2. Goals

- Eliminar os **3 bugs ativos** nos logs do frontend (`/api/conversations`
  timeout, `/api/support/tickets` timeout, imagens 404/CORS).
- Entregar os **endpoints faltantes** identificados em `GAPS_FINAIS.md`
  §2 (landlord), §3 (tenant), §4 (suporte), §5 (visitas), §6 (schema),
  §7 (notificações).
- Manter a paridade com o padrão de autorização já estabelecido pelo
  rollout anterior (JWT por role, ownership checks em
  `property.landlordId` / `ticket.userId` / participante da
  `Conversation`).
- Não quebrar nenhum endpoint atual já validado por `progress.txt`.

## 3. User Stories

### US-001: Investigar causa raiz do carregamento de imagens (§1.4)

**Description:** Como backend dev, preciso confirmar qual das 3 hipóteses
do GAPS_FINAIS.md §1.4 está causando o placeholder de casa nas telas de
gestão de aluguéis e detalhes de imóvel, para que o fix da US-002 seja
direcionado.

**Acceptance Criteria:**
- [ ] Verificar que o arquivo físico existe em
      `uploads/<propertyId>/<file>.jpg` para pelo menos um imóvel real
      criado via POST/PUT multipart
- [ ] Abrir `http://localhost:3000/uploads/<propertyId>/<file>` direto
      no navegador e registrar: status HTTP, `Content-Type` recebido,
      cabeçalhos CORS presentes
- [ ] Cruzar com o `debugPrint` já adicionado no `errorBuilder` do
      frontend para confirmar a URL exata que falha
- [ ] Documentar o diagnóstico em comentário da issue/PR de fix (hipótese
      1 CORS, 2 arquivo ausente, 3 Content-Type) — a US-002 só começa
      com esse diagnóstico escrito

### US-002: Aplicar fix identificado e servir imagens corretamente (§1.4)

**Description:** Como usuário (landlord ou tenant), quero ver as fotos
dos imóveis no lugar do placeholder de casa.

**Acceptance Criteria:**
- [ ] Fix aplicado corresponde à hipótese confirmada na US-001
      (provavelmente `cors()` aplicado antes de `express.static('/uploads')`
      em `src/app.ts`, conforme §149-151 do GAPS_FINAIS.md)
- [ ] `GET http://localhost:3000/uploads/<propertyId>/<file>.jpg`
      responde 200 com `Content-Type: image/jpeg` e cabeçalhos CORS
      permitindo `localhost:5173` (Flutter web)
- [ ] Tela "Gestão de Aluguéis" do landlord carrega as fotos reais
- [ ] Tela de detalhes do imóvel carrega as fotos reais
- [ ] Teste manual confirma que imóveis criados ANTES do fix e DEPOIS
      do fix ambos exibem imagens (ou diagnóstico explica por que os
      antigos não têm arquivo físico)

### US-003: `GET /api/support/tickets` — usuário lista seus próprios chamados (§4.1)

**Description:** Como tenant ou landlord autenticado, quero ver a lista
dos tickets de suporte que eu criei, para que a tela `/support` não
dependa apenas do cache local.

**Acceptance Criteria:**
- [ ] Endpoint `GET /api/support/tickets` com auth JWT (qualquer role)
- [ ] Response: array de `{ id, code, title, description, createdAt, status }`
- [ ] Filtro implícito: `where userId = req.localUser.id`
- [ ] Ordenação: `createdAt DESC`
- [ ] Nenhum ticket de outro usuário vaza (teste com 2 usuários
      distintos)
- [ ] Frontend deixa de dar `DioExceptionType.connectionTimeout` no log
      (validação manual)
- [ ] Typecheck + lint passam

### US-004: `GET /api/conversations` — lista de conversas do usuário (§3.1)

**Description:** Como usuário autenticado, quero ver minhas conversas
na tela `/chat`, para que a listagem não dependa apenas do
`/resolve` 1:1.

**Acceptance Criteria:**
- [ ] Endpoint `GET /api/conversations` com auth JWT
- [ ] Query param opcional `?unreadOnly=true`
- [ ] Response: array com `id, counterpartName, counterpartAvatarUrl,
      lastMessage, lastMessageAt, unread (bool) ou unreadCount (int),
      linkedPropertyId (opcional), linkedTenantId (opcional para
      landlord)`
- [ ] Ordenação: `lastMessageAt DESC`
- [ ] Retorna apenas conversas em que o usuário é participante
- [ ] Frontend deixa de dar timeout no log (§1.1 do GAPS_FINAIS.md)
- [ ] Typecheck + lint passam

### US-005: `GET /api/conversations/:id/messages` — paginação de mensagens (§3.2)

**Description:** Como participante de uma conversa, quero carregar o
histórico de mensagens com paginação reversa, para que a tela de chat
1:1 mostre o thread.

**Acceptance Criteria:**
- [ ] Endpoint `GET /api/conversations/:id/messages` com auth JWT
- [ ] Query params: `?before=<messageId>&limit=50` (default `limit=50`,
      max `100`)
- [ ] Response: array de `{ id, authorId, content, createdAt, readAt }`
      ordenada `createdAt DESC`
- [ ] 403 se `req.localUser.id` não é participante da conversa
- [ ] 404 se a conversa não existe
- [ ] Typecheck + lint passam

### US-006: `POST /api/conversations/:id/messages` — enviar mensagem (§3.2)

**Description:** Como participante de uma conversa, quero enviar uma
mensagem, para que o chat 1:1 funcione de fato.

**Acceptance Criteria:**
- [ ] Endpoint `POST /api/conversations/:id/messages` com auth JWT
- [ ] Body: `{ content: string }` (validação: não vazio, `<= 4000` chars)
- [ ] Response 201 com a mensagem criada
      (`{ id, authorId, content, createdAt, readAt: null }`)
- [ ] Atualiza `Conversation.lastMessageAt` para
      `Message.createdAt` no mesmo transaction
- [ ] 403 se o usuário não é participante
- [ ] Typecheck + lint passam

### US-007: `GET /api/properties/:propertyId/payments?tenantId=` — histórico multi-mês (§2.4)

**Description:** Como landlord, quero ver o histórico completo dos
pagamentos de um inquilino, para a tela "Histórico Financeiro" mostrar
dados reais em vez do fallback sintético de 1 linha.

**Acceptance Criteria:**
- [ ] Endpoint `GET /api/properties/:propertyId/payments?tenantId=:uuid`
- [ ] Auth JWT com ownership check: `property.landlordId = req.localUser.id`
- [ ] Response: array de `{ period: "YYYY-MM", amount, status
      ('PAID'|'AWAITING'|'LATE'), paidAt (null se != PAID) }`
- [ ] Ordenação: `period DESC`
- [ ] Inclui os `RentalPayment` entregues por US-008 + os períodos
      derivados do `Contract.startDate` até o mês vigente
- [ ] 403 se o landlord não é dono do imóvel
- [ ] 404 se o imóvel não existe
- [ ] Typecheck + lint passam

### US-008: `Contract.documentStatus` — status documental do inquilino (§2.5)

**Description:** Como landlord, quero ver um chip verde/laranja/vermelho
real do status documental do inquilino em "Meus Inquilinos", em vez da
heurística atual baseada em `property.status`.

**Acceptance Criteria:**
- [ ] Migration adiciona coluna
      `documentStatus ContractDocumentStatus NOT NULL DEFAULT 'PENDING_DOCUMENTS'`
- [ ] Enum Prisma:
      `enum ContractDocumentStatus { APPROVED AWAITING_SIGNATURE PENDING_DOCUMENTS }`
- [ ] `GET /api/contracts?propertyId=...&tenantId=...` inclui
      `documentStatus` no response
- [ ] `PUT /api/contracts/:id` aceita `documentStatus` no body (apenas
      LANDLORD dono do contrato)
- [ ] Seeds atualizados para refletir status coerente com estado do
      contrato existente
- [ ] Typecheck + lint passam

### US-009: Eco de `title`/`description` no POST `/api/support/tickets` (§4.2)

**Description:** Como frontend dev, quero receber `title` e
`description` de volta no response do POST, para que o cache local não
precise preservar o body do request para montar o ticket.

**Acceptance Criteria:**
- [ ] Response do `POST /api/support/tickets` passa de
      `{ id, code, createdAt }` para
      `{ id, code, title, description, createdAt, status }`
- [ ] Contrato de erros (400, 401) inalterado
- [ ] Nenhum teste existente quebra
- [ ] Typecheck + lint passam

### US-010: `GET /api/landlord/metrics` — métricas da dashboard (§2.1)

**Description:** Como landlord, quero ver os cards "Visitas ao perfil"
e "Propostas" com números reais em vez do traço `—` e tooltip "Métrica
ainda não disponível".

**Acceptance Criteria:**
- [ ] Endpoint `GET /api/landlord/metrics` com auth JWT (LANDLORD)
- [ ] Response: `{ profileViews: int, proposalsPending: int,
      unreadMessages: int }`
- [ ] `profileViews`: contagem de aberturas do perfil público nos
      últimos 30 dias (requer tracking — se inexistente, retornar `0`
      e documentar que falta instrumentação)
- [ ] `proposalsPending`: count de `Proposal` com `status = 'PENDING'`
      dos imóveis do landlord
- [ ] `unreadMessages`: count de `Message.readAt IS NULL` onde
      `Conversation` envolve o landlord (opcional, pode retornar `0`
      se custoso)
- [ ] Typecheck + lint passam

### US-011: `GET /api/properties/:id/analytics` — métricas por imóvel (§2.3)

**Description:** Como landlord, quero ver os cards de topo da tela
"Análise do Imóvel" com dados reais.

**Acceptance Criteria:**
- [ ] Endpoint `GET /api/properties/:id/analytics?window=30d|90d|1y`
      (default `30d`)
- [ ] Auth JWT + ownership check
- [ ] Response:
      `{ views, favorites, proposalsTotal, proposalsOpen,
        visitsScheduled, contactClicks, dailyViews: [{date, count}] }`
- [ ] Campos sem instrumentação (`views`, `contactClicks`,
      `dailyViews`) retornam `0` / `[]` com flag interna — NÃO quebrar
      contrato; documentar em comentário que falta telemetria
- [ ] Typecheck + lint passam

### US-012: `Visit.source` — distinguir MANUAL vs AI (§5.1)

**Description:** Como usuário da Smart Agenda, quero dots visualmente
distintos para visitas MANUAL vs agendadas por IA.

**Acceptance Criteria:**
- [ ] Migration:
      `ALTER TABLE visits ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL'
       CHECK (source IN ('MANUAL', 'AI'))`
- [ ] Enum Prisma `VisitSource { MANUAL AI }`
- [ ] `GET /api/visits*` inclui `source` no response
- [ ] `POST /api/visits` aceita `source`, mas ignora / força `MANUAL`
      quando auth não tem scope `ai-agent` (documentar em comentário;
      scope service-account pode ficar stub se inexistente)
- [ ] Typecheck + lint passam

### US-013: Persistência + `GET /api/notifications` (§7.1)

**Description:** Como usuário, quero ver meu histórico de notificações
de qualquer device (não só cache local do app atual).

**Acceptance Criteria:**
- [ ] Model `Notification { id, userId, title, body, receivedAt, readAt,
      category }`
- [ ] `POST /api/admin/broadcast` passa a persistir uma linha por
      `(userId, broadcastId)` quando o FCM dispara
- [ ] `GET /api/notifications?unreadOnly=true` com auth JWT
- [ ] Response: array ordenada `receivedAt DESC` de
      `{ id, title, body, receivedAt, read (bool), category }`
- [ ] `category` é enum `{ update, announcement, system }` — default
      `announcement`
- [ ] Nenhuma notificação de outro usuário vaza
- [ ] Typecheck + lint passam

### US-014: `PUT /api/notifications/:id/read` — sync cross-device (§7.2)

**Description:** Como usuário, quero que marcar uma notificação como
lida num device reflita nos outros.

**Acceptance Criteria:**
- [ ] Endpoint `PUT /api/notifications/:id/read` com auth JWT
- [ ] Só o dono da notificação pode marcar (`userId = req.localUser.id`)
- [ ] Seta `readAt = now()` se ainda `NULL`; idempotente se já marcado
- [ ] Response: `204 No Content`
- [ ] 403 se o usuário não é dono; 404 se a notificação não existe
- [ ] Typecheck + lint passam

### US-015: Expandir `PropertyType` enum (§6.1)

**Description:** Como usuário, quero selecionar KITNET, PENTHOUSE
(Cobertura), LAND (Terreno) ou COMMERCIAL (Comercial) ao anunciar ou
filtrar, para casar com os 8 chips que a UI oferece.

**Acceptance Criteria:**
- [ ] Enum Prisma `PropertyType` ganha
      `KITNET, PENTHOUSE, LAND, COMMERCIAL`
- [ ] Migration aplicável em banco com dados existentes sem perda
- [ ] Validação de `POST /api/properties` e `PUT /api/properties/:id`
      aceita os novos valores
- [ ] Validação de `GET /api/properties/search` aceita os novos valores
      no filtro `?type=`
- [ ] Seeds atualizados com ao menos 1 imóvel de cada novo tipo
- [ ] Typecheck + lint passam

### US-016: Amenidades (`hasWifi`, `hasPool`) em Property (§6.2)

**Description:** Como usuário, quero filtrar imóveis com WiFi ou
piscina nas telas de busca, e como landlord, quero marcar essas
amenidades no anunciar/editar.

**Acceptance Criteria:**
- [ ] Migration: `Property` ganha `hasWifi BOOLEAN DEFAULT false` e
      `hasPool BOOLEAN DEFAULT false`
- [ ] `POST /api/properties` e `PUT /api/properties/:id` aceitam
      ambos os campos
- [ ] `GET /api/properties/:id` inclui ambos no response
- [ ] `GET /api/properties/search` aceita filtros `?hasWifi=true` e
      `?hasPool=true` (combináveis)
- [ ] Typecheck + lint passam

## 4. Functional Requirements

### Bugs ativos (Alta)

- **FR-1**: Imagens em `/uploads/*` devem responder `200` com
  `Content-Type` correto e CORS permitindo o host do frontend em dev
  (`localhost:5173` ou equivalente do Flutter web).
- **FR-2**: O sistema deve expor `GET /api/support/tickets` filtrado
  por `userId = req.localUser.id`, ordenado `createdAt DESC`.
- **FR-3**: O sistema deve expor `GET /api/conversations` filtrado
  por participação, ordenado `lastMessageAt DESC`, com query opcional
  `?unreadOnly=true`.
- **FR-4**: O sistema deve expor
  `GET /api/conversations/:id/messages` com paginação reversa
  (`?before=<messageId>&limit=50`, default 50, max 100) e
  `POST /api/conversations/:id/messages` com body `{ content }`.

### Funcionalidades já iniciadas (Média)

- **FR-5**: `GET /api/properties/:propertyId/payments?tenantId=` deve
  retornar histórico multi-mês com `{ period, amount, status, paidAt }`,
  ordenado `period DESC`.
- **FR-6**: `Contract` deve ter coluna `documentStatus` enum
  `{ APPROVED, AWAITING_SIGNATURE, PENDING_DOCUMENTS }`, incluída no
  response de `GET /api/contracts` e aceita no `PUT /api/contracts/:id`.
- **FR-7**: `POST /api/support/tickets` deve ecoar `title` e
  `description` no response.

### Melhorias (Baixa)

- **FR-8**: `GET /api/landlord/metrics` retorna
  `{ profileViews, proposalsPending, unreadMessages }` com JWT LANDLORD;
  campos sem instrumentação podem retornar `0`.
- **FR-9**: `GET /api/properties/:id/analytics?window=30d|90d|1y`
  retorna cards + `dailyViews`; ownership check obrigatório; campos
  sem telemetria retornam `0`/`[]`.
- **FR-10**: Tabela `visits` ganha coluna `source`
  (`'MANUAL'|'AI'`) com CHECK constraint e default `'MANUAL'`; incluída
  no response dos endpoints `GET /api/visits*`.
- **FR-11**: Model `Notification` criado; `POST /api/admin/broadcast`
  passa a persistir linha por usuário; `GET /api/notifications` e
  `PUT /api/notifications/:id/read` disponíveis.
- **FR-12**: `PropertyType` enum expandido com `KITNET, PENTHOUSE,
  LAND, COMMERCIAL`; aceitos em POST/PUT e filtro de search.
- **FR-13**: `Property` ganha `hasWifi` e `hasPool` booleanos (default
  `false`), aceitos em POST/PUT e como filtros em search.

### Transversais

- **FR-14**: Todo endpoint novo usa o mesmo padrão JWT de
  `req.localUser` já estabelecido pelo rollout anterior.
- **FR-15**: Ownership check nos endpoints por imóvel (`property.landlordId`),
  por contrato (`contract.landlordId` via property), por ticket
  (`ticket.userId`) e por conversa (`participantId`).

## 5. Non-Goals (Out of Scope)

- **Chat em thread para tickets de suporte** (§1.3, §4.4 do
  GAPS_FINAIS.md) — decisão de produto pendente, movido para §9.
- **`TransactionType` no model Property** (§6.3) — decisão de produto
  pendente, movido para §9.
- **Painel admin de suporte** (§4.3) — é trabalho de frontend; backend
  já entregou os endpoints via US-019/020 do rollout anterior.
- **WebSocket/SSE para push de mensagens em tempo real** (§3.2 nota
  opcional) — polling de 15s no frontend basta; realtime fica para um
  P5 quando o produto pedir.
- **Gráfico mensal da dashboard landlord** (§2.2 `GET
  /api/properties/analytics/monthly`) — UI já foi removida até o
  endpoint existir; não é bug ativo, fica para P5.
- **`User.isIdentityVerified` / `identityVerifiedAt`** (§2.6) — ícone
  já foi removido do frontend; entra num PRD de verificação de
  identidade dedicado.
- **Refatoração dos endpoints já entregues por US-001 a US-020** —
  este PRD só adiciona; não altera contratos existentes.

## 6. Design Considerations

- **Reuso de convenções do rollout P1→P3**:
  - UUID canônico em seeds (US-001 do rollout anterior).
  - Auth via `req.localUser.id` injetado pelo middleware JWT.
  - Responses de erro com `{ error: { code, message } }` já
    padronizados.
- **`Notification.category`**: usar enum Prisma, não string livre —
  casa com o padrão de `PropertyStatus` e `ContractDocumentStatus`.
- **Paginação**: seguir padrão `before`/`limit` reverse-keyset (já
  usado em `GET /api/admin/support/tickets`); evitar offset-based.
- **`/uploads` + CORS**: aplicar `cors()` **antes** de
  `express.static('/uploads', …)` em `src/app.ts:47` se a hipótese 1
  se confirmar na US-001.

## 7. Technical Considerations

- **Migrations**: US-008 (`documentStatus`), US-012 (`Visit.source`),
  US-013 (`Notification` model), US-015 (`PropertyType` enum),
  US-016 (`hasWifi`/`hasPool`) — aplicar em ordem independente; cada
  uma tem seu próprio commit/PR.
- **Seeds**: atualizar após US-008, US-012, US-015 para refletir os
  novos campos e tipos.
- **Integração com frontend**: o frontend já tem fallback/cache local
  para `GET /conversations` e `GET /support/tickets`; o fix do backend
  é o que "liga" a UI — não é preciso mudar o contrato que o frontend
  já espera (ver GAPS_FINAIS.md §3.1 e §4.1 para shapes exatos).
- **Telemetria ausente**: US-010 `profileViews`/`unreadMessages` e
  US-011 `views`/`contactClicks`/`dailyViews` podem retornar `0`/`[]`
  porque falta instrumentação — documentar em comentário no controller
  e abrir issue separada de tracking. Não bloqueia a US.
- **Invalidação de cache**: os endpoints novos são GET com filtros
  por usuário — sem cache server-side. Se for adicionado CDN/cache no
  futuro, a chave deve incluir `userId`.

## 8. Success Metrics

- **Logs limpos**: 0 ocorrências de `DioExceptionType.connectionTimeout`
  em `/api/conversations` e `/api/support/tickets` em 48h de uso real
  após deploy.
- **Imagens**: 100% das fotos de imóveis criados pós-fix carregam no
  frontend (medido por ausência do `errorBuilder` debugPrint).
- **Cobertura do PRD**: 16 user stories commitadas e mergeadas, todas
  com typecheck + lint verdes.
- **Paridade de shape**: 0 mudanças no contrato de response exigidas
  pelo frontend depois do merge (validado por teste manual com o app
  Flutter rodando).
- **Regressões**: 0 quebras nos endpoints entregues por US-001 a
  US-020 do rollout anterior (validado rodando a suíte existente).

## 9. Open Questions

Itens herdados do `GAPS_FINAIS.md` que precisam de decisão de produto
antes de virar trabalho executável:

1. **Chat em thread no ticket de suporte** (§1.3, §4.4): vale
   investir em `POST /admin/support/tickets/:id/replies` +
   `GET /support/tickets/:id/replies`, ou o ticket fica só com
   status + resolution como hoje?
2. **`TransactionType`** (§6.3): expandir o schema com
   `RENTAL|SALE|PRE_LAUNCH` ou remover o filtro cosmético da UI?
3. **Gráfico mensal da landlord** (§2.2): a UI removeu os gráficos de
   "Análise de Performance" até o endpoint existir. Quando voltar,
   vira um item de P5 ou é drop definitivo?
4. **`User.isIdentityVerified`** (§2.6): a feature de verificação de
   identidade vai ser implementada? Se sim, precisa de um PRD próprio
   (fluxo de upload de documento, aprovação admin, etc.) — este campo
   depende desse fluxo existir primeiro.
5. **Telemetria para analytics** (US-010, US-011): quem/quando
   instrumenta `profileViews`, `views`, `contactClicks`, `dailyViews`?
   Sem isso, os cards ficam retornando `0` — é aceitável no curto
   prazo?
6. **Scope `ai-agent`** (US-012): já existe service account com scope
   separado para o agente de IA, ou o backend precisa criar o
   mecanismo antes de `Visit.source='AI'` ter origem real?

## 10. Priorização sugerida (refs §8 do GAPS_FINAIS.md)

| # | US | Prioridade | Motivo |
|---|---|---|---|
| 1 | US-001 + US-002 | Alta | Bug ativo — imagens quebradas |
| 2 | US-003 | Alta | Timeout visível no log |
| 3 | US-004 | Alta | Timeout visível no log |
| 4 | US-005 + US-006 | Alta | Chat 1:1 inútil sem esses endpoints |
| 5 | US-007 | Média | Histórico financeiro com dado real |
| 6 | US-008 | Média | Chip real em "Meus Inquilinos" |
| 7 | US-009 | Média | Limpeza do cliente |
| 8 | US-010 | Baixa | 2 cards da dashboard |
| 9 | US-011 | Baixa | Cards da análise do imóvel |
| 10 | US-012 | Baixa | Smart agenda 100% funcional |
| 11 | US-013 + US-014 | Baixa | Notificações cross-device |
| 12 | US-015 + US-016 | Baixa | Filtros completos na busca |

## Documentos relacionados

- `GAPS_FINAIS.md` — fonte de verdade deste PRD.
- `INTEGRACAO_BACKEND_2026-05-07.md` — log das integrações feitas no
  frontend em resposta ao rollout anterior.
- `progress.txt` (raiz) — delivery log do backend.
- `prd.json` (raiz) — definição do rollout P1→P3 já entregue.
- `tasks/prd-backend-landlord-integration-rollout.md` — PRD do
  rollout anterior.
- `tasks/prd-landlord-backend-closeout.md` — fechamento do rollout.
