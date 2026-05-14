# PRD: Correção de Servimento de Imagens em Produção

## 1. Introduction/Overview

Em produção (servidor `desafio01.alphaedtech` — não-localhost) o app Flutter não consegue renderizar as imagens dos imóveis. A investigação no backend mostrou a causa raiz: existe um **mismatch entre o prefixo de URL armazenado no banco e o prefixo da rota estática que serve os arquivos**.

- O `propertyImageStorageService.savePropertyImages` grava no banco a URL relativa **`/uploads/<propertyId>/<file>.jpg`** (sem o segmento `/api`) — `src/services/propertyImageStorageService.ts:56`.
- Mas o `express.static` que serve os arquivos físicos está montado em **`/api/uploads`** — `src/app.ts:51`.
- O mesmo padrão se repete em `contractDocumentStorageService.ts:48` (PDF de contratos).

Em desenvolvimento, quando o Flutter aponta `baseUrl = http://localhost:3000` (sem `/api`) e faz `Image.network(baseUrl + image.url)`, a URL final `http://localhost:3000/uploads/...` por acaso “funcionaria” se o servidor servisse em `/uploads`, ou “quebraria” silenciosamente coberta por outras condições do emulador. Em produção, com o baseUrl real do servidor, a rota `/uploads/...` retorna **404** porque os arquivos só estão expostos em `/api/uploads/...`.

A correção precisa ser **100% no backend** (o cliente Flutter já está distribuído e não será atualizado nesta janela). A estratégia escolhida é **manter as URLs relativas como estão no banco** e **alinhar o servidor para responder no prefixo que o Flutter já espera** (`/uploads`), mantendo `/api/uploads` como compatibilidade.

## 2. Goals

- Imagens de imóveis renderizam corretamente no Flutter quando o backend roda no servidor (`desafio01.alphaedtech` / IP `10.10.0.201`), sem alterar o app cliente.
- URLs já gravadas no banco (`/uploads/<propertyId>/<file>.jpg`) continuam válidas — zero migração de dados.
- PDFs de contrato (`/uploads/contracts/<id>/<file>.pdf`) servidos pelo endpoint protegido `/api/contracts/:id/pdf` continuam funcionando como hoje.
- Rota antiga `/api/uploads` permanece funcionando para qualquer cliente legado/admin que possa estar usando o prefixo completo.
- Erros 404 de imagem em produção caem a zero nos testes de aceitação.

## 3. User Stories

### US-001: Servir arquivos estáticos no prefixo `/uploads`
**Description:** As an API operator, I want the static file handler to respond at the same path prefix the Flutter client already concatenates, so that stored relative URLs resolve correctly without any client change.

**Acceptance Criteria:**
- [ ] `src/app.ts` registra `app.use('/uploads', express.static(path.join(__dirname, '../uploads')))` **antes** das rotas autenticadas e ao lado do mount existente.
- [ ] O mount existente em `/api/uploads` é mantido (compat).
- [ ] `GET /uploads/<propertyId>/<file>.jpg` retorna `200` com `Content-Type: image/jpeg` (ou `image/png` conforme extensão) em uma instância rodando no servidor.
- [ ] `GET /api/uploads/<propertyId>/<file>.jpg` continua retornando `200` (não regrediu).
- [ ] Typecheck passa (`npm run build` sem erros).

### US-002: Validar isolamento de path traversal nos dois mounts
**Description:** As an API operator, I want to ensure adding the second static mount does not weaken the existing path-safety posture, so that `..` and absolute paths cannot escape the `uploads/` directory through either route.

**Acceptance Criteria:**
- [ ] Teste manual (curl) com `GET /uploads/../package.json` retorna 403/404 (não vaza arquivo fora de `uploads/`).
- [ ] Teste manual com `GET /uploads/%2e%2e/package.json` retorna 403/404.
- [ ] Mesmo comportamento confirmado em `/api/uploads/...`.

### US-003: Verificar render no Flutter contra o servidor de produção
**Description:** As a QA, I want to confirm that the unmodified Flutter client renders property cover images and gallery images when pointed at the production server, so that the bug is closed end-to-end.

**Acceptance Criteria:**
- [ ] Build de Flutter atual instalada em dispositivo/emulador apontando para `http://desafio01.alphaedtech:<PORT>/api`.
- [ ] Tela de listagem de imóveis exibe a imagem de capa de pelo menos 3 imóveis seed.
- [ ] Tela de detalhe do imóvel exibe a galeria completa.
- [ ] DevTools/logcat do dispositivo não mostra `404` ou `NetworkImage` errors para `/uploads/...`.

### US-004: Endurecer CORS para servir imagens cross-origin (defensivo)
**Description:** As an API operator, I want the static handler to send `Cross-Origin-Resource-Policy: cross-origin` so that future web/PWA Flutter builds (and admin web panels) can also render the images without browser-side blocking.

**Acceptance Criteria:**
- [ ] Header `Cross-Origin-Resource-Policy: cross-origin` presente em respostas `GET /uploads/...` e `GET /api/uploads/...` (via `setHeaders` no `express.static` options ou middleware único compartilhado).
- [ ] Header `Cache-Control: public, max-age=86400` (ou valor equivalente já praticado) presente — imagens são imutáveis (UUID no nome).
- [ ] CORS atual `app.use(cors())` continua funcionando — sem regressão em outras rotas.

### US-005: Documentar o contrato no Swagger e no README
**Description:** As a future maintainer, I want the dual mount documented so that the `/api/uploads` vs `/uploads` choice is not "magic" and is not undone by accident in a refactor.

**Acceptance Criteria:**
- [ ] Comentário em `src/app.ts` explicando por que existem dois mounts (compatibilidade com URLs históricas `/uploads/...` armazenadas em `PropertyImage.url` e `Contract.pdfUrl`).
- [ ] `src/config/swagger.ts` example URL para `PropertyImage.url` permanece `/uploads/...` (já está; só confirmar).
- [ ] Entrada em `BACKEND_HANDOFF.md` (ou doc equivalente) explicando o duplo mount.

### US-006: Smoke test automatizado
**Description:** As a developer, I want a Vitest integration test that asserts both mounts serve a real file, so that a future refactor that removes one of them fails CI instead of production.

**Acceptance Criteria:**
- [ ] Teste em `tests/` que faz `request(app).get('/uploads/<seed-property-id>/<seed-file>.png')` e espera `200` + `content-type` começando com `image/`.
- [ ] Mesmo teste para `/api/uploads/...`.
- [ ] Teste roda em `npm test` e passa.

## 4. Functional Requirements

- **FR-1:** O backend deve servir os arquivos estáticos do diretório `uploads/` em **dois** prefixos HTTP simultaneamente: `/uploads` (novo, alinhado com URLs históricas) e `/api/uploads` (legado, mantido para retrocompatibilidade).
- **FR-2:** Nenhuma URL no banco de dados (tabelas `property_images.url`, `contracts.pdf_url`, qualquer outra que armazene `/uploads/...`) deve ser modificada por essa correção.
- **FR-3:** O endpoint protegido `GET /api/contracts/:id/pdf` deve continuar resolvendo `pdfUrl` relativo (`/uploads/contracts/<id>/<file>.pdf`) via `path.resolve(__dirname, '../../', relative)` exatamente como hoje — nenhuma mudança em `contractController.getPdf`.
- **FR-4:** O servidor estático deve negar acesso a paths que escapem do diretório `uploads/` (defesa contra path traversal) — comportamento padrão do `express.static`, a confirmar via teste.
- **FR-5:** Respostas do servidor estático devem incluir `Cross-Origin-Resource-Policy: cross-origin` e cabeçalhos de cache razoáveis.
- **FR-6:** O processo de upload de imagens (`propertyImageStorageService.savePropertyImages`) continua gravando URLs no formato `/uploads/<propertyId>/<filename>` — sem alterar a função.
- **FR-7:** Logs (`pino`) devem registrar uma linha por arquivo servido em nível `debug` (opcional — não bloqueia entrega).

## 5. Non-Goals (Out of Scope)

- **Não** migrar para storage externo (S3, Cloudfront, Firebase Storage). Fica para um PRD futuro de hospedagem.
- **Não** mudar o formato das URLs armazenadas no banco — nada de URLs absolutas, nada de campos novos, nada de migration.
- **Não** alterar o app Flutter. Toda a correção é no backend.
- **Não** adicionar autenticação no servimento de imagens de imóveis (elas são públicas por definição — listagem aberta). PDF de contrato continua protegido via endpoint dedicado.
- **Não** redesenhar a estratégia de uploads (multer, validação de mime, etc.) — escopo apenas do servimento.
- **Não** adicionar HTTPS / reverse proxy / nginx config — assume-se que o proxy de produção já está configurado pelo time de infra (ver `plan_hospedagem.md`).

## 6. Design Considerations

- O motivo de existir o prefixo `/api` na maioria das rotas (`app.use('/api', ...)`) é organizacional — separar API de assets/static. Manter `/uploads` como rota raiz **fora de `/api`** mantém a semântica original (assets), e o `/api/uploads` legado vira o caso especial documentado.
- Não criar um novo router separado; basta dois `app.use(express.static(...))` lado a lado em `app.ts` para máxima clareza.
- Reaproveitar `path.join(__dirname, '../uploads')` exatamente como já está — não inventar novo path absoluto.

## 7. Technical Considerations

- **Ordem de middlewares:** os dois `express.static` devem ficar **antes** de `app.use('/api', authStack, ...)` para não passarem por `checkJwt`. Já é o caso do mount existente.
- **Trust proxy:** já está configurado (`app.set('trust proxy', 1)`) — não é preciso mexer.
- **CORS:** está em modo wildcard (`app.use(cors())`) — suficiente para mobile. Adicionar `Cross-Origin-Resource-Policy` no `setHeaders` do `express.static` é defesa em profundidade para futuro cliente web.
- **Concorrência com PDF de contrato:** o `contractController.getPdf` resolve o `pdfUrl` removendo a barra inicial e juntando com `__dirname/../../`. Como nada muda nesse fluxo, está coberto.
- **Disk vs Object Storage:** seguimos em disk no servidor de produção (`~/apps/alphatoca-backend/uploads/`). O `pm2`/processo precisa de permissão de leitura no diretório — já necessária hoje.
- **Backup:** chamar atenção do time de infra de que o diretório `uploads/` faz parte do backup do servidor (não é regenerável).

## 8. Success Metrics

- 0 erros `404` para paths `/uploads/...` ou `/api/uploads/...` nas próximas 24h após deploy (verificado via logs do servidor).
- 100% das 3+ telas Flutter que exibem imagens (listagem, detalhe, favoritos) renderizam imagens em produção sem fallback de placeholder.
- `npm run build` e `npm test` continuam verdes na branch antes do merge.

## 9. Open Questions

- O Flutter aponta `baseUrl` para `http://desafio01.alphaedtech:3000/api` ou para `http://desafio01.alphaedtech:3000` (sem `/api`)? Confirmar com o time de mobile — não bloqueia a entrega (a solução cobre os dois casos), mas ajuda a validar US-003.
- O servidor de produção está atrás de um proxy reverso (nginx/Caddy)? Se sim, ele precisa repassar `/uploads/*` exatamente como repassa `/api/*`. Confirmar com infra antes do deploy.
- A pasta `uploads/` no servidor de produção já contém todos os arquivos referenciados no banco? Se a migration recente do banco trouxe URLs cujos arquivos físicos ficaram em outra máquina, este PRD **não resolve sozinho** — seria preciso um trabalho separado de cópia de arquivos. Verificar `ls uploads/` no servidor contra `SELECT url FROM property_images` antes de declarar sucesso.
