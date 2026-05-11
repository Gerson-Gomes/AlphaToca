# I-Moveis API

O I-Moveis é uma API backend projetada para uma plataforma de aluguel de apartamentos. O sistema utiliza o WhatsApp como o canal principal de geração e qualificação de leads, realizando uma transição suave dos usuários qualificados para o aplicativo móvel/web para a descoberta e visualização detalhada de imóveis.

## Visão Geral

A plataforma atende a três públicos principais:
- **Inquilinos**: Procuram apartamentos e interagem primariamente via WhatsApp para triagem e dúvidas.
- **Proprietários/Administradores**: Gerenciam anúncios de imóveis e recebem leads pré-qualificados automaticamente.
- **Corretores de Imóveis**: Utilizam a plataforma para automatizar o primeiro contato e a filtragem de interessados.

### Principais Funcionalidades
- **Integração Direta com WhatsApp**: Webhook otimizado para processamento de mensagens recebidas e envio de respostas orientadas por IA.
- **Sistema RAG (Retrieval-Augmented Generation)**: Qualificação de leads, entendimento de intenções e respostas a perguntas frequentes de forma automatizada e inteligente.
- **API de Busca de Imóveis**: Listagem, busca e administração de dados imobiliários que alimentam as interfaces web e mobile.
- **Transição de Canal Unificada**: Sincronia de estado para uma experiência contínua entre a conversa no WhatsApp e a visualização no aplicativo.

## Stack Tecnológica

O I-Moveis é construído sobre uma arquitetura moderna para suportar alto desempenho e integração com IA:

- **Linguagem e Runtime**: TypeScript no Node.js.
- **Framework Web**: Express.
- **Banco de Dados**: PostgreSQL com extensão `pgvector` (armazenamento de dados relacionais e vetoriais).
- **ORM**: Prisma.
- **Autenticação e Identidade**: Auth0 (JSON Web Tokens - JWT).
- **Mensageria e Processamento em Background**: Redis e BullMQ (processamento assíncrono essencial para os fluxos de IA do WhatsApp).
- **Inteligência Artificial (IA/RAG)**: LangChain (versão Node.js).
- **Validação de Dados**: Zod.

## Como Interagir com a API

### Autenticação (Rotas Protegidas)

As rotas da aplicação (como as de gerenciamento em `/api/properties` e `/api/users`) são seguras e exigem um **Token Bearer JWT** emitido pelo Auth0.

Para se autenticar, você deve adicionar o cabeçalho `Authorization` nas requisições:

```http
Authorization: Bearer <SEU_TOKEN_JWT>
```

### Validação de Dados

Todos os payloads recebidos pela API (seja pelo app mobile ou pelos webhooks) são rigidamente validados utilizando o **Zod**. Qualquer envio que não esteja de acordo com as regras estabelecidas será imediatamente negado.

### Tratamento de Erros

A API possui respostas curtas, técnicas e padronizadas. Sempre que ocorrer um erro, o retorno seguirá a estrutura global `ErrorResponse`, acompanhado do status HTTP apropriado:

```json
{
  "status": 400,
  "code": "BAD_REQUEST",
  "messages": [
    "A mensagem detalhada sobre o que ocorreu, por exemplo, um erro de validação Zod."
  ]
}
```
*O bot integrado via WhatsApp possui mecanismos de contingência; em caso de incertezas da IA, ele responde com fallbacks predeterminados sem comprometer a interação amigável.*

### Principais Interfaces

1. **Gestão de Imóveis e Usuários**
   - Endpoints como `/api/properties` e `/api/users` proveem acesso para o app. Exigem autenticação e fornecem apenas os dados estritamente relevantes visando a economia de dados em redes móveis.

2. **Webhooks do WhatsApp**
   - O tráfego de entrada e as notificações da WhatsApp Cloud API são direcionados aos endpoints de webhook. 
   - A API valida a carga e a enfileira imediatamente em uma fila do BullMQ (retornando `200 OK` instantaneamente para o WhatsApp). O processamento complexo das mensagens e a interação com o LangChain ocorrem de forma assíncrona.

## Rodando localmente (branch hospedagem_local)

Esta seção descreve o setup completo para rodar a API I-Moveis end-to-end em `http://localhost:3000`, com **Postgres nativo + Redis Docker + integrações reais** (Firebase Auth, Gemini, WhatsApp Cloud API, LangSmith). Estratégia adotada: feature flags reversíveis em `src/server.ts`, sem alterar lógica de negócio, controllers, services, routes ou schemas Prisma.

### Pré-requisitos

- **Node.js 20+** (LTS recomendado).
- **Docker** (necessário para Redis; Postgres em Docker é opcional via perfil `optional-db`).
- **Postgres 16 nativo** em `127.0.0.1:5432`, com role `imoveis` e database `imoveis` — provisione executando [`scripts/db-migration/01-provision-postgres.sh`](scripts/db-migration/01-provision-postgres.sh).
- **Credenciais de dev** preenchidas no `.env` (a partir de `.env.example`):
  - Firebase service account: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
  - `GOOGLE_API_KEY` (Google AI Studio — Gemini 2.5 Flash + embeddings).
  - `FIREBASE_API_KEY` (Firebase Web API Key — usada para login via REST API).

### Setup passo-a-passo

1. **Copiar e editar o `.env`:**
   ```bash
   cp .env.example .env
   # editar .env: preencher credenciais reais (Firebase, Gemini, WhatsApp, LangSmith)
   ```

2. **Subir Redis (Docker, porta host `6380`):**
   ```bash
   docker compose up -d redis
   ```

3. **(Opcional) Subir Postgres em Docker** caso não tenha Postgres nativo instalado. O perfil `optional-db` mapeia o container na porta host `5433` para evitar conflito com Postgres nativo em `5432`:
   ```bash
   docker compose --profile optional-db up -d
   # após este passo, ajuste DATABASE_URL e DIRECT_URL no .env para porta 5433
   ```

4. **Aplicar migrations Prisma:**
   ```bash
   npx prisma migrate deploy
   ```

5. **Popular o banco com dados de demo:**
   ```bash
   npm run seed
   ```

6. **Subir o servidor de desenvolvimento:**
   ```bash
   npm run dev
   ```

### Validação

Após `npm run dev`, valide o setup chamando o health check:

```bash
curl http://localhost:3000/health/ready
```

A resposta deve ser **HTTP 200** com `status: ready` e todos os checks (`db`, `redis`, `gemini`) reportando `ok`. Caso algum check falhe, o endpoint retorna 503 com o componente em estado `fail`.

### Feature flags de debug

Duas flags reversíveis em `src/server.ts` permitem rodar a API em modos degradados durante debug local. Ambas têm default `false` (comportamento normal preservado) e estão documentadas como entradas comentadas no `.env.example`:

- **`DISABLE_WORKERS=true`** — pula os imports dinâmicos dos workers BullMQ (`whatsappWorker`, `visitReminderWorker`). Útil para testar apenas endpoints HTTP/WebSocket sem disparar jobs reais. Atenção: enquanto a flag estiver ativa, filas de WhatsApp e lembretes de visita **não** processam jobs.
- **`DISABLE_RAG_VALIDATION=true`** — pula `assertRagSecrets()` no boot. Útil para iniciar a API rapidamente em sessões sem chave Gemini válida. Atenção: endpoints RAG vão falhar em runtime quando esta flag estiver ativa.

### Notas

- **Auth real (Firebase Admin SDK):** o middleware `checkJwt` (`src/middlewares/authMiddleware.ts`) valida tokens via **Firebase Admin SDK** — não Auth0, apesar de `.env.example` ainda conter as vars `AUTH0_*` como artefato histórico. Testes locais de rotas autenticadas exigem um token Firebase real, gerado via Firebase REST API ou app cliente.
- **Gemini cota free:** Google AI Studio tem limite de **5 RPM** no free tier. Para smoke tests RAG sequenciais, ajuste `EVAL_INTER_QUESTION_DELAY_MS` ou espace as chamadas manualmente para evitar `429 Too Many Requests`.
- **WhatsApp webhook:** a Meta exige URL pública para validar o webhook. Em local, use **ngrok** (ou similar) para expor `http://localhost:3000/api/webhook` — fora do escopo do setup local básico.

### PRDs relacionados

- [`tasks/prd-emergency-localhost-migration.md`](tasks/prd-emergency-localhost-migration.md) — migração emergencial de URLs de produção para localhost.
- [`tasks/prd-supabase-to-localhost-db-migration.md`](tasks/prd-supabase-to-localhost-db-migration.md) — migração do banco de Supabase para Postgres nativo.
- [`tasks/prd-hospedagem-local.md`](tasks/prd-hospedagem-local.md) — PRD desta feature (rodar API end-to-end em localhost com feature flags).

## Re-seeding after the UUID migration

Older demo seeds inserted human-readable ids like `user-demo-landlord-1` and `prop-demo-rj-1`. These fail the strict `z.string().uuid()` validators in `src/utils/`, so any environment holding those legacy rows must be dropped and re-seeded with the new canonical UUID literals exported from `prisma/demoIds.ts`.

> **Warning:** Never run `prisma migrate` or `prisma db seed` against the production `DATABASE_URL` in `.env` — that URL points at the production Postgres on the API host. Always override `DATABASE_URL` inline to the local Docker database (`alphatoca_db` on `127.0.0.1:5433`, user `admin`, password `admin_pwd`, database `alphatoca`).

### Local re-seed flow

From a clean local database:

```bash
# 1. Drop every table, re-run all migrations, and skip the default seed hook
DATABASE_URL='postgresql://admin:admin_pwd@127.0.0.1:5433/alphatoca?schema=public' \
DIRECT_URL='postgresql://admin:admin_pwd@127.0.0.1:5433/alphatoca?schema=public' \
  npx prisma migrate reset --force

# 2. Or, if the schema is already up-to-date and you only need fresh demo rows,
#    the seed script's own deleteMany() chain is enough on its own:
DATABASE_URL='postgresql://admin:admin_pwd@127.0.0.1:5433/alphatoca?schema=public' \
DIRECT_URL='postgresql://admin:admin_pwd@127.0.0.1:5433/alphatoca?schema=public' \
  npm run seed
```

`npm run seed` is a thin wrapper over `ts-node prisma/seed.ts`, which calls `deleteMany()` on every table before inserting the rows in `prisma/demoData.ts`. The seed uses the UUID constants from `prisma/demoIds.ts` as primary keys, so every row lands with an id that passes `z.string().uuid()`.

### Verifying the round-trip

After re-seeding, confirm every user and property row carries a canonical UUID v4:

```bash
DATABASE_URL='postgresql://admin:admin_pwd@127.0.0.1:5433/alphatoca?schema=public' \
DIRECT_URL='postgresql://admin:admin_pwd@127.0.0.1:5433/alphatoca?schema=public' \
  npx tsx -e "import prisma from './src/config/db'; Promise.all([prisma.user.findMany(), prisma.property.findMany()]).then(([us, ps]) => { const re=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$/i; const badU=us.filter(u=>!re.test(u.id)); const badP=ps.filter(p=>!re.test(p.id)); if(badU.length||badP.length){console.error('NON-UUID users:',badU.map(u=>u.id),'properties:',badP.map(p=>p.id)); process.exit(1);} console.log('OK users:',us.length,'properties:',ps.length); process.exit(0); });"
```

The script exits `0` and prints `OK users: <n> properties: <m>` when every id passes the strict UUID v4 regex. It exits `1` and lists offending rows otherwise.
