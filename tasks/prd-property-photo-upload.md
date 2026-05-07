# PRD: Upload de Fotos na Criação de Propriedade

## 1. Introdução / Visão Geral

Atualmente a rota `POST /properties` aceita apenas JSON e não permite envio de imagens. O frontend já possui uma tela que permite ao locador ("client") anexar fotos JPEG/PNG no momento da criação da propriedade, mas o backend não está preparado para receber esses arquivos.

Esta feature adiciona suporte a **upload multipart** na mesma rota `POST /properties`, de modo que a criação da propriedade e a persistência de suas fotos aconteçam em uma única chamada. As fotos serão armazenadas em **filesystem local** (`uploads/<propertyId>/`) e referenciadas pela tabela `property_images` já existente no Prisma.

## 2. Goals

- Permitir ao locador enviar de 0 a 20 fotos JPEG/PNG ao criar uma propriedade em uma única chamada HTTP.
- Validar rigorosamente tipo (MIME + extensão) e tamanho (≤ 10MB por arquivo) dos uploads.
- Persistir cada arquivo no filesystem sob `uploads/<propertyId>/<uuid>.<ext>` e registrar a URL servida em `PropertyImage`.
- Marcar automaticamente a primeira foto enviada como capa (`isCover = true`).
- Servir as imagens via rota pública (`GET /uploads/...`) para que o frontend consiga renderizá-las.
- Garantir atomicidade: se a criação da propriedade falhar, nenhum arquivo fica órfão; se o upload falhar, a propriedade não é criada parcialmente.

## 3. User Stories

### US-001: Instalar e configurar multer para multipart/form-data
**Description:** Como desenvolvedor, preciso de uma biblioteca de parsing multipart para que o Express consiga processar arquivos binários no corpo da requisição.

**Acceptance Criteria:**
- [ ] `multer` e `@types/multer` adicionados como dependências
- [ ] Instância de multer configurada com `memoryStorage` (buffer em RAM — arquivos só vão para disco após validação + criação da propriedade)
- [ ] Limites globais: `fileSize: 10 * 1024 * 1024` (10MB), `files: 20`
- [ ] `fileFilter` aceita apenas `image/jpeg` e `image/png` (rejeita demais com erro tipado)
- [ ] Typecheck/lint passam

### US-002: Criar utilitário de persistência de imagens no filesystem
**Description:** Como desenvolvedor, preciso de uma função única para gravar buffers de imagem em `uploads/<propertyId>/` com nomes seguros, para que o controller não lide com I/O diretamente.

**Acceptance Criteria:**
- [ ] Novo módulo `src/services/propertyImageStorageService.ts` (ou nome equivalente) com função `savePropertyImages(propertyId, files): Promise<{ url, isCover }[]>`
- [ ] Cria o diretório `uploads/<propertyId>/` se não existir (`fs.mkdir recursive`)
- [ ] Cada arquivo recebe nome `<uuid>.<jpg|png>` — nunca usa `originalname` do cliente (evita path traversal)
- [ ] Extensão derivada do MIME validado, não do nome do arquivo
- [ ] Retorna array com a URL pública (ex: `/uploads/<propertyId>/<uuid>.jpg`) e `isCover` (true apenas para o índice 0)
- [ ] Em caso de falha parcial (ex: disco cheio no 3º arquivo), remove os arquivos já gravados antes de propagar o erro
- [ ] Typecheck passa

### US-003: Atualizar `POST /properties` para aceitar multipart + criar imagens
**Description:** Como locador, quero enviar os dados da propriedade e as fotos em uma única requisição multipart para não precisar fazer duas chamadas.

**Acceptance Criteria:**
- [ ] Rota `POST /properties` agora usa `upload.array('photos', 20)` como middleware antes do controller
- [ ] Campos da propriedade continuam sendo validados por `createPropertySchema` (a partir de `req.body` — multer preenche campos não-arquivo como strings, então schema precisa coerção para números/booleans se ainda não tiver)
- [ ] Se `req.files` contém ao menos 1 arquivo: cria a propriedade, grava os arquivos e cria registros `PropertyImage` (primeiro = capa)
- [ ] Se nenhuma foto for enviada: propriedade é criada normalmente, sem registros em `property_images` (comportamento atual preservado)
- [ ] Tudo dentro de uma `prisma.$transaction` para garantir que property + images são criados juntos
- [ ] Em caso de erro após a gravação dos arquivos (ex: falha no INSERT do PropertyImage), arquivos são removidos do disco
- [ ] Resposta 201 inclui a propriedade com `images: PropertyImage[]` populado
- [ ] Typecheck passa

### US-004: Servir arquivos estáticos de `uploads/` via Express
**Description:** Como frontend, preciso acessar as URLs retornadas (`/uploads/<propertyId>/<uuid>.jpg`) para renderizar as fotos.

**Acceptance Criteria:**
- [ ] `app.use('/uploads', express.static(path.resolve('uploads')))` (ou equivalente absoluto) registrado em `src/app.ts`
- [ ] Requisição a `GET /uploads/<propertyId>/<arquivo>.jpg` retorna 200 com o arquivo e `Content-Type` correto
- [ ] Path traversal bloqueado (comportamento padrão do `express.static`, mas confirmado em teste)
- [ ] Typecheck passa

### US-005: Atualizar validação Zod para multipart
**Description:** Como desenvolvedor, preciso que o `createPropertySchema` continue funcionando quando os dados chegam como `multipart/form-data` (onde todos os campos viram strings).

**Acceptance Criteria:**
- [ ] Campos numéricos (`price`, `bedrooms`, `bathrooms`, `parkingSpots`, `area`, `latitude`, `longitude`, `views`, `condoFee`, `propertyTax`) aceitam string e coagem para number via `z.coerce.number()` (ou preprocess)
- [ ] Campos booleanos (`isFurnished`, `petsAllowed`, `nearSubway`, `isFeatured`) aceitam `"true"`/`"false"` e coagem para boolean
- [ ] Envio via JSON (cenário atual sem fotos, se ainda existir) continua funcionando — regressão zero
- [ ] Typecheck passa

### US-006: Atualizar tratamento de erros para erros de multer
**Description:** Como cliente da API, preciso receber erros claros e padronizados quando envio um arquivo inválido (tipo errado, muito grande, excesso de arquivos).

**Acceptance Criteria:**
- [ ] Handler de erro reconhece `MulterError` e retorna 400 com payload padronizado no mesmo formato dos demais erros da API (`{ status, code, messages }`)
- [ ] Códigos mapeados: `LIMIT_FILE_SIZE` → "Arquivo excede 10MB"; `LIMIT_FILE_COUNT` → "Máximo de 20 fotos por propriedade"; `LIMIT_UNEXPECTED_FILE` / MIME inválido → "Apenas JPEG ou PNG são aceitos"
- [ ] Nenhum stack trace vaza para o cliente
- [ ] Typecheck passa

### US-007: Atualizar documentação Swagger
**Description:** Como consumidor da API, preciso que o Swagger mostre que o endpoint aceita multipart e documente o campo `photos`.

**Acceptance Criteria:**
- [ ] JSDoc Swagger de `POST /properties` atualizado: `requestBody.content` inclui `multipart/form-data` com schema listando todos os campos da propriedade + `photos: { type: array, items: { type: string, format: binary } }`
- [ ] Exemplo de resposta 201 inclui o array `images`
- [ ] Códigos de erro documentados: 400 para validação/upload inválido
- [ ] Swagger renderiza sem erro

### US-008: Testes de integração do upload
**Description:** Como desenvolvedor, quero testes automatizados cobrindo os cenários principais de upload para evitar regressões.

**Acceptance Criteria:**
- [ ] Teste: `POST /properties` com 3 fotos JPEG válidas → 201, retorna 3 `images`, primeira com `isCover=true`
- [ ] Teste: `POST /properties` sem fotos → 201, `images` vazio
- [ ] Teste: envio de arquivo PDF → 400 "Apenas JPEG ou PNG são aceitos"
- [ ] Teste: envio de arquivo > 10MB → 400 "Arquivo excede 10MB"
- [ ] Teste: envio de 21 arquivos → 400 "Máximo de 20 fotos por propriedade"
- [ ] Teste: falha no INSERT PropertyImage não deixa arquivos órfãos em `uploads/<propertyId>/`
- [ ] `npm test` passa

## 4. Functional Requirements

- **FR-1:** A rota `POST /properties` deve aceitar `Content-Type: multipart/form-data` além de `application/json`.
- **FR-2:** O campo de arquivos no multipart deve se chamar `photos` e aceitar múltiplos valores (array).
- **FR-3:** O sistema deve aceitar apenas arquivos com MIME `image/jpeg` ou `image/png`. Qualquer outro tipo retorna 400.
- **FR-4:** Cada arquivo individual não pode exceder 10MB. O total de arquivos por requisição não pode exceder 20.
- **FR-5:** Os arquivos devem ser gravados em `uploads/<propertyId>/<uuid>.<ext>`, onde `<uuid>` é gerado pelo servidor (não aceita nome do cliente) e `<ext>` é derivado do MIME validado.
- **FR-6:** Para cada arquivo persistido, um registro é criado em `property_images` com `url = /uploads/<propertyId>/<uuid>.<ext>`, `propertyId`, e `isCover` (true apenas para o primeiro arquivo do array).
- **FR-7:** A criação da propriedade e a criação dos registros `property_images` devem ocorrer em uma única transação Prisma — se qualquer passo falhar, nada é persistido no banco e os arquivos gravados são removidos do disco.
- **FR-8:** A rota `GET /uploads/*` deve servir os arquivos estaticamente com o `Content-Type` correto.
- **FR-9:** A resposta 201 de `POST /properties` deve incluir o array `images` populado com os registros criados.
- **FR-10:** Erros de upload (tipo inválido, tamanho, contagem) devem retornar 400 no formato padrão da API (`{ status, code, messages: [{ message }] }`).
- **FR-11:** Se nenhuma foto for enviada, a propriedade é criada normalmente com `images: []` (compatibilidade retroativa).

## 5. Non-Goals (Out of Scope)

- **Não** haverá redimensionamento/compressão de imagens no backend (ex: thumbnails, WebP). Frontend é responsável por enviar já otimizado.
- **Não** haverá endpoint separado para adicionar/remover fotos depois da criação (pode vir em PRD futuro).
- **Não** haverá migração para storage em nuvem (Supabase/Firebase Storage/S3) neste ciclo — decisão consciente de começar com filesystem local.
- **Não** haverá detecção de conteúdo malicioso (magic bytes além do MIME, antivírus).
- **Não** haverá autenticação/autorização adicionada a `POST /properties` nesta feature — se necessário, deve ser tratado em PRD separado (nota: a rota atual já está sem auth, o que pode ser um débito).
- **Não** haverá edição do campo `caption` da `PropertyImage` nesta primeira versão.
- **Não** haverá suporte a `coverIndex` customizado — sempre a primeira foto é a capa.

## 6. Design Considerations

- O frontend já tem a tela pronta e envia `multipart/form-data` com campo `photos`. Confirmar com o time de frontend o nome exato do campo antes de implementar.
- URLs retornadas são relativas (`/uploads/...`) — o frontend concatena com a base URL da API para renderizar (`<img src="${API_BASE}${image.url}" />`).
- Reusar o formato de erro já usado pelos demais controllers (`{ status, code, messages: [{ message }] }`).

## 7. Technical Considerations

- **Stack atual:** Express + Prisma + TypeScript. Sem lib de upload instalada — será introduzida `multer` (escolha padrão do ecossistema Express).
- **Storage strategy:** `multer.memoryStorage()` em vez de `diskStorage` — os arquivos só tocam o disco depois que a validação Zod + criação da propriedade passam, evitando lixo em `uploads/` em caso de erro.
- **Transação:** `prisma.$transaction` garante atomicidade do banco; a gravação no filesystem é feita **antes** do commit da transação, com cleanup manual em caso de erro pós-gravação.
- **Validação Zod + multipart:** multer popula `req.body` com todos os campos não-arquivo como strings. O schema `createPropertySchema` precisa usar `z.coerce.*` para campos numéricos/booleanos (ou a rota precisa de um preprocessor). Verificar se o schema atual aceita bem esse cenário — provavelmente requer ajuste.
- **Segurança:**
  - Nunca usar `file.originalname` no path — gerar UUID no servidor.
  - Validar MIME **e** extensão derivada; não confiar apenas no header.
  - `express.static` já bloqueia path traversal por padrão.
- **Persistência em produção:** filesystem local funciona em dev e em instâncias únicas; para escalar horizontalmente será necessário migrar para storage de objetos — registrar como débito técnico, mas fora do escopo.
- **Tamanho do request:** verificar se Express tem `body-parser` com limite baixo que precise ser elevado; multer intercepta antes do body-parser para multipart, então provavelmente não é problema.

## 8. Success Metrics

- Locador consegue criar uma propriedade com 5 fotos em uma única requisição, e as imagens aparecem imediatamente na resposta da API e renderizam na tela de detalhes do frontend.
- Zero arquivos órfãos em `uploads/` após a execução completa da suíte de testes (validado por teste dedicado).
- Todos os cenários de erro retornam payload padronizado no formato da API, sem stack trace.
- Tempo de resposta do `POST /properties` com 10 fotos de ~1MB cada permanece abaixo de 2 segundos em ambiente local.

## 9. Open Questions

- **Autenticação:** A rota atual não tem `checkJwt`/`authSyncMiddleware`. Devemos adicioná-la nesta feature ou em PRD separado? (Decisão atual: fora de escopo, mas registrar como risco.)
- **landlordId:** Vem do body ou deveria vir do JWT do usuário autenticado? (Hoje vem do body — potencial vulnerabilidade.)
- **Nome do campo no frontend:** Confirmar com o frontend se o campo é exatamente `photos` (outras opções comuns: `images`, `files`).
- **Limpeza de `uploads/`:** Precisamos de um job para remover pastas de propriedades deletadas? (Hoje `onDelete: Cascade` apaga registros em `property_images` mas deixa arquivos no disco.)
- **Limite de request total:** multer limita por arquivo (10MB) e contagem (20), mas o total pode chegar a 200MB. Precisamos de um limite agregado?
