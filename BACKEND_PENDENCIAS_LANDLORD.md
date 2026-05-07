# Pendências de Backend — Telas do Proprietário

Consolidado do que **ainda falta no backend** para que todas as telas do
landlord (proprietário) fiquem 100% funcionais com dados reais. Itens
marcados ✅ DELIVERED foram entregues pelas US-001→US-020 e já estão
sendo consumidos pelo frontend — não aparecem abaixo.

Datado em 2026-05-07. Ordem: **por tela**, com o impacto de cada gap.

---

## Índice

1. [Dashboard do Landlord](#1-dashboard-do-landlord)
2. [Meus Imóveis — Análise por imóvel](#2-meus-imóveis--análise-por-imóvel)
3. [Meus Inquilinos](#3-meus-inquilinos)
4. [Histórico Financeiro do Inquilino](#4-histórico-financeiro-do-inquilino)
5. [Chat / Conversas](#5-chat--conversas)
6. [Visitas / Agenda](#6-visitas--agenda)
7. [Filtros de Busca e Criação de Imóvel](#7-filtros-de-busca-e-criação-de-imóvel)
8. [Suporte — painel admin](#8-suporte--painel-admin)
9. [Resumo consolidado — endpoints pendentes](#9-resumo-consolidado--endpoints-pendentes)

---

## 1. Dashboard do Landlord

**Tela**: `app/lib/features/home/presentation/pages/landlord_dashboard_page.dart`

### 1.1 Métricas do topo (4 cards)

**Status atual**:
- **Inquilinos** ✅ funciona (conta `myProperties.where(currentTenant != null)` — via US-004).
- **Visitas hoje** ✅ funciona (`landlordVisitsProvider` com filtro de data local).
- **Visitas ao perfil** ❌ mostra `—` com tooltip "Métrica ainda não disponível".
- **Propostas** ❌ mostra `—` com tooltip "Métrica ainda não disponível".

**Endpoint que falta**:

```
GET /api/landlord/metrics
  Auth: JWT (LANDLORD)
  → {
      "profileViews":     1240,   // perfil público aberto nos últimos 30d
      "proposalsPending": 12,     // proposals com status PENDING
      "unreadMessages":   3       // opcional (já temos listagem)
    }
```

**Observações de implementação**:
- `profileViews`: incrementar um contador toda vez que alguém abre
  `/landlord/:id` ou `/property/:id?inspectLandlord=true`. Rolling 30d.
- `proposalsPending`: `SELECT COUNT(*) FROM proposals WHERE landlord_id = :uid AND status = 'PENDING'`. Depende do recurso `proposals` existir.

### 1.2 Gráficos "Análise de Performance"

**Status atual**: removidos da UI porque 100% dos valores eram mockados.
O layout (2 BarCharts lado a lado + LineChart embaixo) está no git
history. Ver comentário em `landlord_dashboard_page.dart`.

**Endpoint que falta**:

```
GET /api/properties/analytics/monthly?from=YYYY-MM-01&to=YYYY-MM-01
  Auth: JWT (LANDLORD)
  → {
      "months":         ["2025-12", "2026-01", ..., "2026-05"],
      "rentals":        [2, 3, 5, 4, 6, 8],
      "newTenants":     [1, 2, 4, 3, 5, 7],
      "monthlyRevenue": [4500, 8200, 7800, 12400, 15600, 18900]
    }
```

---

## 2. Meus Imóveis — Análise por imóvel

**Tela**: `app/lib/features/listing/presentation/pages/listing_analytics_page.dart`

### 2.1 Analytics por imóvel

**Status atual**: métricas mockadas (142 views, 23 favoritos, etc.) que
não variam entre imóveis. Não há endpoint que devolva dados reais por
imóvel.

**Endpoint que falta**:

```
GET /api/properties/:id/analytics
  Auth: JWT (LANDLORD dono do imóvel)
  Query: ?window=30d|90d|1y
  → {
      "views":          142,   // visualizações da página pública
      "favorites":      23,    // usuários que favoritaram
      "proposalsTotal": 8,     // propostas recebidas
      "proposalsOpen":  3,     // com status PENDING
      "visitsScheduled":12,
      "contactClicks":  34,    // cliques no botão "Entrar em contato"
      "dailyViews":     [      // série pra micro-gráfico
        {"date": "2026-04-01", "count": 5},
        ...
      ]
    }
```

### 2.2 Status de pagamento do mês — já entregue ✅

Já funciona via US-009/010 (GET+PUT `/properties/:id/payments/current`).

---

## 3. Meus Inquilinos

**Tela**: `app/lib/features/profile/presentation/pages/tenants_page.dart`

### 3.1 Status documental do inquilino

**Status atual**: o chip (Documentação OK / Aguardando Assinatura /
Pendente Documentos) é derivado heuristicamente de `property.status`:

| `property.status` | label mostrada |
|---|---|
| `RENTED` | Documentação OK |
| `NEGOTIATING` | Aguardando Assinatura |
| `AVAILABLE` (com currentTenant) | Pendente Documentos |

Isso funciona como placeholder mas **mistura dois conceitos** (status do
imóvel vs status documental do inquilino). Um imóvel pode estar `RENTED`
com o contrato aguardando renovação — a heurística erra.

**O que falta (escolher uma opção)**:

**Opção A — campo novo no Contract** (recomendada; casa com US-014):

```diff
  GET /api/contracts?propertyId=...&tenantId=...
  → {
      id, startDate, endDate, monthlyRent, pdfUrl, signedAt,
+     documentStatus: 'APPROVED' | 'AWAITING_SIGNATURE' | 'PENDING_DOCUMENTS'
    }
```

**Opção B — campo no próprio `currentTenant`**:

```diff
  GET /api/properties (com currentTenant expandido)
  currentTenant: {
    id, name, email,
+   documentStatus: 'APPROVED' | 'AWAITING_SIGNATURE' | 'PENDING_DOCUMENTS'
  }
```

Opção A é recomendada porque unifica com o recurso de contrato já
entregue em US-013/014 — o mesmo objeto carrega status documental e
datas.

### 3.2 Vencimento do contrato (`contractEnd`)

**Status atual**: a coluna "Vencimento" mostra `—`.

**O que falta**: nada do lado do backend — `Contract.endDate` **já é
devolvido** em US-014. **Falta só o frontend ligar**: chamar
`activeContractProvider` em `_TenantEntry` e formatar `endDate` como
`MM/YYYY`. Adicionado como débito no documento de alterações.

### 3.3 Ícone de verificação de identidade

**Status atual**: o ✓ dourado que existia no mockup foi removido.

**O que falta**:

```diff
  GET /api/users/:id (ou currentTenant expandido)
  → {
      id, name, email, role,
+     isIdentityVerified: boolean,
+     identityVerifiedAt: "2026-04-15T00:00:00.000Z" | null
    }
```

### 3.4 Preview da última mensagem do chat

**Status atual**: a lista de inquilinos cruza com `conversationsProvider`
procurando a conversa do `tenant.id`. Como o endpoint `GET /conversations`
ainda não existe (ver §5), mostra "Sem mensagens ainda." como fallback.

**Resolve com o item §5.1** (listagem de conversas).

---

## 4. Histórico Financeiro do Inquilino

**Tela**: `app/lib/features/profile/presentation/pages/management/tenant_rent_history_page.dart`

### 4.1 Histórico multi-mês de pagamentos

**Status atual**: backend só entregou `/payments/current` (single-month)
via US-009/010. O frontend faz fallback sintetizando UMA linha a partir
de `currentPaymentProvider` + `Contract.monthlyRent` (via `activeContractProvider`).
Isso mostra só o mês corrente — não dá para ver meses anteriores.

**Endpoint que falta**:

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

Ordenação sugerida: `period DESC`. O frontend já reordena client-side
como safety net em `rent_payment_repository.dart::list`.

---

## 5. Chat / Conversas

### 5.1 Lista de conversas ativas

**Tela**: `app/lib/features/chat/presentation/pages/chat_list_page.dart`
(ou similar — tela `/chat`).

**Status atual**: a página consome `conversationsProvider`, mas como o
endpoint não existe, a lista fica vazia e mostra "Nenhuma conversa".

O **resolver de conversa individual já foi entregue** em US-012
(`GET /conversations/resolve?propertyId=&tenantId=`) — isso é a
ferramenta pra abrir/criar um 1:1. O que falta é a **listagem completa**
para o usuário.

**Endpoint que falta**:

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

Ordenação default: `lastMessageAt DESC`. Frontend já ordena como safety
net.

**Observação**: US-011 já criou a tabela `conversations` com compound
unique `(propertyId, landlordId, tenantId)`. Este endpoint só precisa
fazer SELECT dessa tabela + JOIN com `messages` pra pegar a última.

### 5.2 Mensagens (histórico da conversa)

**Tela**: `app/lib/features/chat/presentation/pages/chat_conversation_page.dart`

**Status atual**: depende de backend de mensagens — não está mapeado
como US entregue no `progress.txt`.

**Endpoints que faltam**:

```
GET /api/conversations/:id/messages
  Auth: JWT (participante da conversa)
  Query: ?before=<messageId>&limit=50  (paginação)
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

Opcional (melhor UX): **WebSocket** ou **Server-Sent Events** para push
de novas mensagens em tempo real. Frontend pode fazer polling como
fallback (intervalo de 15s).

---

## 6. Visitas / Agenda

**Tela**: `app/lib/features/visits/presentation/pages/landlord_visits_page.dart`

### 6.1 Campo `source` em Visit (distinguir MANUAL vs AI)

**Status atual**: a smart agenda (calendário) tem infra pronta pra
distinguir visitas agendadas manualmente vs. criadas por agente de IA
(bot do WhatsApp), mas todos os dots no calendário aparecem iguais
porque o backend não devolve o campo.

**O que falta**:

```sql
ALTER TABLE visits
ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL'
  CHECK (source IN ('MANUAL', 'AI'));
```

E incluir `source` no response de `GET /api/visits*`.

**Regra de escrita**: clientes normais sempre gravam `MANUAL`; agente de
IA usa endpoint interno ou service account com scope `ai-agent`.

**Detalhes**: `BACKEND_VISIT_SOURCE.md` (doc mais antigo, continua
válido).

---

## 7. Filtros de Busca e Criação de Imóvel

**Telas**:
- `app/lib/features/search/presentation/pages/search_page.dart`
- `app/lib/features/listing/presentation/pages/create_listing_page.dart`
- `app/lib/features/listing/presentation/pages/edit_listing_page.dart`

### 7.1 Tipos de imóvel adicionais

**Status atual**: a UI oferece 8 tipos no chip-row, mas o schema de
`Property` aceita só 4 (`APARTMENT`, `HOUSE`, `STUDIO`, `CONDO_HOUSE`).

Quando o landlord seleciona um tipo estendido (KITNET, PENTHOUSE, LAND,
COMMERCIAL), o frontend guarda em `property.extendedType` e envia
`type: 'APARTMENT'` pro backend pra não quebrar a validação. Resultado:
filtros por esses tipos não funcionam.

**O que falta**:

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

E incluir os novos valores na validação de filtros de `GET /properties/search`.

### 7.2 Amenidades (hasWifi, hasPool)

**Status atual**: formulários expõem esses campos mas `propertyToCreateJson`
e `propertyToPatchJson` não os enviam — ficam em estado local apenas.

**O que falta**:

```diff
  model Property {
    ...
+   hasWifi  Boolean @default(false)
+   hasPool  Boolean @default(false)
  }
```

E aceitar esses campos em POST/PUT `/properties` e como filtros em
`GET /properties/search`.

### 7.3 Tipo de transação (Aluguel / Venda / Lançamento)

**Status atual**: a UI tem filtro `transactionTypes: ['Aluguel',
'Comprar', 'Lançamentos']` mas o schema trata tudo como aluguel
implicitamente.

**Decisão de produto pendente**: ou expandir o schema OU remover o
filtro cosmético da UI. Sem bloqueio real — só torna a UI enganosa.

```diff
  model Property {
    ...
+   transactionType TransactionType @default(RENTAL)
  }
+ enum TransactionType { RENTAL SALE PRE_LAUNCH }
```

---

## 8. Suporte — painel admin

**Status**: POST de criação de ticket (landlord/tenant) ✅ entregue em
US-017/018. GET+PUT do painel admin ✅ entregue em US-019/020.

**Pendência**: tela do admin ainda não foi construída no frontend. Não
é gap de backend — é trabalho de frontend que ficou para uma rodada
futura. O endpoint está lá pronto.

**Arquivos do frontend a criar**:
- `app/lib/features/admin/presentation/pages/admin_support_tickets_page.dart`
- `app/lib/features/admin/data/support_admin_repository.dart`

---

## 9. Resumo consolidado — endpoints pendentes

Copy-paste-friendly para o time de backend montar o próximo sprint.

### Prioridade A (telas com gap visível hoje)

| Endpoint | Tela impactada | US-# proposto |
|---|---|---|
| `GET /api/landlord/metrics` | Dashboard (cards de topo) | — |
| `GET /api/properties/analytics/monthly` | Dashboard (gráficos) | — |
| `GET /api/properties/:id/analytics` | Análise por imóvel | — |
| `GET /api/properties/:id/payments?tenantId=` | Histórico Financeiro | — |
| `GET /api/conversations` | Lista de conversas (/chat) | — |
| `GET/POST /api/conversations/:id/messages` | Chat 1:1 | — |

### Prioridade B (afetam "Meus Inquilinos")

| Mudança | Tela impactada | US-# proposto |
|---|---|---|
| `Contract.documentStatus` (Opção A) | Meus Inquilinos (chip de status) | — |
| `User.isIdentityVerified` | Meus Inquilinos (ícone ✓) | — |

### Prioridade C (schema + filtros)

| Mudança | Tela impactada |
|---|---|
| `Visit.source` (MANUAL/AI) | Agenda de visitas |
| `PropertyType` +4 valores (KITNET, PENTHOUSE, LAND, COMMERCIAL) | Busca + Anunciar/Editar |
| `Property.hasWifi`, `Property.hasPool` | Busca + Anunciar/Editar |
| `Property.transactionType` (opcional — ou remover filtro) | Busca |

---

## Documentos relacionados

- `BACKEND_HANDOFF.md` — mapa completo com status de cada item (✅
  entregues vs ⚠️ pendentes).
- `BACKEND_LANDLORD_GAPS.md` — detalhes técnicos dos gaps originais
  (algumas seções agora obsoletas — ver `BACKEND_HANDOFF.md` para
  status atualizado).
- `BACKEND_VISIT_SOURCE.md` — detalhamento técnico do item §6.1.
- `INTEGRACAO_BACKEND_2026-05-07.md` — log das alterações feitas no
  frontend para consumir US-001→US-020.
- `progress.txt` (raiz do repo do backend) — delivery log das US-001→US-020.
