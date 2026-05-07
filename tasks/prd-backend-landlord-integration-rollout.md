# PRD: Backend Landlord Integration Rollout (P1 → P3)

## 1. Introdução / Overview

O frontend Flutter do I-Moveis entregou — nas últimas sprints — fluxos completos
do landlord (criação/edição de imóvel, dossier de inquilino, chat, contratos,
suporte) que hoje dependem de endpoints e campos ausentes ou inconsistentes no
backend. O documento `BACKEND_HANDOFF.md` (datado 2026-05-07) consolida 10 gaps
com severidade classificada; este PRD cobre **Prioridades 1 a 3 + endpoints de
suporte (incluindo painel admin)** — o suficiente para destravar o MVP do
landlord ponta-a-ponta.

O problema a resolver é simples: a UI já está plumbed, mas o backend está
retornando 400/404, omitindo campos, ou silenciosamente ignorando payloads
multipart. Sem este rollout o landlord não consegue editar fotos do imóvel,
marcar pagamento como pago, conversar com inquilino pela plataforma, ou
concluir um ciclo de contrato digital.

## 2. Goals

- Destravar edição de imóvel com fotos (adicionar + remover) via `PUT` multipart.
- Garantir que `property.status` seja lido e gravado de ponta a ponta.
- Eliminar o `400 VALIDATION_ERROR: Invalid uuid` padronizando seeds em UUID canônico.
- Expor `currentTenant` no Property e sincronizar `Property.status` com o ciclo de vida do `RentalProcess`.
- Persistir status mensal de pagamento do aluguel (PAID / AWAITING / LATE).
- Resolver conversas 1:1 landlord-inquilino com id canônico (não sintético).
- Entregar ciclo completo de contrato digital: consulta, download do PDF e upload do PDF assinado.
- Encerrar o 404 em `POST /api/support/tickets` e entregar endpoints admin para triagem.
- Cada endpoint novo/modificado acompanhado de testes de integração, atualização de Swagger/OpenAPI e migrations Prisma versionadas.

## 3. User Stories

### US-001: Padronizar seeds para UUID canônico
**Description:** Como backend engineer, preciso que todos os IDs gerados nos
scripts de seed sejam UUID v4 canônicos, para que as validações `z.string().uuid()`
em filtros de `GET /api/properties/search?landlordId=...` parem de rejeitar a
própria ID que o backend devolve no login.

**Acceptance Criteria:**
- [ ] Todos os `id` de `User`, `Property`, `RentalProcess`, `Visit` nos scripts de seed usam `crypto.randomUUID()` (não mais literais `user-demo-landlord-1`)
- [ ] Seed re-executado do zero produz banco consistente sem conflitos
- [ ] Teste de integração: login demo → recupera `id` → `GET /api/properties/search?landlordId=<id>` retorna 200 (não mais 400)
- [ ] Typecheck + lint passam
- [ ] Migration não é necessária (apenas scripts de seed), mas `prisma migrate reset && prisma db seed` deve rodar sem erro

### US-002: Devolver `status` em responses de Property
**Description:** Como landlord, quero que o status do imóvel (AVAILABLE / NEGOTIATING / RENTED)
persista visualmente entre refetches, para não precisar refazer a alteração
toda vez que recarrego a lista.

**Acceptance Criteria:**
- [ ] `GET /api/properties/search` inclui `status` em cada item do array
- [ ] `GET /api/properties/:id` inclui `status` no body
- [ ] Enum `PropertyStatus` (`AVAILABLE | NEGOTIATING | RENTED`) existe no schema Prisma com default `AVAILABLE`
- [ ] Migration Prisma gerada e aplicável sem data loss nos registros existentes
- [ ] Teste de integração: criar property → `PUT` com `status: 'NEGOTIATING'` → `GET` devolve `status: 'NEGOTIATING'`
- [ ] Swagger/OpenAPI atualizado expondo o campo `status` no schema de Property
- [ ] Typecheck + lint passam

### US-003: `PUT /api/properties/:id` aceita multipart/form-data com `photos[]`
**Description:** Como landlord, quero adicionar novas fotos ao editar um imóvel
existente, reusando a mesma infraestrutura do POST.

**Acceptance Criteria:**
- [ ] Rota `PUT /api/properties/:id` aceita `Content-Type: multipart/form-data` E continua aceitando `application/json`
- [ ] Handler reusa `propertyPhotoUploadHandler` já implementado no POST (sem duplicar código)
- [ ] Primeira foto nova vira capa automática apenas se o imóvel não tiver capa anterior (não sobrescrever silenciosamente)
- [ ] Quando `Content-Type` é JSON puro, comportamento atual preservado (apenas campos escalares)
- [ ] Apenas landlord dono do imóvel pode fazer upload (403 caso contrário)
- [ ] Teste de integração: upload de 2 fotos via multipart em imóvel existente → `GET` devolve 2 novas URLs persistidas
- [ ] Teste de integração: upload por usuário não-dono retorna 403
- [ ] Swagger/OpenAPI documenta ambos os content-types no `PUT`
- [ ] Typecheck + lint passam

### US-004: `PUT /api/properties/:id` aceita `photosToRemove[]` para deletar fotos
**Description:** Como landlord, quero remover fotos específicas ao editar um
imóvel, informando as URLs a excluir no mesmo request multipart que sobe fotos novas.

**Acceptance Criteria:**
- [ ] Campo multipart repetido `photosToRemove` (cada valor é uma URL completa) é parseado como array
- [ ] Cada URL é validada: precisa pertencer ao próprio imóvel (400 caso contrário — não vaza existência de foto de outro imóvel)
- [ ] Deleção acontece em transação: remove do storage E do registro de fotos do Property; falha de storage não deve deixar registro órfão
- [ ] Se a foto removida era a capa, próxima foto restante (mais antiga) vira capa automaticamente
- [ ] Request combinado (novas fotos + photosToRemove[]) processa remoções antes de adições
- [ ] Teste de integração: subir 3 fotos → `PUT` com `photosToRemove[]=<url1>` → `GET` devolve 2 fotos, sem a removida
- [ ] Teste de integração: tentar remover foto de outro imóvel retorna 400
- [ ] Swagger/OpenAPI documenta o campo `photosToRemove[]`
- [ ] Typecheck + lint passam

### US-005: Property expõe `currentTenant` quando há `RentalProcess` ativo
**Description:** Como landlord visualizando o dossier, quero ver o nome do
inquilino atual e ter o botão CHAT funcional, sem chamar endpoint extra.

**Acceptance Criteria:**
- [ ] `GET /api/properties/:id` retorna `currentTenant: { id, name } | null` quando existe `RentalProcess` com `status='ACTIVE'` para aquele imóvel
- [ ] `GET /api/properties/search` retorna o mesmo campo em cada item (ou vazio se suporte a `?expand=tenant` for a escolha — decisão documentada no PR)
- [ ] Performance: query não faz N+1; usar `include` do Prisma ou join explícito
- [ ] Teste de integração: property sem RentalProcess ativo → `currentTenant: null`; property com ACTIVE → `currentTenant: { id, name }`
- [ ] Swagger/OpenAPI atualizado expondo `currentTenant` como nullable object
- [ ] Typecheck + lint passam

### US-006: Auto-transição `Property.status` no ciclo de vida do `RentalProcess`
**Description:** Como sistema, devo manter o status do imóvel coerente com
contratos ativos sem depender do landlord atualizar manualmente, evitando o
estado inconsistente (contrato ativo + imóvel marcado AVAILABLE).

**Acceptance Criteria:**
- [ ] Quando `RentalProcess.status` transita para `ACTIVE`, `Property.status` vira `RENTED` na **mesma transação**
- [ ] Quando `RentalProcess` é encerrado (qualquer terminal state: prazo, distrato, rescisão), `Property.status` volta a `AVAILABLE` na **mesma transação**
- [ ] Se já existir outro `RentalProcess` ACTIVE para o mesmo imóvel (caso patológico), transação falha com erro claro (não corrompe o estado)
- [ ] Teste de integração: ativar RentalProcess → `GET /properties/:id` devolve `status: 'RENTED'`; encerrar → devolve `status: 'AVAILABLE'`
- [ ] Teste de integração: rollback da ativação reverte o status do imóvel
- [ ] Documentado no Swagger que `status` pode ser alterado automaticamente pelo ciclo de RentalProcess
- [ ] Typecheck + lint passam

### US-007: `GET /api/properties/:id/payments/current` — consulta do pagamento do mês
**Description:** Como landlord, quero consultar o status do pagamento do mês
corrente (PAID / AWAITING / LATE) para o imóvel alugado.

**Acceptance Criteria:**
- [ ] Rota protegida por JWT; apenas landlord dono do imóvel tem acesso (403 caso contrário)
- [ ] Response: `{ period: "YYYY-MM", status: "AWAITING" | "PAID" | "LATE", updatedAt: ISO8601, updatedBy: uuid }`
- [ ] Se nenhum registro existe para o período, retornar objeto com `status: 'AWAITING'` e `updatedAt/updatedBy` nulos (não 404)
- [ ] Model Prisma `RentalPayment` criado com campos: `id`, `propertyId`, `period` (YYYY-MM), `status`, `updatedAt`, `updatedBy`. Unique constraint (`propertyId`, `period`)
- [ ] Migration Prisma gerada e aplicável
- [ ] Teste de integração: sem registro → devolve AWAITING default; com registro → devolve valor gravado
- [ ] Swagger/OpenAPI documenta endpoint e schema de response
- [ ] Typecheck + lint passam

### US-008: `PUT /api/properties/:id/payments/current` — atualizar status do pagamento
**Description:** Como landlord, quero marcar o pagamento do mês como PAID /
AWAITING / LATE e que persista entre sessões.

**Acceptance Criteria:**
- [ ] Rota protegida por JWT; apenas landlord dono do imóvel (403 caso contrário)
- [ ] Body: `{ status: "PAID" | "AWAITING" | "LATE" }`; validação via Zod
- [ ] Upsert no registro (`propertyId`, `period` atual); grava `updatedBy` a partir do JWT e `updatedAt` server-side
- [ ] Response: objeto completo atualizado (mesmo shape do GET)
- [ ] Não permitir gravação de `period` arbitrário — sempre o mês corrente do servidor (evita edições retroativas via API)
- [ ] Teste de integração: `PUT` com PAID → `GET` devolve PAID com `updatedBy` correto
- [ ] Teste de integração: `PUT` com status inválido → 400
- [ ] Swagger/OpenAPI documenta endpoint, body schema e response
- [ ] Typecheck + lint passam

### US-009: `GET /api/conversations/resolve` — resolver ou criar conversa 1:1
**Description:** Como landlord clicando em CHAT no dossier, quero ser navegado
para uma conversa real (não um id sintético) criando uma se não existir.

**Acceptance Criteria:**
- [ ] Rota: `GET /api/conversations/resolve?propertyId=<uuid>&tenantId=<uuid>`
- [ ] Protegida por JWT; caller precisa ser o landlord dono do imóvel OU o tenant especificado
- [ ] Se conversa já existe para aquele (propertyId, landlordId, tenantId), retorna o objeto existente
- [ ] Se não existe, cria atomicamente e retorna o novo objeto — sem janela de corrida (unique constraint ou transação serializável)
- [ ] Response: `{ id, propertyId, landlordId, tenantId, messages: [] (vazio ao criar), createdAt }`
- [ ] Model Prisma `Conversation` com unique constraint `(propertyId, landlordId, tenantId)`
- [ ] Migration Prisma gerada e aplicável
- [ ] Teste de integração: primeira chamada cria; segunda chamada retorna mesmo id
- [ ] Teste de integração: caller que não é dono nem tenant recebe 403
- [ ] Swagger/OpenAPI documenta endpoint e schema
- [ ] Typecheck + lint passam

### US-010: `GET /api/contracts?propertyId=...&tenantId=...` — consulta de contrato
**Description:** Como landlord ou tenant, quero consultar o contrato vigente
entre um imóvel e um inquilino (datas, valor, URL do PDF).

**Acceptance Criteria:**
- [ ] Rota protegida por JWT; caller precisa ser landlord dono OU tenant do contrato (403 caso contrário)
- [ ] Response: `{ id, propertyId, tenantId, startDate, endDate, monthlyValue, pdfUrl, signedAt }`
- [ ] Model Prisma `Contract` criado com campos acima + `createdAt`, `updatedAt`
- [ ] Migration Prisma gerada e aplicável (pode já estar coberta pelo RentalProcess existente — avaliar reuso antes de criar tabela nova)
- [ ] Teste de integração: sem contrato → 404; com contrato → 200 + todos campos
- [ ] Swagger/OpenAPI documenta endpoint e schema
- [ ] Typecheck + lint passam

### US-011: `GET /api/contracts/:id/pdf` — download do PDF
**Description:** Como landlord ou tenant, quero baixar o PDF do contrato.

**Acceptance Criteria:**
- [ ] Rota protegida por JWT; apenas partes do contrato (403 caso contrário)
- [ ] Retorna **302 redirect** para URL pré-assinada do storage OU **200 com `Content-Type: application/pdf`** (decisão documentada no PR)
- [ ] Se contrato sem `pdfUrl`, retorna 404 com mensagem clara
- [ ] Teste de integração: GET devolve PDF válido (magic bytes `%PDF-` nos primeiros 4 bytes)
- [ ] Swagger/OpenAPI documenta endpoint e content-type de response
- [ ] Typecheck + lint passam

### US-012: `PUT /api/contracts/:id/signed-document` — upload do PDF assinado
**Description:** Como landlord, quero subir o PDF assinado do contrato para
finalizar o fluxo digital.

**Acceptance Criteria:**
- [ ] Rota multipart: campo `signedPdf` (single file, PDF)
- [ ] Protegida por JWT; apenas landlord dono (403 caso contrário)
- [ ] Validação: aceita apenas `application/pdf` com magic bytes verificados (não só Content-Type)
- [ ] Limite de tamanho: mesmo limite usado em `propertyPhotoUploadHandler` ou configurável via env; documentar no Swagger
- [ ] Arquivo armazenado via mesma infra de storage já usada para fotos; URL persistida em `Contract.pdfUrl`
- [ ] Grava `signedAt = now()` e `updatedAt` server-side
- [ ] Response: `{ signedAt, pdfUrl }`
- [ ] Teste de integração: upload válido → contrato fica com `signedAt` e `pdfUrl` acessível via GET
- [ ] Teste de integração: upload com magic bytes errados → 400
- [ ] Swagger/OpenAPI documenta endpoint, multipart schema e limites
- [ ] Typecheck + lint passam

### US-013: `POST /api/support/tickets` — abertura de chamado
**Description:** Como landlord ou tenant, quero abrir um chamado de suporte
pelo app e receber um código de protocolo.

**Acceptance Criteria:**
- [ ] Rota protegida por JWT (qualquer role autenticada)
- [ ] Body: `{ title: string, description: string }`; validação Zod com `title` ≤ 120 chars e `description` ≤ 4000 chars
- [ ] Server-side anexa a partir do JWT: `userId`, `userName`, `userRole` (TENANT/LANDLORD/ADMIN), `createdAt`
- [ ] Gera `code` determinístico no formato `SUP-AAMMDD-XXXX` (data atual + 4 chars base36 random) — mesmo formato do fallback local do frontend
- [ ] Response 201: `{ id, code, createdAt }`
- [ ] Model Prisma `SupportTicket` com campos: `id`, `code` (unique), `title`, `description`, `userId`, `userName`, `userRole`, `status` (default `OPEN`), `resolution?`, `assignedToId?`, `createdAt`, `updatedAt`
- [ ] Migration Prisma gerada e aplicável
- [ ] E-mail de confirmação enviado para `user.email` — integrar com infra de e-mail existente ou stub com feature flag se ainda não existir (documentar no PR)
- [ ] Teste de integração: POST devolve 201 com `code` no formato correto; `GET` admin lista o ticket
- [ ] Swagger/OpenAPI documenta endpoint e schema
- [ ] Typecheck + lint passam

### US-014: `GET /api/admin/support/tickets` — listagem admin
**Description:** Como admin, quero listar e filtrar tickets para triagem e
atribuição.

**Acceptance Criteria:**
- [ ] Rota protegida por JWT + role `ADMIN` (403 para qualquer outra role)
- [ ] Query params opcionais: `status` (OPEN/RESOLVED), `role` (TENANT/LANDLORD), `from` (ISO date), `to` (ISO date)
- [ ] Response: array de `{ id, code, title, description, user: { id, name, email, role }, status, createdAt, updatedAt, assignedTo?: { id, name }, resolution? }`
- [ ] Paginação: query params `page` (default 1) e `pageSize` (default 50, max 200); response envelopada `{ data, page, pageSize, total }`
- [ ] Ordenação padrão: `createdAt DESC`
- [ ] Teste de integração: admin lista todos; não-admin recebe 403; filtros combinados retornam subset correto
- [ ] Swagger/OpenAPI documenta endpoint, query params e schema de response (incluindo envelope de paginação)
- [ ] Typecheck + lint passam

### US-015: `PUT /api/admin/support/tickets/:id` — atualização admin
**Description:** Como admin, quero atualizar status, resolução e responsável
do ticket ao responder.

**Acceptance Criteria:**
- [ ] Rota protegida por JWT + role `ADMIN`
- [ ] Body: `{ status?: "OPEN" | "RESOLVED", resolution?: string, assignedToId?: uuid }`; pelo menos um campo obrigatório
- [ ] Quando `status` transita para `RESOLVED`, `resolution` torna-se obrigatório (400 se ausente)
- [ ] Quando `status` é alterado, envia e-mail ao `user.email` do ticket — mesma infra do US-013
- [ ] Response: objeto completo atualizado (mesmo shape do item no GET)
- [ ] Teste de integração: admin resolve ticket → `GET` devolve status RESOLVED com resolution; non-admin recebe 403
- [ ] Teste de integração: `assignedToId` de usuário inexistente → 400
- [ ] Swagger/OpenAPI documenta endpoint, body e response
- [ ] Typecheck + lint passam

## 4. Functional Requirements

- FR-1: Seeds de `User` usam `crypto.randomUUID()` para `id`.
- FR-2: Schema Prisma define enum `PropertyStatus` com default `AVAILABLE`.
- FR-3: `GET /api/properties/search` e `GET /api/properties/:id` incluem `status` e `currentTenant` no response.
- FR-4: `PUT /api/properties/:id` suporta tanto `application/json` quanto `multipart/form-data`; no segundo caso, aceita `photos[]` e `photosToRemove[]`.
- FR-5: Alteração de `RentalProcess.status` para/desde `ACTIVE` atualiza `Property.status` na mesma transação de banco.
- FR-6: Model `RentalPayment` com unique `(propertyId, period)`; endpoints `GET|PUT /api/properties/:id/payments/current` operam sobre o mês corrente do servidor.
- FR-7: Model `Conversation` com unique `(propertyId, landlordId, tenantId)`; `GET /api/conversations/resolve` usa create-or-get atômico.
- FR-8: Endpoints de contrato (`GET /api/contracts`, `GET /api/contracts/:id/pdf`, `PUT /api/contracts/:id/signed-document`) autenticam e autorizam apenas as partes envolvidas.
- FR-9: `POST /api/support/tickets` gera `code` no formato `SUP-AAMMDD-XXXX` (data + base36 random de 4 chars).
- FR-10: Endpoints admin (`GET /api/admin/support/tickets`, `PUT /api/admin/support/tickets/:id`) requerem role `ADMIN`; qualquer outra role recebe 403.
- FR-11: Toda migration de schema gerada por `prisma migrate dev` é committada em `prisma/migrations/`.
- FR-12: Todo endpoint novo/modificado tem entrada correspondente no Swagger/OpenAPI (`src/docs/openapi.*` — seguir padrão do US-009 já commitado na branch atual).
- FR-13: Todo endpoint novo/modificado tem teste de integração cobrindo golden path + principais erros (400 validação, 401 sem JWT, 403 autorização, 404 not found).

## 5. Non-Goals (Out of Scope)

- **Visit.source (item 8 do handoff)** — fica para um PRD separado sobre smart agenda / agente de IA.
- **Paridade de filtros de Property (item 9)** — KITNET/PENTHOUSE/LAND/COMMERCIAL, `hasWifi`, `hasPool`, `transactionType` — melhoria cosmética, sem blocker.
- **Endpoint de analytics real por imóvel (item 10 do handoff)** — métricas mockadas funcionam na UI atual.
- **Painel admin em si (UI)** — este PRD entrega apenas os endpoints; a tela admin virá depois.
- **Refatoração ampla do sistema de storage de arquivos** — reusar a infra atual de `propertyPhotoUploadHandler`; não reescrever.
- **Notificações push** para atualização de ticket ou mudança de status — escopo futuro; apenas e-mail neste rollout.
- **Permitir edição retroativa de `RentalPayment`** — apenas o mês corrente é mutável via API neste rollout.
- **Migrar dados de produção**: este PRD assume que o banco não tem dados críticos que quebrariam com as migrations (ambiente pré-MVP); caso contrário, script de backfill entra como PR separado.

## 6. Design Considerations

- Reusar componentes existentes: `propertyPhotoUploadHandler`, error handler global (US-008 do fix/upload_photos_comatibility), middleware JWT, validação Zod.
- Manter consistência com padrão de rotas atual (`/api/*`), serialização (camelCase), e formato de erros (`VALIDATION_ERROR`, `FORBIDDEN`, etc.).
- Para decisão de 302 vs. 200 no download do PDF: preferir 302 + URL pré-assinada se a infra de storage suportar (melhor performance, não consome banda do app server); documentar a escolha no PR.
- Logging: cada endpoint novo deve logar em nível `info` os casos de sucesso e `warn`/`error` para falhas, seguindo o padrão de logger já usado.

## 7. Technical Considerations

- **Transações**: US-006 (auto-transição) e US-009 (conversation resolver) exigem transações; usar `prisma.$transaction`.
- **Corridas**: US-009 e US-013 podem ter requests concorrentes. Unique constraints + `upsert` cobrem o caso; documentar nos testes que o comportamento é idempotente.
- **Storage**: US-004 (remoção de fotos) precisa decidir se a remoção do storage acontece dentro da transação de banco (arriscado — storage não é transacional) ou após commit (padrão outbox). Recomendação: commit primeiro, deleção de storage em seguida; falha de storage loga warning mas não reverte o request. Documentar no PR.
- **Retrocompatibilidade**: US-003 (`PUT` multipart) NÃO pode quebrar callers que hoje mandam JSON puro. Testes de regressão obrigatórios.
- **Seeds UUID (US-001)**: verificar referências cruzadas em fixtures/tests que possam estar hardcoded em `user-demo-landlord-1`. `grep -r 'user-demo-' src/ tests/` antes de commitar.
- **E-mail**: se a infra não existir, stub com feature flag `SUPPORT_EMAIL_ENABLED` (default `false`) + log do envelope. PR separado pode plugar SMTP real.
- **Performance**: `currentTenant` no `GET /search` não pode fazer N+1 — validar com query log do Prisma em teste.

## 8. Success Metrics

- `POST /api/support/tickets` deixa de retornar 404 — ticket aberto pelo frontend mostra `code` real, não fallback local.
- Upload de fotos em edit de imóvel persiste após refresh — hoje não persiste.
- `GET /api/properties/search?landlordId=<id-do-login-demo>` deixa de retornar 400 após seed fix.
- Status de pagamento e status do imóvel persistem entre refetches — hoje voltam ao default.
- Botão CHAT do dossier navega para conversa com id canônico — hoje abre com id sintético.
- Zero regressão nos endpoints atualmente verdes (US-009 multipart no POST, `PUT` JSON, `GET /api/users/me`).
- Todos os testes de integração novos passam no CI sem flakiness em 3 runs consecutivos.
- Swagger gerado valida sem erros (`openapi:validate` ou equivalente).

## 9. Open Questions

- **Contract vs. RentalProcess**: há sobreposição conceitual. O model `Contract` (US-010) é novo ou é uma view/extensão de `RentalProcess`? Decidir antes da fase de discuss.
- **PDF download**: 302 (pré-assinada) ou 200 (stream)? Depende da infra de storage atual.
- **E-mail**: usar qual provider? (SMTP direto, SendGrid, SES?). Se ainda não definido, o stub com feature flag resolve para este rollout.
- **Scope de `currentTenant`**: incluir `email` ou só `{ id, name }`? Privacy vs. conveniência — alinhar com produto.
- **Limites de payload**: PDF assinado (US-012) tem qual tamanho máximo razoável? Hoje fotos usam X MB — reusar mesmo limite ou diferente?
- **Paginação do admin (US-014)**: `pageSize` máx 200 é apropriado ou exagero para o volume esperado?
- **Ordem de rollout**: executar US-001 (seeds) PRIMEIRO (maior destravamento com menor blast radius) é recomendado — confirmar na fase de planning.
