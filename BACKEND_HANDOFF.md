# Backend — Punchlist de Integração

Handoff do que o frontend já implementou e depende do backend para virar
funcional ponta-a-ponta. **Nenhum item trava a demo da UI** — todas as
telas renderizam estados sensatos sem backend — mas cada item listado
abaixo gera um comportamento visivelmente incompleto.

Datado em 2026-05-07. Ordem: **bloqueantes → funcionais → melhorias**.

---

## 🔴 Bloqueantes de fluxo principal

Sem estes, o landlord não consegue completar os fluxos mais importantes
do produto.

### 1. Upload/remoção de fotos no **edit** de imóvel

**Sintoma**: editar imóvel e salvar com fotos novas retorna 200 mas as
fotos não persistem.

**O que o backend precisa**: `PUT /api/properties/:id` aceitar
`multipart/form-data` além de JSON. Reusar o `propertyPhotoUploadHandler`
que já foi implementado no POST. Adicionar handler do campo repetido
`photosToRemove[]` (URLs a deletar do storage + tabela).

**Frontend**:
- `app/lib/features/search/data/datasources/property_remote_api_datasource.dart`
  — já manda multipart quando há fotos novas ou removidas.
- `app/lib/features/listing/presentation/pages/edit_listing_page.dart`
  — formulário completo com galeria de fotos + picker.

**Detalhes**: `BACKEND_LANDLORD_GAPS.md §1`.

### 2. Campo `status` em Property

**Sintoma**: o seletor de status (Disponível / Em negociação / Alugado)
na análise do imóvel persiste via `PUT` (esse funciona), mas ao refetchar
a lista o valor volta ao default porque o `GET` não devolve o campo.

**O que o backend precisa**: devolver `property.status` no response dos
`GET /api/properties/search` e `GET /api/properties/:id`.

**Frontend**:
- `app/lib/features/search/data/models/property_api_model.dart` — já lê
  `json['status']`.
- `app/lib/features/search/domain/entities/property.dart` — campo `status`
  no entity.

**Detalhes**: `BACKEND_LANDLORD_GAPS.md §2`.

### 3. Filtro `landlordId` aceita UUID não-canônico (ou seeds usam UUID)

**Sintoma**: login como landlord devolve `id=user-demo-landlord-1`, mas
`/properties/search?landlordId=user-demo-landlord-1` retorna **400
VALIDATION_ERROR: Invalid uuid**. Dashboard, dossier e visitas ficam
vazios porque o backend rejeita a própria ID que ele mesmo devolve.

**O que o backend precisa** (escolher uma):
- (A) **Trocar seeds** por `crypto.randomUUID()` nos scripts de seed.
- (B) **Relaxar validação** de `landlordId`/`tenantId` de
  `z.string().uuid()` pra `z.string().min(1)`.

A (A) é recomendada — mantém a robustez da validação em produção.

**Frontend**: nada a fazer. Quando o id virar UUID, tudo que já usa
`landlordId` (dashboard, dossier, visitas) volta a funcionar.

---

## 🟠 Funcionais — UI está plumbed, falta endpoint

### 4. `currentTenant` no Property + auto-transição de status

**O que o backend precisa**:
- Devolver `property.currentTenant = { id, name }` (objeto ou via
  `?expand=tenant`) quando existe `RentalProcess.status='ACTIVE'`.
- **Atualizar automaticamente** `Property.status = 'RENTED'` na mesma
  transação que ativa um `RentalProcess`. Reverter para `AVAILABLE` ao
  encerrar o contrato (prazo, distrato, rescisão).

**Desbloqueia**:
- Cards do dossier mostram nome do inquilino e o botão **CHAT** vira
  funcional.
- Landlord não precisa mais trocar o status manualmente na análise.
- Estado do sistema deixa de ficar inconsistente (contrato ativo +
  imóvel marcado disponível).

**Detalhes**: `BACKEND_LANDLORD_GAPS.md §2 e §2.auto-transição`.

### 5. Status de pagamento mensal do aluguel

**Sintoma**: os seletores de **PAGO / AGUARDANDO / ATRASADO** no dossier
e na análise do imóvel funcionam visualmente mas **não persistem**. A
cada refresh volta a "AGUARDANDO".

**O que o backend precisa**:

```
GET  /api/properties/:id/payments/current
  → { period: "2026-05", status: "AWAITING" | "PAID" | "LATE",
      updatedAt: "...", updatedBy: "uuid-landlord" }

PUT  /api/properties/:id/payments/current
  body: { status: "PAID" }
  → objeto atualizado
```

Auth: JWT do landlord dono do imóvel.

**Detalhes**: `BACKEND_LANDLORD_GAPS.md §3`.

### 6. Chat 1:1 landlord-inquilino (conversation resolver)

**Sintoma**: clicar em **CHAT** no card do dossier navega para
`/chat/property-<pid>-tenant-<tid>` — um id sintético. A tela abre vazia
ou quebra dependendo do datasource de chat.

**O que o backend precisa**:

```
GET /api/conversations/resolve?propertyId=...&tenantId=...
  → { id: "uuid-conversation", messages: [...] }
```

Se não existir conversa, cria atomicamente. Frontend troca o id sintético
pelo retornado antes de navegar.

**Detalhes**: `BACKEND_LANDLORD_GAPS.md §4`.

### 7. Contrato Digital — PDFs

**Sintoma**: botão **BAIXAR PDF** mostra snackbar "indisponível". Botão
**ENVIAR CONTRATO ASSINADO** abre o seletor, guarda o nome do arquivo no
state, mas não sobe nada. A UI já tem o picker funcionando (file_picker)
e guarda os bytes do PDF em memória.

**O que o backend precisa**:

```
GET  /api/contracts?propertyId=...&tenantId=...
  → { id, startDate, endDate, monthlyValue, pdfUrl, signedAt }

GET  /api/contracts/:id/pdf
  → 302 pra URL pré-assinada OU 200 com application/pdf

PUT  /api/contracts/:id/signed-document
  multipart: { signedPdf: <file PDF> }
  → { signedAt, storageUrl }
```

**Também**: devolver `startDate` / `endDate` no GET de contrato — hoje a
UI mostra "12 meses a partir do mês atual" como placeholder.

**Detalhes**: `BACKEND_LANDLORD_GAPS.md §5`.

### 8. Campo `source` em Visit (agenda IA)

**Sintoma**: a smart agenda (calendário nas telas de visitas) tem infra
pronta pra distinguir visitas agendadas manualmente vs. criadas por
agente de IA (bot WhatsApp), mas todos os dots aparecem iguais porque o
backend não devolve o campo.

**O que o backend precisa**:

```sql
ALTER TABLE visits
ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL'
  CHECK (source IN ('MANUAL', 'AI'));
```

E incluir `source` no response de `/api/visits*`. Regra: clientes normais
sempre gravam `MANUAL`; agente de IA usa endpoint interno ou service
account com scope `ai-agent`.

**Detalhes**: `BACKEND_VISIT_SOURCE.md`.

---

## 🟡 Melhorias — UI já consome, sem blocker real

### 9. Paridade de filtros no Property

**Situação**: a tela de busca tem filtros que **não existem no schema
de Property do backend**, então marcar esses filtros não afeta o
resultado. Os forms de anunciar/editar agora expõem os mesmos campos
(UI-only, marcados com tooltip "backend em expansão") pra evitar o gap
percebido pelo landlord — mas os valores **não persistem** até o
backend adicionar os campos.

**A adicionar no schema de Property:**

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

  model Property {
    ...
+   hasWifi       Boolean @default(false)
+   hasPool       Boolean @default(false)
  }
```

E incluir esses campos na validação de filtros de `GET /properties/search`.

**Campos que o frontend guarda no PropertyInput mas hoje não envia ao
backend** (ver `app/lib/features/search/domain/entities/property_input.dart`):

- `extendedType` (string) — guarda o valor do tipo estendido selecionado
  (KITNET/PENTHOUSE/LAND/COMMERCIAL); quando setado, o POST envia `type:
  'APARTMENT'` (default) pra não quebrar a validação atual. Quando o
  backend expandir o enum, o datasource troca pra mandar o `extendedType`
  direto no campo `type`.
- `hasWifi`, `hasPool` (bool) — ignorados pelo `propertyToCreateJson`/
  `propertyToPatchJson` hoje. Ligar na serialização quando campos
  existirem no backend.

**Arquivos do frontend que dependem desse fix:**

- `app/lib/features/listing/presentation/widgets/listing_form_fields.dart`
  → `ListingTypeChipsRow` (mapeia os 8 tipos).
- `app/lib/features/search/presentation/widgets/property_type_filter_modal.dart`
  → modal de filtros que o usuário usa na busca.
- `app/lib/features/search/data/models/property_api_model.dart` →
  `propertyToCreateJson` / `propertyToPatchJson` (onde ligar `hasWifi`
  e `hasPool` quando o schema aceitar).

### 10. Tickets de Suporte

**Sintoma**: o menu "Suporte" no perfil abre uma tela de chamado, o
usuário preenche título + descrição e clica em ENVIAR. Hoje o POST cai
em 404 (endpoint inexistente) e o frontend mostra uma confirmação
offline com código local, avisando que o canal será ativado.

**O que o backend precisa**:

```
POST /api/support/tickets
  Auth: JWT (qualquer role)
  Body: {
    "title": "Não consigo editar as fotos",
    "description": "Quando clico em salvar..."
  }
  Server-side (anexa a partir do JWT e da hora do request):
    userId, userName, userRole (TENANT|LANDLORD|ADMIN), createdAt

  Response 201:
    {
      "id": "uuid",
      "code": "SUP-260507-AB12",  // formato humano-legível,
                                   // backend gera deterministicamente
                                   // (data + random base36)
      "createdAt": "2026-05-07T12:00:00.000Z"
    }
```

O frontend já está pronto pra exibir `response.data['code']` tal qual.
Se o backend devolver apenas `id`, o código é usado como fallback. O
formato sugerido `SUP-AAMMDD-XXXX` é o mesmo que o frontend gera
localmente em modo fallback — se o backend seguir esse padrão, a UI
fica consistente entre sucesso e fallback.

**Painel do admin** (a definir junto com o time):

```
GET /api/admin/support/tickets
  Auth: JWT + ADMIN only
  Query: ?status=OPEN|RESOLVED, ?role=TENANT|LANDLORD, ?from=..., ?to=...
  → Array de {
      id, code, title, description,
      user: { id, name, email, role },
      status, createdAt, updatedAt,
      assignedTo?: { id, name },
      resolution?: string
    }

PUT /api/admin/support/tickets/:id
  body: { status, resolution?, assignedTo? }
  → objeto atualizado
```

O frontend do admin ainda não existe — essa tela vem depois. Por ora,
o principal é que a submissão do landlord/tenant **pare de cair em
404** e entre numa fila que o admin vai consultar.

**Infra de e-mail**: boa prática é o backend disparar um e-mail pro
`user.email` ao criar o ticket ("Recebemos seu chamado SUP-... e vamos
responder em X horas") e outro quando o admin responder. Frontend não
participa.

### Aluguel vs Venda vs Lançamentos

A UI de busca tem `transactionTypes: ['Aluguel', 'Comprar', 'Lançamentos']`.
O schema atual do Property **não tem** esse conceito — tudo é
tratado como aluguel implicitamente. Para a UI virar funcional, o
backend precisaria:

```diff
  model Property {
    ...
+   transactionType TransactionType @default(RENTAL)
+   // Adicional: price vira priceRental + priceSale
  }

+ enum TransactionType { RENTAL SALE PRE_LAUNCH }
```

Decisão de produto: no MVP, faz sentido só remover esse filtro da UI
(opção cosmética) OU expandir o schema. Não bloqueia nada.

### 10. Analytics reais por imóvel

Hoje `ListingAnalyticsPage` mostra métricas mockadas (142 views, 23 favs,
etc.) que não mudam entre imóveis. `BACKEND_GAPS.md §2` (gerado na Fatia
4) já descreve o shape sugerido para `GET /api/properties/:id/analytics`.

---

## ✅ Já confirmado funcionando

- `POST /api/properties` com multipart + campo `photos[]` (confirmado
  pelo time de backend em conversa — primeira foto vira capa automática).
- `GET /api/users/me` devolve `role: 'LANDLORD' | 'TENANT' | 'ADMIN'`.
- `GET /properties/search?landlordId=<uuid>` quando o id é UUID canônico.
- `PUT /api/properties/:id` com `application/json` — atualiza campos
  escalares (status inclusive).

---

## Mapa rápido de arquivos ↔ endpoints

| Endpoint | Frontend |
|---|---|
| `POST /api/properties` (multipart) | `property_remote_api_datasource.dart::create` |
| `PUT /api/properties/:id` (multipart) | `property_remote_api_datasource.dart::update` |
| `GET /api/properties/search` | `property_remote_api_datasource.dart::searchProperties` |
| `GET /api/users/me` | `auth_local_datasource.dart::syncFromBackend` |
| `GET /api/visits?landlordId=...` | `landlord_visits_notifier.dart` |
| `/api/contracts/*` | `tenant_contract_page.dart` |
| `/api/conversations/resolve` | `property_management_dossier_page.dart::_openChatWithTenant` |
| `POST /api/support/tickets` | `support_ticket_page.dart::_submit` |
| `GET /api/admin/support/tickets` | (painel admin — ainda não implementado) |

---

## Checklist compacto de rollout

**Prioridade 1 — destrava o MVP do landlord:**

- [ ] Seeds usam UUID canônico OU validação relaxada em `landlordId`
- [ ] `GET` de Property devolve `status`
- [ ] `PUT /properties/:id` aceita multipart com `photos[]` e `photosToRemove[]`

**Prioridade 2 — gestão de aluguel funcional:**

- [ ] Property devolve `currentTenant`
- [ ] Auto-transição `RentalProcess=ACTIVE → Property.status=RENTED`
- [ ] Recurso de `payments/current` (GET+PUT)
- [ ] Resolver de conversation por propertyId+tenantId

**Prioridade 3 — contratos:**

- [ ] `GET /api/contracts?propertyId=...&tenantId=...`
- [ ] `GET /api/contracts/:id/pdf`
- [ ] `PUT /api/contracts/:id/signed-document`

**Prioridade 4 — visitas automáticas e suporte:**

- [ ] Coluna `source` em visits + devolver no GET
- [ ] `POST /api/support/tickets` (landlord/tenant abrem chamado)
- [ ] `GET`+`PUT /api/admin/support/tickets` (admin responde)

**Prioridade 5 — melhorias:**

- [ ] Expandir `PropertyType` com KITNET, PENTHOUSE, LAND, COMMERCIAL
- [ ] Adicionar `hasWifi` e `hasPool` ao schema Property (+ filtros em `/search`)
- [ ] Decidir se adiciona `transactionType` (Aluguel/Venda/Lançamento) ou
      remove o filtro da UI
- [ ] Endpoint de analytics real por imóvel

---

## Servimento de imagens (`uploads/`) — duplo mount

Aviso para quem refatorar `src/app.ts`: existem **dois** `express.static` montados
no mesmo diretório (`uploads/`). Não é duplicação acidental — remover um dos dois
quebra produção. PRD autoritativo: `tasks/prd-fix-image-serving-mismatch.md`.

**Onde as URLs são geradas:**

- `src/services/propertyImageStorageService.ts::savePropertyImages` — fotos de
  imóveis. Persiste em `PropertyImage.url`.
- `src/services/contractDocumentStorageService.ts::saveContractDocument` —
  PDFs de contrato (versão histórica). Persiste em `Contract.pdfUrl`.

**Formato armazenado no banco** (Postgres, sem prefixo de host):

```
/uploads/<propertyId>/<file>.ext        # fotos de imóvel
/uploads/contract-<contractId>/<file>.pdf   # PDFs de contrato (histórico)
```

**Por que existem dois mounts em `src/app.ts`** (linhas 66-67, ANTES do
`authStack` para não passarem por `checkJwt`):

```
app.use('/uploads',     express.static(uploadsRoot, { setHeaders }))  // novo
app.use('/api/uploads', express.static(uploadsRoot, { setHeaders }))  // compat
```

- O cliente Flutter (`app/`) monta `baseUrl + image.url`. Como `image.url` já
  começa com `/uploads/...`, o mount em `/uploads` é o que resolve as fotos
  sem o cliente ter que conhecer o segmento `/api`.
- O mount em `/api/uploads` é mantido por retrocompatibilidade: clientes
  legados (admin, scripts, integrações externas) podem ter URLs absolutas
  cacheadas com o prefixo completo. Não custa nada manter os dois apontando
  para a mesma raiz.
- Ambos compartilham `setUploadsHeaders`, que injeta
  `Cross-Origin-Resource-Policy: cross-origin` (necessário para o `<img>` no
  webapp/admin) e `Cache-Control: public, max-age=86400`.

**Não há migration de dados.** O banco continua com as URLs no formato
`/uploads/...` exatamente como foram gravadas — o fix é 100% backend, sem
script de update no Postgres e sem deploy do cliente Flutter.

**PDFs de contrato continuam protegidos.** O fluxo de download de contrato
passa por `GET /api/contracts/:id/pdf` (autenticado, com checagem de quem
pode ver o PDF). O duplo mount **não substitui** esse endpoint — ele só
serve assets públicos (imagens de imóvel já são públicas hoje). Se um PDF
for servido também via `/uploads/...` no futuro, lembrar que esse caminho
**não** tem `checkJwt` e qualquer um com a URL acessa.

**Alerta para o time de infra:** o diretório `uploads/` no servidor de
produção é o storage canônico desses assets — **precisa entrar no backup**.
Os arquivos **não são regeneráveis** (não vêm de um bucket externo nem de
um build); perder esse diretório significa perder as fotos cadastradas pelos
landlords e os PDFs históricos de contrato.

Testes de regressão: `tests/uploadsStaticMount.test.ts` exercita os dois
mounts e três variantes de path-traversal. Se um refactor remover um dos
mounts, o CI quebra antes de produção.

---

## Documentos de referência

- `BACKEND_LANDLORD_GAPS.md` — detalhe completo de cada item 1-7 deste
  punchlist, com shape de request/response e checklist por item.
- `BACKEND_VISIT_SOURCE.md` — detalhe do item 8 (agenda IA).
- `NOTAS_DASHBOARD_LANDLORD.md` — pós-mortem de bugs resolvidos durante
  o desenvolvimento (não são gaps pendentes — serve para quem for tocar
  o código não cair nas mesmas pegadinhas).
