# PRD: Hospedagem Local — Rodar API Inteira em `localhost`

## 1. Introdução / Visão Geral

O servidor remoto (`desafio01.alphaedtech` / `10.10.0.201`) está fora do ar, bloqueando testes end-to-end da API I-Moveis (ex-AlphaToca). Esta feature cria o branch `hospedagem_local` e refatora o backend, com mudanças mínimas e reversíveis, para que toda a API rode em `http://localhost:3000` contra dependências locais (Postgres nativo + Redis em Docker), mantendo as integrações externas reais (Firebase Auth, Gemini, WhatsApp Cloud API, LangSmith) usando credenciais de desenvolvimento já presentes no `.env`.

A estratégia adotada é **feature flags mínimas no código** (sem reescrever camadas), para que o branch possa ser descartado ou mesclado sem deixar dívida arquitetural. O alvo de validação é que o desenvolvedor rode `npm run dev` (após `docker compose up -d redis` e Postgres nativo já provisionado) e consiga exercer **todos** os endpoints HTTP + workers BullMQ + WebSocket end-to-end localmente.

## 2. Goals

- Documentar e tornar reproduzível, em menos de 15 minutos, o setup local completo da API a partir de uma máquina limpa com Postgres 16 instalado nativamente.
- Garantir que **todos** os endpoints (`/api/*`), workers (`whatsappWorker`, `visitReminderWorker`) e WebSocket inicializem e respondam localmente sem depender de servidor remoto.
- Adicionar feature flags reversíveis (sem remover código de produção) para tolerar ausência opcional de integrações pesadas durante debug pontual, mas com **default** de manter todas reais.
- Atualizar `.env.example` para refletir Postgres em `127.0.0.1:5432` (porta padrão nativa) ao invés de `5444` (Docker).
- Permitir que `/health/ready` retorne `200` com `db`, `redis` e `gemini` todos `ok` em ambiente local.
- Não modificar a lógica de negócio, schemas Prisma, rotas existentes ou contratos públicos da API.

## 3. User Stories

### US-001: Criar branch `hospedagem_local` a partir de `main`
**Description:** Como desenvolvedor, quero um branch dedicado para isolar as mudanças de hospedagem local, mantendo `main` intacto.

**Acceptance Criteria:**
- [ ] Branch `hospedagem_local` criado a partir do HEAD atual de `main` (`5163643`).
- [ ] Working tree limpo após o `checkout`.
- [ ] Branch publicado localmente; push remoto fica a critério do usuário.

### US-002: Adicionar serviço Postgres ao `docker-compose.yml` como alternativa opcional
**Description:** Como desenvolvedor que não tem Postgres nativo instalado, quero a opção (não default) de subir Postgres via Docker, mantendo a escolha de Postgres nativo (decisão 2B) como caminho principal documentado.

**Acceptance Criteria:**
- [ ] `docker-compose.yml` ganha um serviço `postgres` opcional (perfil `optional-db` ou comentado) com Postgres 16, porta `5432:5432`, volume nomeado para persistência.
- [ ] README documenta claramente que o **default** é Postgres nativo em `127.0.0.1:5432`, e o serviço Docker é fallback.
- [ ] `docker compose up -d redis` continua funcionando inalterado.
- [ ] `npx tsc --noEmit` passa sem erros novos (não há código TS afetado, mas roda como sanity check).

### US-003: Atualizar `.env.example` para apontar para Postgres nativo em 5432
**Description:** Como desenvolvedor seguindo o setup, quero que `.env.example` reflita a infraestrutura local real (Postgres nativo em 5432, não 5444 do Docker antigo) para evitar confusão.

**Acceptance Criteria:**
- [ ] `DATABASE_URL` em `.env.example` aponta para `postgresql://imoveis:<senha>@127.0.0.1:5432/imoveis?schema=public` (alinhado com `scripts/db-migration/01-provision-postgres.sh`).
- [ ] `DIRECT_URL` adicionado com mesmo valor (necessário para `prisma migrate`).
- [ ] `REDIS_URL` permanece `redis://127.0.0.1:6380` (Docker).
- [ ] Comentário acima das variáveis explica: "Postgres nativo (default) — para Docker, use perfil `optional-db` e troque a porta para 5433".
- [ ] `.env` real do desenvolvedor **não** é commitado (já está no `.gitignore`).

### US-004: Adicionar feature flag `DISABLE_WORKERS` (default `false`)
**Description:** Como desenvolvedor que quer só testar HTTP sem disparar jobs reais, quero poder desabilitar workers via env var, mantendo o comportamento padrão (workers ativos) inalterado.

**Acceptance Criteria:**
- [ ] `src/server.ts` lê `process.env.DISABLE_WORKERS` antes dos `import './workers/...'`.
- [ ] Quando `DISABLE_WORKERS=true`, os imports de worker são pulados (via import dinâmico condicional), e o logger emite `[server] workers desabilitados via DISABLE_WORKERS`.
- [ ] Default (`undefined` ou `false`): comportamento atual preservado — ambos workers iniciam.
- [ ] `.env.example` ganha entrada comentada: `# DISABLE_WORKERS=false`.
- [ ] `npx tsc --noEmit` passa sem erros novos.

### US-005: Adicionar feature flag `DISABLE_RAG_VALIDATION` (default `false`)
**Description:** Como desenvolvedor sem chave Gemini válida em alguma sessão de debug, quero poder pular o `assertRagSecrets()` para iniciar a API rapidamente, sem alterar o default fail-fast em produção.

**Acceptance Criteria:**
- [ ] `src/server.ts` envolve `assertRagSecrets()` numa checagem: se `process.env.DISABLE_RAG_VALIDATION === 'true'`, pula a chamada e loga warn `[server] RAG secret validation pulada via flag — RAG endpoints podem falhar`.
- [ ] Default mantém `assertRagSecrets()` ativo (decisão 3C).
- [ ] `.env.example` ganha entrada comentada: `# DISABLE_RAG_VALIDATION=false`.
- [ ] `npx tsc --noEmit` passa sem erros novos.

### US-006: Garantir que `/health/ready` reporte `200` localmente
**Description:** Como desenvolvedor, quero que após `npm run dev` o endpoint `/health/ready` retorne `200` com `db: ok`, `redis: ok`, `gemini: ok` para confirmar setup correto antes de testar fluxos.

**Acceptance Criteria:**
- [ ] Com Postgres nativo + Redis Docker + `.env` preenchido, `curl http://localhost:3000/health/ready` retorna HTTP 200 e `{"status":"ready",...}`.
- [ ] Com Redis parado, retorna 503 e `redis: fail` (validação negativa).
- [ ] Comportamento e código do endpoint **não** são alterados — esta US é apenas validação de que o setup funciona.

### US-007: Documentar setup local completo no README
**Description:** Como desenvolvedor novo no projeto, quero um passo-a-passo claro no README descrevendo como rodar a API localmente do zero (Postgres nativo, Redis Docker, env, migrations, seed, dev server).

**Acceptance Criteria:**
- [ ] `README.md` ganha (ou atualiza) seção "## Rodando localmente (branch `hospedagem_local`)" com:
  1. Pré-requisitos: Node 20+, Docker, Postgres 16 nativo (ou link para `scripts/db-migration/01-provision-postgres.sh`).
  2. Comandos: `cp .env.example .env`, editar credenciais reais de dev (Firebase, Gemini, etc).
  3. `docker compose up -d redis`.
  4. `npx prisma migrate deploy && npm run seed`.
  5. `npm run dev`.
  6. Validação: `curl http://localhost:3000/health/ready` deve retornar 200.
- [ ] Seção menciona feature flags `DISABLE_WORKERS` e `DISABLE_RAG_VALIDATION` como debug aids opcionais.
- [ ] Seção referencia os PRDs anteriores relacionados (`prd-emergency-localhost-migration.md`, `prd-supabase-to-localhost-db-migration.md`) para histórico.

### US-008: Smoke test manual end-to-end localmente
**Description:** Como desenvolvedor, quero validar manualmente que ao menos um fluxo representativo de cada categoria de endpoint funciona localmente antes de declarar o branch pronto.

**Acceptance Criteria:**
- [ ] `POST /api/auth/register` (auth público) — cria usuário, retorna 201.
- [ ] `GET /api/properties` (rota autenticada com JWT Firebase real de dev) — retorna 200 com array.
- [ ] WebSocket: cliente conecta em `ws://localhost:3000` e recebe handshake — sem erros no log do server.
- [ ] Worker `whatsappWorker`: ao enfileirar um job de teste via Redis CLI ou rota mock, o worker processa e loga.
- [ ] Worker `visitReminderWorker`: inicializa sem erro (não precisa disparar lembrete real).
- [ ] Swagger UI renderiza em `http://localhost:3000/docs/`.
- [ ] Resultados anotados como comentário no PR ou em `tasks/smoke-hospedagem-local.md` (criado se necessário).

## 4. Functional Requirements

- **FR-1:** Branch `hospedagem_local` deve ser criado a partir do HEAD de `main` e conter todas as mudanças deste PRD em commits atômicos.
- **FR-2:** `docker-compose.yml` deve permitir subir apenas Redis (`docker compose up -d redis`) sem mudanças no fluxo atual; Postgres opcional fica em perfil ou serviço comentado.
- **FR-3:** `.env.example` deve refletir Postgres nativo em `127.0.0.1:5432` com role `imoveis` e database `imoveis`, e incluir `DIRECT_URL`.
- **FR-4:** `src/server.ts` deve respeitar a flag `DISABLE_WORKERS=true` pulando os imports de workers, mantendo `false`/ausente como comportamento default.
- **FR-5:** `src/server.ts` deve respeitar a flag `DISABLE_RAG_VALIDATION=true` pulando `assertRagSecrets()`, mantendo a validação ativa por default.
- **FR-6:** Nenhuma rota, schema, controller ou service de produção pode ter sua lógica alterada — mudanças ficam restritas a `server.ts`, `.env.example`, `docker-compose.yml`, `README.md` e (se aplicável) `tasks/`.
- **FR-7:** `npx tsc --noEmit` deve passar sem novos erros após todas as mudanças.
- **FR-8:** O comando `npm run dev` deve iniciar a API, conectar ao Postgres nativo, ao Redis Docker, validar Firebase + Gemini, e responder em `http://localhost:3000` com workers ativos por default.
- **FR-9:** README deve conter o procedimento de setup completo replicável em uma máquina limpa (com Postgres nativo já instalado).

## 5. Non-Goals (Out of Scope)

- **Não** alterar `prisma/schema.prisma`, migrations, ou seed para apontar a `localhost`. A migração de URLs para `localhost` em dados de demo já foi tratada pelo PRD `prd-emergency-localhost-migration.md`.
- **Não** mockar nem stubar Auth0/Firebase, Gemini, WhatsApp ou LangSmith — a decisão (3C) é manter todas integrações reais com credenciais de dev.
- **Não** introduzir nova camada de abstração (provider local vs remoto) — a decisão (5A) é feature flags mínimas.
- **Não** alterar contratos públicos das rotas, payloads, schemas Zod ou regras de autorização.
- **Não** configurar Nginx, PM2, certificados SSL ou qualquer artefato de deploy remoto — fora do escopo (foco é apenas `localhost`).
- **Não** rodar testes de integração automatizados de cada endpoint — o smoke test manual em US-008 é suficiente.
- **Não** criar nem migrar dados de produção. O banco local começa vazio e é populado via seed existente.
- **Não** reverter ou desfazer migrações já aplicadas em produção (Supabase → Postgres nativo).
- **Não** mudar a porta default `3000` da API.

## 6. Design Considerations

- **Reutilizar** o serviço `redis` existente no `docker-compose.yml` — não duplicar.
- **Reutilizar** o script `scripts/db-migration/01-provision-postgres.sh` para provisionamento Postgres nativo (já existente, validado).
- Feature flags devem seguir o padrão `process.env.NOME === 'true'` (string match), consistente com `LANGCHAIN_TRACING_V2` e outras já presentes no projeto.
- Logs de "modo degradado" (worker desabilitado, RAG validation pulada) devem usar `logger.warn` com prefixo `[server]`, alinhado com convenção existente em `src/server.ts`.

## 7. Technical Considerations

- **Auth real:** O middleware `checkJwt` (`src/middlewares/authMiddleware.ts`) usa Firebase Admin SDK (não Auth0, apesar de `.env` mencionar Auth0 — possível artefato histórico). Testes locais exigem token Firebase real; o desenvolvedor precisa gerar um via Firebase REST API ou app cliente. Documentar isso no README.
- **Gemini cota:** Free tier é 5 RPM. Smoke tests devem espaçar chamadas RAG ou ajustar `EVAL_INTER_QUESTION_DELAY_MS`.
- **WhatsApp webhooks:** Webhook da Meta exige URL pública. Em local, ngrok é necessário para testar webhook end-to-end (fora do escopo deste PRD; documentar como nota).
- **Postgres nativo vs Docker:** Conflito de portas — se desenvolvedor já tem Postgres em 5432, o serviço Docker (se ativado) deve usar 5433.
- **Imports condicionais de worker:** `import './workers/...'` é estático em `server.ts`. Para suportar `DISABLE_WORKERS`, usar `await import('./workers/whatsappWorker')` dentro de bloco condicional, transformando `server.ts` num módulo com top-level await ou IIFE async.
- **`alphatoca-dev-firebase-adminsdk-*.json`:** Arquivo de service account já no repo. Verificar se está no `.gitignore` (segurança); fora do escopo corrigir se não estiver, mas sinalizar.

## 8. Success Metrics

- Setup local da máquina limpa até `/health/ready === 200` em **menos de 15 minutos** seguindo o README.
- **Zero** alterações em `src/controllers/`, `src/services/`, `src/routes/`, `src/schemas/`, `prisma/schema.prisma`.
- `git diff main..hospedagem_local` toca no máximo: `src/server.ts`, `.env.example`, `docker-compose.yml`, `README.md`, `tasks/prd-hospedagem-local.md` (e possivelmente `tasks/smoke-hospedagem-local.md`).
- Smoke test US-008 passa em todos os 6 itens.

## 9. Open Questions

- O usuário quer push do branch `hospedagem_local` para `origin` ao final, ou apenas branch local?
- Existe algum endpoint específico além dos listados em US-008 que precisa de validação extra (ex: chat com WebSocket + RAG, fluxo de pagamento, upload de fotos)?
- O `.env` real de dev (com chaves Firebase/Gemini reais) já está preenchido na máquina, ou precisamos de um passo de obtenção dessas credenciais?
- Branch é descartável após servidor voltar, ou virará base permanente do fluxo de desenvolvimento local? (Afeta decisão sobre merge para `main` no futuro.)
- O Auth0 mencionado no `.env.example` (`AUTH0_AUDIENCE`, `AUTH0_ISSUER_BASE_URL`, etc.) é dead code ou ainda usado em algum middleware não mapeado? Investigar antes de remover.
