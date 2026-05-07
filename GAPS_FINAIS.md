# Gaps Finais de Backend — i-Móveis

Snapshot **consolidado** em `2026-05-07` após cruzar `prd.json` e
`progress.txt`. Este documento substitui:

- ❌ `BACKEND_HANDOFF.md` (obsoleto — tratava tudo como pendente)
- ❌ `BACKEND_LANDLORD_GAPS.md` (obsoleto — itens 1-7 foram entregues)
- ❌ `BACKEND_VISIT_SOURCE.md` (obsoleto — detalhado na §5 abaixo)
- ❌ `BACKEND_PENDENCIAS_LANDLORD.md` (versão anterior, agora substituída)

Mantém relevante:
- ✅ `INTEGRACAO_BACKEND_2026-05-07.md` — changelog das integrações feitas.
- ✅ `progress.txt` — fonte de verdade do que o backend entregou.
- ✅ `prd.json` — definições das US-###.

---

## 📣 Status do PRD vigente

`prd.json` é o rollout **"Backend Landlord Integration Rollout (P1→P3)"**
— 20 user stories (US-001 até US-020). **Todas as 20 estão
`"passes": true` e confirmadas no `progress.txt`.** O escopo original
foi entregue 100%.

| US range | Entregue | Tópico |
|---|---|---|
| US-001 | ✅ | Seeds com UUID canônico |
| US-002 → US-005 | ✅ | PropertyStatus enum + GET/PUT + currentTenant + auto-transition |
| US-006 → US-007 | ✅ | PUT multipart com photos[] + photosToRemove[] |
| US-008 → US-010 | ✅ | RentalPayment model + GET/PUT payments/current |
| US-011 → US-012 | ✅ | Conversation model + GET /conversations/resolve |
| US-013 → US-016 | ✅ | Contract model extendido + GET/PUT contratos + PDFs |
| US-017 → US-020 | ✅ | SupportTicket model + POST/GET/PUT admin |

**Conclusão**: os gaps listados abaixo são **novo escopo**, não itens
do PRD atual em atraso. Precisam entrar num próximo PRD (ex:
"Backend P4 — Completar telas restantes") antes de virar trabalho
executável do time de backend.

**Bugs ativos nos logs do frontend** (§1) são o único subconjunto
que **já deveria ter fallback ou endpoint cobrindo**: as telas chamam
endpoints que simplesmente não existem, e o timeout é a evidência.
Esses sobem de prioridade pra P4.

---

## Índice

1. [Bugs ativos confirmados nos logs](#1-bugs-ativos-confirmados-nos-logs)
2. [Endpoints pendentes — telas do landlord](#2-endpoints-pendentes--telas-do-landlord)
3. [Endpoints pendentes — telas do tenant](#3-endpoints-pendentes--telas-do-tenant)
4. [Endpoints pendentes — suporte](#4-endpoints-pendentes--suporte)
5. [Endpoints pendentes — visitas / agenda](#5-endpoints-pendentes--visitas--agenda)
6. [Endpoints pendentes — filtros e schema](#6-endpoints-pendentes--filtros-e-schema)
7. [Endpoints pendentes — notificações](#7-endpoints-pendentes--notificações)
8. [Priorização para o próximo sprint](#8-priorização-para-o-próximo-sprint)

---

## 1. Bugs ativos confirmados nos logs

### 1.1 Timeout em `GET /api/conversations` — ⚠️ ENDPOINT NÃO EXISTE

**Sintoma no log**:
```
X --- http://localhost:3000/api/conversations → DioExceptionType.connectionTimeout
[chat] GET /conversations falhou (---): null
```

**Causa**: o `progress.txt` confirma que US-012 entregou apenas
`GET /api/conversations/resolve` (resolver 1:1). A listagem completa
(`GET /api/conversations`) **nunca foi implementada**. O timeout sai
porque a request fica aberta sem nenhum handler respondendo.

**Fix no backend**: implementar o endpoint (ver §3.2 abaixo).

**Paliativo no frontend**: já cuidado — o repo devolve lista vazia no
timeout e a UI mostra estado vazio.

### 1.2 Timeout em `GET /api/support/tickets` — ⚠️ ENDPOINT NÃO EXISTE

**Sintoma no log**:
```
X --- http://localhost:3000/api/support/tickets → DioExceptionType.connectionTimeout
[support] GET /support/tickets falhou (---): null — caindo no cache local
→ POST http://localhost:3000/api/support/tickets
← 201 http://localhost:3000/api/support/tickets
```

**Causa**: `progress.txt` confirma que US-018 entregou só
`POST /api/support/tickets`. US-019 entregou
`GET /api/admin/support/tickets` (restrito a ADMIN). **Não existe
endpoint para o usuário (tenant/landlord) listar os próprios
chamados**. Por isso a GET dá timeout.

**Fix no backend**: implementar `GET /api/support/tickets` (ver §4.1).

**Paliativo no frontend**: já cuidado — o repo cai no cache local,
a UI continua funcional. POST está OK (201).

### 1.3 Chat de suporte é USER → ADMIN, não user-to-user

**Clarificação importante**: o "chat de suporte" que abre pelo perfil
(ticket de denúncia/dúvida) é **unidirecional de usuário para admin**.
NÃO é o chat comercial (tenant ↔ landlord) — esse é outra feature
(`/chat/:conversationId` + US-011/012).

**Gap relacionado**: hoje o frontend do admin NÃO existe ainda (está
no backlog de frontend). E o backend não tem endpoint para **responder
um ticket com uma mensagem** — só `PUT /admin/support/tickets/:id`
(US-020) para mudar status/resolution. Para conversa em threads seria
necessário:

```
POST /api/admin/support/tickets/:id/replies
  Auth: JWT (ADMIN)
  Body: { message: string }

GET /api/support/tickets/:id/replies
  Auth: JWT (dono do ticket OU ADMIN)
  → Array de { id, authorRole, message, createdAt }
```

Decisão aberta: vale a pena investir em conversa em thread, ou o
ticket é só "status + resolution" e ponto? Alinhamento de produto
necessário antes de pedir endpoint novo.

### 1.4 Imagens dos imóveis ainda não carregam

**Sintoma reportado**: placeholder de casa aparece no lugar das fotos,
tanto na tela de gestão de aluguéis quanto nos detalhes do imóvel.

**Investigação até agora**:
- O backend armazena `PropertyImage.url` como path relativo
  (`/uploads/<propertyId>/<file>.jpg`) — confirmado em `progress.txt:31`.
- O servidor monta `express.static('/uploads', ...)` na ROOT
  (`src/app.ts:47`), então a URL correta é
  `http://localhost:3000/uploads/<path>`.
- O frontend tem helper `absoluteImageUrl(raw)` em `core/constants.dart`
  que prepend `http://localhost:3000` quando o path começa com `/`.
- O parser `_parseImages` em `property_api_model.dart` hidrata todas as
  URLs com esse helper + `_normalizeLocalHost` (converte `10.0.2.2` →
  `localhost`).

**Hipóteses abertas para investigar**:

1. **CORS no `/uploads/*`**: o express-static **não** roda por dentro
   do `cors()` middleware em muitos setups. Se o backend está em
   `http://localhost:3000` e o Flutter web em outro host (ex: `localhost:5173`),
   a request bate em CORS e falha. Solução: aplicar `cors()` **antes** do
   `express.static('/uploads')` em `src/app.ts`.

2. **Pasta `/uploads` vazia**: os imóveis atuais podem ter sido criados
   ANTES da US-006 (upload multipart), antes do save-to-disk estar
   funcional. A DB tem uma URL relativa, mas o arquivo físico não
   existe → 404. Confirmar rodando `ls <repo-backend>/uploads/` ou
   abrindo `http://localhost:3000/uploads/<propertyId>/<file>` direto
   no navegador.

3. **Content-Type errado**: se o arquivo está lá mas o express.static
   não manda `Content-Type: image/jpeg` (ou equivalente), o browser
   pode recusar a exibição. Checar abrindo a URL no browser dev tools.

**Ação necessária no backend**:
- Verificar que o arquivo físico **existe** em
  `<backend-repo>/uploads/<propertyId>/<file>.jpg` para ao menos um
  imóvel que o usuário criou.
- Confirmar que `cors()` está aplicado ao `/uploads` (ou o route é
  público sem CORS estrito).

**Ação já feita no frontend**:
- Adicionei `debugPrint` no `errorBuilder` do `_CoverHeader`
  (property_management_dossier_page) e do `PropertyHeader`
  (property detail page). Ao rodar o app com o console aberto, a
  primeira request falhada vai mostrar **exatamente qual URL está
  sendo tentada** — aí dá pra bater com a URL real do backend.

---

## 2. Endpoints pendentes — telas do landlord

### 2.1 `GET /api/landlord/metrics` — métricas da dashboard

**Usado por**: Dashboard (cards "Visitas ao perfil" e "Propostas" que
hoje mostram `—` com tooltip "Métrica ainda não disponível").

```
GET /api/landlord/metrics
  Auth: JWT (LANDLORD)
  → {
      "profileViews":     1240,   // perfil público aberto nos últimos 30d
      "proposalsPending": 12,     // proposals com status PENDING
      "unreadMessages":   3       // opcional
    }
```

### 2.2 `GET /api/properties/analytics/monthly` — gráficos mensais

**Usado por**: Dashboard (gráficos "Análise de Performance" — já
removidos da UI até endpoint existir).

```
GET /api/properties/analytics/monthly?from=YYYY-MM-01&to=YYYY-MM-01
  Auth: JWT (LANDLORD)
  → {
      "months":         ["2025-12", ..., "2026-05"],
      "rentals":        [2, 3, 5, 4, 6, 8],
      "newTenants":     [1, 2, 4, 3, 5, 7],
      "monthlyRevenue": [4500, 8200, 7800, 12400, 15600, 18900]
    }
```

### 2.3 `GET /api/properties/:id/analytics` — métricas por imóvel

**Usado por**: Tela de Análise do Imóvel (cards de topo — hoje mostram
`—`).

```
GET /api/properties/:id/analytics?window=30d|90d|1y
  Auth: JWT (LANDLORD dono do imóvel)
  → {
      "views":          142,
      "favorites":      23,
      "proposalsTotal": 8,
      "proposalsOpen":  3,
      "visitsScheduled":12,
      "contactClicks":  34,
      "dailyViews":     [{"date": "...", "count": N}, ...]
    }
```

### 2.4 `GET /properties/:id/payments?tenantId=` — histórico multi-mês

**Usado por**: Tela "Histórico Financeiro" do inquilino.

**Status atual**: US-009/010 entregou só `/payments/current`
(single-month). O frontend faz fallback sintetizando 1 linha a partir
do `/current` + `Contract.monthlyRent`.

```
GET /api/properties/:propertyId/payments?tenantId=:uuid
  Auth: JWT (LANDLORD dono do imóvel)
  → Array de {
      "period":  "2026-04",     // YYYY-MM
      "amount":  2500,
      "status":  "PAID" | "AWAITING" | "LATE",
      "paidAt":  "2026-04-05T12:00:00.000Z"  // null quando != PAID
    }
```

### 2.5 `Contract.documentStatus` — status documental do inquilino

**Usado por**: Tela "Meus Inquilinos" (chip verde/laranja/vermelho ao
lado do nome).

**Hoje**: heurística derivada de `property.status` (imperfeita — mistura
status de imóvel com status do contrato).

**Fix sugerido** (Opção A — recomendada, casa com US-014):

```diff
  GET /api/contracts?propertyId=...&tenantId=...
  → {
      id, startDate, endDate, monthlyRent, pdfUrl, signedAt,
+     documentStatus: 'APPROVED' | 'AWAITING_SIGNATURE' | 'PENDING_DOCUMENTS'
    }
```

### 2.6 `User.isIdentityVerified` — ✓ ao lado do nome

**Usado por**: Tela "Meus Inquilinos" (ícone de verificação que foi
removido por falta de campo).

```diff
  GET /api/users/:id (ou currentTenant expandido)
  → {
      id, name, email, role,
+     isIdentityVerified: boolean,
+     identityVerifiedAt: "2026-04-15T00:00:00.000Z" | null
    }
```

---

## 3. Endpoints pendentes — telas do tenant

### 3.1 `GET /api/conversations` — lista de conversas

**Usado por**: Tela `/chat` (hoje mostra "Nenhuma conversa" por falta
de endpoint). **Causa do timeout do log §1.1**.

```
GET /api/conversations
  Auth: JWT (qualquer role)
  Query: ?unreadOnly=true (opcional)
  → Array de {
      "id":                   "uuid",
      "counterpartName":      "João Silva",
      "counterpartAvatarUrl": "https://...",
      "lastMessage":          "Enviado comprovante de PIX.",
      "lastMessageAt":        "2026-05-07T10:30:00.000Z",
      "unread":               true,            // ou "unreadCount": 3
      "linkedPropertyId":     "uuid",          // opcional
      "linkedTenantId":       "uuid"           // pro landlord
    }
```

Ordenação default: `lastMessageAt DESC`.

### 3.2 Mensagens de uma conversa (GET + POST)

**Usado por**: Tela de chat 1:1 (hoje sem backend — depois do resolver
de US-012, não há como listar/enviar mensagens).

```
GET /api/conversations/:id/messages
  Auth: JWT (participante da conversa)
  Query: ?before=<messageId>&limit=50
  → Array de {
      "id":        "uuid",
      "authorId":  "uuid",
      "content":   "texto",
      "createdAt": "...",
      "readAt":    "..." | null
    }

POST /api/conversations/:id/messages
  body: { content: string }
  → mensagem criada
```

Opcional (melhor UX): WebSocket ou SSE para push em tempo real.
Polling de 15s funciona como fallback.

---

## 4. Endpoints pendentes — suporte

### 4.1 `GET /api/support/tickets` — usuário vê os próprios chamados

**Usado por**: Tela `/support` (hoje dá timeout — §1.2). **Causa
direta do bug no log**.

```
GET /api/support/tickets
  Auth: JWT (qualquer role autenticada)
  → Array de {
      id, code, title, description, createdAt, status
    }
```

Filtra pelos tickets onde `userId = req.localUser.id`. Ordenação:
`createdAt DESC`.

### 4.2 Eco de `title`/`description` no POST

**Sugestão** (melhoria pontual):

O POST atual (US-018) devolve só `{id, code, createdAt}`. Isso força
o frontend a **preservar title/description do próprio request** para
montar o ticket completo no cache local. Se o backend ecoar esses
campos na resposta (~2 linhas), o código cliente fica mais limpo.

### 4.3 Painel admin — só frontend, sem backend novo

US-019/020 já entregaram os endpoints. **Ação é de frontend**: criar
a tela do admin para listar/responder tickets. Fora do escopo deste
documento.

### 4.4 Chat em thread no ticket (decisão aberta)

Ver §1.3 — precisa de alinhamento de produto antes de pedir endpoints.
Se decidido por thread: `POST /admin/support/tickets/:id/replies` +
`GET /support/tickets/:id/replies`. Se decidido por status+resolution
único: nada novo necessário.

---

## 5. Endpoints pendentes — visitas / agenda

### 5.1 `Visit.source` — distinguir MANUAL vs AI

**Usado por**: Smart Agenda (calendário de visitas). Hoje todos os dots
aparecem iguais porque o backend não devolve o campo.

```sql
ALTER TABLE visits
ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL'
  CHECK (source IN ('MANUAL', 'AI'));
```

E incluir `source` no response de `GET /api/visits*`.

**Regra de escrita**: clientes normais sempre gravam `MANUAL`; agente
de IA usa endpoint interno ou service account com scope `ai-agent`.

---

## 6. Endpoints pendentes — filtros e schema

### 6.1 Tipos de imóvel adicionais

**Usado por**: telas de busca, anunciar e editar.

O UI oferece 8 tipos no chip-row, mas o schema de `Property` aceita só
4 (`APARTMENT`, `HOUSE`, `STUDIO`, `CONDO_HOUSE`).

```diff
  enum PropertyType {
    APARTMENT
    HOUSE
    STUDIO
    CONDO_HOUSE
+   KITNET
+   PENTHOUSE      // "Cobertura" na UI
+   LAND           // "Terreno" na UI
+   COMMERCIAL     // "Comercial" na UI
  }
```

E incluir os novos valores na validação de filtros de
`GET /properties/search`.

### 6.2 Amenidades (`hasWifi`, `hasPool`)

**Usado por**: telas de busca, anunciar e editar.

```diff
  model Property {
    ...
+   hasWifi  Boolean @default(false)
+   hasPool  Boolean @default(false)
  }
```

E aceitar esses campos em POST/PUT `/properties` + como filtros em
`GET /properties/search`.

### 6.3 Tipo de transação (Aluguel/Venda/Lançamento) — decisão aberta

A UI tem filtro `transactionTypes: ['Aluguel', 'Comprar', 'Lançamentos']`,
mas o schema trata tudo como aluguel implicitamente.

**Decisão de produto pendente**: expandir o schema OU remover o filtro
cosmético da UI. Sem bloqueio real — só torna a UI enganosa.

```diff
  model Property {
    ...
+   transactionType TransactionType @default(RENTAL)
  }
+ enum TransactionType { RENTAL SALE PRE_LAUNCH }
```

---

## 7. Endpoints pendentes — notificações

### 7.1 `GET /api/notifications` — histórico cross-device

**Status atual**: `POST /api/admin/broadcast` já existe (FCM push). O
frontend tem tela `/notifications`, mas lê de cache local — perde o
histórico se o usuário trocar de device.

```
GET /api/notifications
  Auth: JWT (qualquer role autenticada)
  Query: ?unreadOnly=true (opcional)
  → Array de {
      "id":         "uuid",
      "title":      "Atualização do app",
      "body":       "...",
      "receivedAt": "2026-05-07T10:30:00.000Z",
      "read":       true,
      "category":   "update" | "announcement" | "system"
    }
```

Persistência: row por `(userId, broadcastId)` quando o FCM dispara.

### 7.2 `PUT /api/notifications/:id/read` — sincroniza lido

```
PUT /api/notifications/:id/read
  Auth: JWT (dono da notificação)
  → 204 No Content
```

Sem isso, marcar como lido num device não reflete nos outros.

---

## 8. Priorização para o próximo sprint

Ordem sugerida por impacto × esforço (o backend escolhe):

### Alta prioridade — **desbloqueiam telas hoje quebradas**

1. **Fix CORS / confirmar `/uploads` serve imagens** (§1.4) — bug ativo.
2. **`GET /api/support/tickets`** (§4.1) — timeout visível no log.
3. **`GET /api/conversations`** (§3.1) — timeout visível no log.
4. **`GET/POST /api/conversations/:id/messages`** (§3.2) — chat 1:1
   sem esses endpoints é inútil.

### Média prioridade — **completam funcionalidades já iniciadas**

5. **`GET /properties/:id/payments`** (§2.4) — histórico multi-mês.
6. **`Contract.documentStatus`** (§2.5) — chip real na tela de inquilinos.
7. **Eco de title/description no POST de ticket** (§4.2) — limpeza.

### Baixa prioridade — **melhorias**

8. **`GET /api/landlord/metrics`** (§2.1) — só 2 cards sem dado.
9. **`GET /api/properties/:id/analytics`** (§2.3) — cards da análise.
10. **`Visit.source`** (§5.1) — smart agenda 100% funcional.
11. **`GET /api/notifications`** (§7.1) — sync cross-device.
12. **Expandir `PropertyType`** (§6.1) + **amenidades** (§6.2) — filtros.
13. **Tela admin de suporte** (frontend, não backend).
14. **Decisão sobre chat em thread do ticket** (§1.3, §4.4).
15. **Decisão sobre `transactionType`** (§6.3).

---

## Documentos relacionados

- `INTEGRACAO_BACKEND_2026-05-07.md` — log das integrações feitas no
  frontend em resposta às US-001→US-020.
- `progress.txt` (raiz) — delivery log do backend. Fonte de verdade
  do que foi entregue.
- `prd.json` (raiz) — definição das US-###.
