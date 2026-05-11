# PRD: Migração de Banco de Dados — Supabase → Postgres Local (co-hospedado com a API)

## 1. Introdução / Visão Geral

A API I-Moveis (ex-AlphaToca) atualmente usa o Supabase (pooler em `aws-1-us-west-2.pooler.supabase.com`) como host gerenciado do Postgres. O objetivo é eliminar essa dependência externa em produção e passar a rodar o Postgres **no mesmo servidor da API** (`desafio01.alphaedtech` / `10.10.0.201`), instalado nativamente via `apt`/`systemd` (sem Docker).

A migração deve preservar **100% dos dados existentes** no Supabase via `pg_dump` → `pg_restore`. Após o cutover, todos os artefatos relacionados ao Supabase devem ser removidos do repositório e do `.env` de produção.

**Escopo:** apenas o ambiente de produção. O fluxo de dev local (já documentado em `.env.example` com Postgres em `127.0.0.1:5444`) não é alterado por este PRD.

## 2. Goals

- Provisionar Postgres nativo (via `apt`) no servidor `desafio01.alphaedtech`, escutando apenas em `127.0.0.1`.
- Migrar **todos** os dados de produção do Supabase para o Postgres local via `pg_dump`/`pg_restore`, sem perda.
- Atualizar o `.env` de produção para que `DATABASE_URL` e `DIRECT_URL` apontem para `127.0.0.1:5432`.
- Validar via smoke tests que a API continua funcional após o cutover (leituras, escritas, login, upload, queue).
- Remover do repositório o diretório `supabase/`, a variável `SUPABASE_ACCESS_TOKEN` e qualquer outra menção de configuração ao Supabase em código/scripts.
- Documentar o procedimento de rollback (re-apontar `.env` de volta para o Supabase) sem exigir backup adicional pré-cutover — o Supabase mantém os dados durante a janela.

## 3. User Stories

### US-001: Provisionar Postgres no servidor de produção
**Description:** Como operador de infraestrutura, quero instalar o Postgres no servidor `desafio01.alphaedtech` para que a API possa apontar para um banco local em vez do Supabase.

**Acceptance Criteria:**
- [ ] Postgres instalado via `apt install postgresql postgresql-contrib` (versão major **igual ou superior** à do Supabase de origem — verificar via `SELECT version();` no Supabase antes; meta: Postgres 16).
- [ ] Serviço `postgresql` ativo e habilitado no `systemd` (`systemctl is-enabled postgresql` retorna `enabled`).
- [ ] `postgresql.conf` configurado com `listen_addresses = 'localhost'` (jamais `*`).
- [ ] `pg_hba.conf` permite apenas conexões locais via `scram-sha-256` (sem `trust`, sem entradas `host ... 0.0.0.0/0`).
- [ ] Role de aplicação `imoveis` (ou nome equivalente acordado) criada com senha forte gerada via `openssl rand -base64 32` e armazenada apenas no `.env` de produção.
- [ ] Database `imoveis` criada, `OWNER` = role de aplicação.
- [ ] Conexão validada via `psql -h 127.0.0.1 -U imoveis -d imoveis -c '\conninfo'` rodando como o usuário do servidor.
- [ ] UFW continua bloqueando a porta 5432 externamente (`sudo ufw status` não lista regra para 5432).

### US-002: Capturar dump completo do Supabase
**Description:** Como operador, quero gerar um `pg_dump` completo do banco Supabase para que toda a base de produção possa ser restaurada localmente.

**Acceptance Criteria:**
- [ ] Dump executado contra a `DIRECT_URL` (porta 5432, **não** o pooler 6543) para evitar problemas com `pg_dump` + PgBouncer transaction-mode.
- [ ] Comando: `pg_dump --format=custom --no-owner --no-privileges --jobs=4 --file=imoveis-supabase-$(date +%Y%m%d-%H%M%S).dump "$SUPABASE_DIRECT_URL"`.
- [ ] Arquivo `.dump` resultante > 0 bytes e listável via `pg_restore --list <arquivo>` sem erro.
- [ ] Tamanho do dump e data registrados no log de execução do cutover (para conferência pós-restore).
- [ ] Cliente `pg_dump` na máquina de origem é da **mesma major version** do Postgres remoto (Supabase) — caso contrário, instalar `postgresql-client-N` correspondente.

### US-003: Restaurar dump no Postgres local
**Description:** Como operador, quero restaurar o dump do Supabase no Postgres local para que o banco de destino contenha os dados de produção.

**Acceptance Criteria:**
- [ ] Dump transferido para o servidor `desafio01` via `scp` (ou gerado diretamente lá com acesso ao Supabase).
- [ ] Restore executado: `pg_restore --no-owner --no-privileges --jobs=4 --dbname=imoveis <arquivo.dump>` rodando como a role de aplicação `imoveis`.
- [ ] Restore termina sem erros fatais. Warnings de extensão ausente (ex.: `pgcrypto`, `uuid-ossp`) são resolvidos via `CREATE EXTENSION IF NOT EXISTS <ext>;` antes do restore — verificar via `pg_restore --list | grep EXTENSION` no dump.
- [ ] Contagem de linhas conferida em pelo menos 5 tabelas críticas (`User`, `Property`, `PropertyImage`, `Lead`, `Conversation`) — totais no local devem **bater exatamente** com o Supabase. Query: `SELECT 'User' AS t, count(*) FROM "User" UNION ALL SELECT 'Property', count(*) FROM "Property" ...`.
- [ ] `npx prisma migrate status` (apontando para o banco local) retorna `Database schema is up to date!` — a tabela `_prisma_migrations` veio junto no dump.
- [ ] Tabelas com colunas `bytea`, `jsonb` ou `tsvector` validadas amostralmente (ex.: 1 row de `Property.embedding` — se aplicável — deve ser legível).

### US-004: Cutover do `.env` de produção e restart da API
**Description:** Como operador, quero atualizar o `.env` de produção para apontar ao Postgres local e reiniciar a API via PM2.

**Acceptance Criteria:**
- [ ] Linhas atuais de `DATABASE_URL` e `DIRECT_URL` no `.env` de produção (apontando para `aws-1-us-west-2.pooler.supabase.com`) são substituídas por:
  - `DATABASE_URL=postgresql://imoveis:<senha>@127.0.0.1:5432/imoveis?schema=public`
  - `DIRECT_URL=postgresql://imoveis:<senha>@127.0.0.1:5432/imoveis?schema=public`
- [ ] Linha `SUPABASE_ACCESS_TOKEN=...` removida do `.env`.
- [ ] Backup do `.env` anterior salvo como `.env.pre-supabase-cutover.bak` no `home` do usuário `desafio01` (apenas no servidor, **não** comitar).
- [ ] `pm2 restart alphatoca-backend --update-env` executado e processo volta a `online` em `pm2 status`.
- [ ] `pm2 logs alphatoca-backend --lines 100` não mostra erros de conexão Postgres nos primeiros 60s pós-restart.

### US-005: Smoke tests pós-cutover
**Description:** Como operador, quero validar que a API continua funcional após o cutover para detectar regressões antes de finalizar a migração.

**Acceptance Criteria:**
- [ ] `GET /health` (ou rota equivalente) retorna 200 via `curl http://localhost:3000/health` no servidor.
- [ ] Login Auth0 funciona em uma conta de teste — `POST` na rota de login retorna token sem 5xx.
- [ ] Listagem de propriedades autenticada retorna o mesmo `count` que retornava antes do cutover (comparar contra screenshot/log prévio).
- [ ] Criação de uma propriedade de teste persiste e aparece em query SQL direta no Postgres local.
- [ ] Worker de fila (BullMQ via Redis) processa pelo menos 1 job sem erro relacionado a banco.
- [ ] Swagger em `http://localhost:3000/docs/` continua renderizando.
- [ ] `npx tsc --noEmit` no servidor passa sem erros novos (caso build seja feito no servidor).

### US-006: Remover artefatos do Supabase do repositório
**Description:** Como mantenedor, quero remover do código todos os vestígios da configuração Supabase para que o projeto não dependa mais dele e para evitar confusão futura.

**Acceptance Criteria:**
- [ ] Diretório `supabase/` (incluindo `supabase/migrations/` e `supabase/.temp/`) removido via `git rm -r supabase/`. Justificativa: o `supabase/migrations/20260426211018_add_location_fields_to_property.sql` está obsoleto — Prisma é a fonte de verdade do schema (40 migrations em `prisma/migrations/`).
- [ ] `SUPABASE_ACCESS_TOKEN` removido de qualquer arquivo `.env*` versionado (`.env.example` já não contém — confirmar via `grep`).
- [ ] `grep -rn "supabase\|SUPABASE" --include="*.ts" --include="*.js" --include="*.json" --include="*.yml" --include="*.yaml"` excluindo `node_modules`, `tasks/`, `documentation/` e `.planning/` retorna **zero** ocorrências.
- [ ] `package.json` não contém dependências `@supabase/*` (já confirmado vazio — manter como verificação).
- [ ] `plan_hospedagem.md` é atualizado: linha 56 (`(que parece ser Supabase pelo histórico)`) e linha 124 (`Ajustar o .env com as configurações de produção (Supabase, ...)`) são reescritas para refletir o Postgres local. **Nota:** o NG-1 do PRD `prd-emergency-localhost-migration.md` proíbe alterar Markdown — esse NG é específico daquela branch de emergência e **não se aplica aqui**; este PRD altera `plan_hospedagem.md` deliberadamente.
- [ ] `npx tsc --noEmit` passa sem erros novos.
- [ ] `npm run dev` local ainda inicializa (não regressão para devs que mantêm seus próprios `.env` apontando para Postgres dev).

### US-007: Documentar procedimento de rollback
**Description:** Como operador, quero ter um runbook de rollback caso o Postgres local apresente problema crítico nas primeiras 72h pós-cutover.

**Acceptance Criteria:**
- [ ] Arquivo `documentation/runbook-rollback-supabase.md` criado contendo:
  - Pré-requisito: o projeto Supabase original (`qkmseleljscluhhrcpaz`) **deve permanecer ativo** por no mínimo 7 dias após o cutover. Documentar a data de cutover e a data limite de descomissionamento.
  - Passo 1: SSH no servidor, restaurar `.env` a partir de `.env.pre-supabase-cutover.bak`.
  - Passo 2: `pm2 restart alphatoca-backend --update-env`.
  - Passo 3: validar via `curl /health` e checagem de log.
  - Aviso: dados criados no Postgres local entre o cutover e o rollback **serão perdidos**. Este é um trade-off aceito (NG-3) — aceitamos esse risco em troca de não manter replicação bidirecional.
- [ ] Runbook lincado a partir de `plan_hospedagem.md` na seção apropriada.

## 4. Functional Requirements

- **FR-1:** O servidor `desafio01.alphaedtech` deve rodar Postgres ≥ 16 instalado via `apt`, gerenciado por `systemd`, escutando apenas em `127.0.0.1:5432`.
- **FR-2:** Uma role de aplicação dedicada (`imoveis`) deve ser criada com senha gerada aleatoriamente; o usuário `postgres` superuser **não** deve ser usado pela aplicação.
- **FR-3:** O dump do Supabase deve ser obtido via `pg_dump --format=custom` contra a `DIRECT_URL` (porta 5432) e restaurado via `pg_restore --jobs=4` no banco local.
- **FR-4:** As variáveis `DATABASE_URL` e `DIRECT_URL` no `.env` de produção devem apontar para `postgresql://imoveis:<senha>@127.0.0.1:5432/imoveis?schema=public` após o cutover.
- **FR-5:** A variável `SUPABASE_ACCESS_TOKEN` deve ser removida do `.env` de produção e nenhum arquivo versionado deve contê-la.
- **FR-6:** O diretório `supabase/` deve ser removido do repositório via `git rm -r`.
- **FR-7:** `npx prisma migrate status` rodando contra o banco local após restore deve retornar status sincronizado, sem migrations pendentes.
- **FR-8:** Após cutover, a API deve passar todos os smoke tests de US-005 antes que o operador declare a migração concluída.
- **FR-9:** Um runbook de rollback documentado deve existir antes de iniciar o cutover.
- **FR-10:** O Postgres local deve ter pelo menos as extensões usadas pelo Supabase no schema atual habilitadas via `CREATE EXTENSION IF NOT EXISTS` antes do restore — descobrir lista via `pg_restore --list <dump> | grep EXTENSION`.

## 5. Non-Goals (Out of Scope)

- **NG-1:** Não migrar nem alterar fluxos de dev local. Devs continuam usando o que já têm (Docker Postgres na porta 5444 conforme `.env.example`, ou Supabase pessoal). Este PRD altera apenas produção.
- **NG-2:** Não configurar replicação, alta disponibilidade, ou Postgres em containers/Docker. Instalação nativa via `apt`, instância única.
- **NG-3:** Não manter sincronização bidirecional Supabase ↔ local após o cutover. Em caso de rollback, dados criados no local após o cutover são perdidos.
- **NG-4:** Não configurar backups automatizados do Postgres local (`pg_dump` cron, WAL archiving, S3 offload). Recomendado para um PRD subsequente — fora do escopo deste.
- **NG-5:** Não tomar pg_dump pré-cutover como "safety net" adicional. O Supabase mantém seus dados durante a janela de cutover; o dump da migração já é o ponto-de-restauro.
- **NG-6:** Não alterar a aplicação (código TypeScript, Prisma schema, queries) — a migração é puramente de infraestrutura + env. Se o restore expor incompatibilidades de schema, abrir issue separada.
- **NG-7:** Não cancelar a conta Supabase imediatamente. Manter ativa por ≥ 7 dias após o cutover como rede de segurança (ver US-007).
- **NG-8:** Não alterar `prd-emergency-localhost-migration.md` nem o trabalho daquela branch. Os dois PRDs são independentes (aquele substitui URLs `lab.alphaedtech` por `localhost` em código de URLs de imagem; este migra o **banco**).

## 6. Technical Considerations

### Banco de origem (Supabase)
- Host atual: `aws-1-us-west-2.pooler.supabase.com`
- Pooler: `:6543` (PgBouncer transaction mode) — **não usar** para `pg_dump`.
- Direct: `:5432` — usar para o dump.
- Project ID inferido do connection string: `qkmseleljscluhhrcpaz`.

### Banco de destino (Postgres local)
- Host: `127.0.0.1:5432` (instância única, sem PgBouncer).
- Como Prisma fica conectado a uma única instância sem pooler externo, `DATABASE_URL` e `DIRECT_URL` podem apontar para a mesma URL. Manter ambos no `.env` para não quebrar `prisma/schema.prisma` (que pode usar `directUrl`).
- Tunning mínimo recomendado pós-instalação (ajustar conforme RAM do servidor): `shared_buffers = 25% RAM`, `effective_cache_size = 50% RAM`, `work_mem = 16MB`. Documentar no runbook mas não exigir como AC.

### Extensões
- Supabase tipicamente habilita `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `pg_graphql`, `pgjwt`, `vault`, etc. A maioria **não é usada** pelo schema da aplicação — apenas as referenciadas via `gen_random_uuid()` ou similares importam. Validar via `pg_restore --list <dump> | grep EXTENSION` e habilitar apenas as necessárias.

### Prisma
- `prisma/schema.prisma` aponta `datasource db.url = env("DATABASE_URL")`. Não precisa alterar o `schema.prisma`.
- A tabela `_prisma_migrations` virá junto no dump. Após restore, `npx prisma migrate status` deve mostrar tudo sincronizado. Se o `_prisma_migrations` estiver corrompido por algum motivo, fallback é `npx prisma migrate resolve --applied <migration>` para cada migration.

### Riscos conhecidos
- **Mismatch de versão Postgres cliente/servidor:** se `pg_dump` da máquina de origem for de uma major version inferior ao Supabase, o dump pode falhar ou produzir formato incompatível. Mitigação: instalar `postgresql-client-16` (ou versão correspondente) na máquina que executa o dump.
- **Tamanho do dump:** dependendo do volume de dados, transfer + restore pode demorar. Estimar via `SELECT pg_size_pretty(pg_database_size('postgres'));` no Supabase antes — se > 5GB, planejar janela de manutenção mais longa.
- **Charset/Collation:** Supabase usa `LC_COLLATE = 'en_US.UTF-8'` por padrão. Se o servidor `desafio01` for `pt_BR.UTF-8` ou `C`, ordenações de query podem diferir. Criar a database local com `TEMPLATE template0 LC_COLLATE 'en_US.UTF-8' ENCODING 'UTF8'` para preservar.
- **Locale instalado no servidor:** `sudo locale-gen en_US.UTF-8` antes de criar a database, caso ainda não esteja gerado.

### Ordem de execução recomendada
1. US-001 (provisionar Postgres) — pode ser feito antecipadamente, sem janela de manutenção.
2. US-007 (escrever runbook) — antes da janela.
3. **Início da janela:** US-002 (dump) → US-003 (restore) → US-005 fase 1 (smoke contra DB local **com API ainda apontando para Supabase**, via psql) → US-004 (cutover .env) → US-005 fase 2 (smoke contra API live).
4. **Pós-janela:** US-006 (limpeza de repo, abrir PR).
5. Após 7 dias estáveis: descomissionar Supabase (fora do escopo).

## 7. Success Metrics

- API em produção respondendo via Postgres local em `127.0.0.1:5432` — `pg_stat_activity` mostra conexões da app.
- Zero ocorrências de `aws-1-us-west-2.pooler.supabase.com`, `qkmseleljscluhhrcpaz`, `SUPABASE_ACCESS_TOKEN` ou `supabase.com` em arquivos versionados.
- Contagens de linhas em tabelas críticas batem 1:1 com o Supabase pré-cutover.
- Tempo total de janela de cutover: < 2h (alvo, depende do tamanho do dump).
- Latência média de queries melhora ou se mantém estável (rede local elimina ~50ms de RTT até `us-west-2`).
- Zero erros 5xx atribuíveis ao banco nas primeiras 24h pós-cutover.

## 8. Open Questions

- Qual o tamanho atual da database no Supabase? (Roda `SELECT pg_size_pretty(pg_database_size(current_database()));` antes da janela para dimensionar.)
- O servidor `desafio01.alphaedtech` tem RAM/disk suficientes para hospedar Postgres + API + Redis simultaneamente? Verificar `free -h` e `df -h` antes de US-001.
- Backups automatizados do Postgres local (NG-4): abrir PRD separado imediatamente após este, ou aceitar gap temporário? Decisão de produto.
- O frontend mobile/web fala diretamente com o Supabase em alguma rota (RLS, Realtime, Storage)? Pelo grep, **não** — o backend é o único intermediário, e o backend não usa SDK Supabase. Confirmar com a equipe de frontend antes do cutover.
- Após o período de 7 dias, quem é responsável por descomissionar a conta Supabase (cancelar projeto, exportar billing, revogar tokens)?
