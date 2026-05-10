# PRD: Emergency Migration — API de Servidor para Localhost

## 1. Introdução / Visão Geral

Branch de emergência (`emergency`) para reverter o backend I-Moveis (ex-AlphaToca) de operação no servidor de produção (`lab.alphaedtech.org.br/server01`) para execução local em `http://localhost:3000`. Toda menção de URL hardcoded apontando para o servidor de produção/lab deve ser substituída por `http://localhost:3000`, incluindo:

- Configuração de servers no Swagger
- URLs de imagens de demonstração no seed (`prisma/demoData.ts`)
- Script utilitário `update_urls.ts` (lógica deve ser invertida: lab → localhost)

Após a substituição no código, o seed deve ser re-executado para que o banco fique consistente com os novos URLs de demonstração.

## 2. Goals

- Substituir todas as menções a `lab.alphaedtech.org.br/server01` (com ou sem `/api`, em `http` ou `https`) por `http://localhost:3000` nos arquivos de código executável.
- Inverter a direção do script `update_urls.ts` para migrar URLs existentes de lab para localhost (o oposto do comportamento atual).
- Re-executar o seed (`prisma/demoData.ts`) para que o banco de dados local reflita os novos URLs de demonstração.
- Garantir que a API continue inicializando, o Swagger renderize com server único de localhost, e os URLs de imagem de demo sejam acessíveis via `http://localhost:3000`.

## 3. User Stories

### US-001: Atualizar Swagger para usar apenas servidor localhost
**Description:** Como desenvolvedor rodando a API localmente, quero que o Swagger UI liste apenas o servidor de localhost para que eu não envie requisições acidentalmente para o servidor de produção.

**Acceptance Criteria:**
- [ ] Em `src/config/swagger.ts`, o array `servers` contém apenas uma entrada: `url: 'http://localhost:3000'`, com descrição apropriada (ex.: `Servidor Local`).
- [ ] A entrada antiga `https://lab.alphaedtech.org.br/server01` foi removida.
- [ ] A entrada redundante `http://localhost:3000/api` (que tinha sufixo `/api`) também foi consolidada/removida — o array final tem 1 server.
- [ ] `npx tsc --noEmit` passa sem erros novos.
- [ ] API inicia com `npm run dev` e Swagger renderiza em `http://localhost:3000/docs/`.

### US-002: Substituir URLs de imagens de demo no seed
**Description:** Como desenvolvedor, quero que as URLs das imagens de demonstração no `demoData.ts` apontem para `http://localhost:3000` para que o frontend local consiga renderizar as fotos sem depender do servidor de produção.

**Acceptance Criteria:**
- [ ] Em `prisma/demoData.ts`, todas as 10 ocorrências de URL no array de imagens (linhas ~332 a ~404) foram substituídas:
  - `https://lab.alphaedtech.org.br/server01/api/uploads/...` → `http://localhost:3000/uploads/...`
  - `http://lab.alphaedtech.org.br/server01/api/uploads/...` → `http://localhost:3000/uploads/...`
- [ ] Nenhuma menção a `lab.alphaedtech` ou `server01` permanece em `prisma/demoData.ts`.
- [ ] `npx tsc --noEmit` passa sem erros novos.

### US-003: Inverter lógica do script update_urls.ts
**Description:** Como desenvolvedor, quero que o script `update_urls.ts` migre URLs existentes no banco de `lab.alphaedtech` para `localhost` (o inverso do comportamento atual), permitindo regularizar dados pré-existentes durante a emergência.

**Acceptance Criteria:**
- [ ] `update_urls.ts` detecta URLs contendo `lab.alphaedtech.org.br/server01/api` (e variantes `http`/`https`) e as substitui pelo prefixo `http://localhost:3000`.
- [ ] O script preserva o caminho relativo após `/api/` (ex.: `/uploads/{propertyId}/0001.png` permanece intacto).
- [ ] Se já existe alguma normalização de path (`server01/uploads` → `server01/api/uploads`), o equivalente para localhost é tratado coerentemente ou removido se não fizer sentido fora do contexto do proxy.
- [ ] O log do script imprime cada URL atualizada (formato similar ao atual).
- [ ] Execução manual: `npx tsx update_urls.ts` roda sem erro contra o banco local.

### US-004: Resetar banco e reexecutar seed
**Description:** Como desenvolvedor, quero recriar o banco local com o seed atualizado para que todos os registros de demonstração já nasçam com URLs apontando para `http://localhost:3000`.

**Acceptance Criteria:**
- [ ] `npx prisma migrate reset --force` (ou comando equivalente do projeto que dispara o seed) executa sem erro.
- [ ] Após o reset, uma query SQL ou script de verificação mostra que **nenhum** registro em `PropertyImage.url` contém `lab.alphaedtech` ou `server01`.
- [ ] Todos os registros de `PropertyImage` para os imóveis de demo apontam para `http://localhost:3000/uploads/...`.

### US-005: Verificação final de varredura
**Description:** Como desenvolvedor, quero confirmar que nenhuma menção residual a `lab.alphaedtech` ou `server01` permanece em arquivos de código executável da branch.

**Acceptance Criteria:**
- [ ] `grep -rn "lab.alphaedtech\|server01" --include="*.ts" --include="*.js" --include="*.json"` excluindo `node_modules`, `tasks/`, `*.md` e `plan_hospedagem.md` retorna zero ocorrências.
- [ ] `.env` e `.env.example` foram inspecionados e (se houver menções) limpos ou comentados — fora do escopo se essas variáveis não existirem nesses arquivos.
- [ ] `npx tsc --noEmit` passa sem erros novos.
- [ ] `npm run dev` inicia a API e responde em `http://localhost:3000`.

## 4. Functional Requirements

- **FR-1:** O array `servers` do Swagger em `src/config/swagger.ts` deve conter exatamente uma entrada com `url: 'http://localhost:3000'`.
- **FR-2:** Todas as URLs de imagens hardcoded em `prisma/demoData.ts` devem usar o prefixo `http://localhost:3000` e remover o segmento `/server01/api`, mantendo apenas `/uploads/{propertyId}/{filename}`.
- **FR-3:** O script `update_urls.ts` deve, ao ser executado, transformar registros do banco que contêm o host `lab.alphaedtech.org.br` em URLs com host `localhost:3000`, preservando o caminho do arquivo.
- **FR-4:** Após o reset+seed, o banco não deve conter nenhuma URL apontando para `lab.alphaedtech` ou contendo o segmento `server01`.
- **FR-5:** Nenhum arquivo TypeScript/JavaScript/JSON da branch (excluindo `node_modules` e `tasks/`) deve conter as strings `lab.alphaedtech` ou `server01` ao final da execução.
- **FR-6:** A API deve continuar inicializando e o endpoint `/docs/` deve renderizar com o novo servidor configurado.

## 5. Non-Goals (Out of Scope)

- **Não** alterar arquivos Markdown de documentação (`plan_hospedagem.md`, READMEs, outros docs em `tasks/`). Esses arquivos descrevem infraestrutura histórica e ficam preservados.
- **Não** mudar variáveis de ambiente para suportar configuração dinâmica via `BASE_URL` — a substituição é por strings literais para minimizar diff em emergência.
- **Não** mexer em configurações de Nginx, deploy, CI/CD, Dockerfile, docker-compose ou qualquer infraestrutura externa.
- **Não** migrar dados de produção — o reset+seed é local apenas.
- **Não** alterar lógica de upload, multer, ou outros componentes além das URLs hardcoded mencionadas.
- **Não** introduzir feature flags, tornar o host configurável, ou refatorar para evitar regressões futuras — foco exclusivo em substituir as strings.
- **Não** alterar `update_urls.ts` para deletar — ele será mantido com lógica invertida.

## 6. Technical Considerations

- **Arquivos confirmados que serão tocados:**
  - `src/config/swagger.ts` (1 menção, linha 18)
  - `prisma/demoData.ts` (10 menções, linhas ~332–404)
  - `update_urls.ts` (2 menções, linhas 10 e 12; lógica precisa ser invertida)
- **Convenção de path para uploads:** o path canônico no servidor local é `/uploads/{propertyId}/{filename}`. O segmento `/server01/api/` é específico do reverse proxy de produção e deve ser eliminado.
- **Banco de dados:** assume-se um Postgres local rodando via Docker conforme `.env.example` (`postgresql://admin:.../alphatoca` em `127.0.0.1:5444`). O reset+seed depende desse banco estar acessível.
- **Compatibilidade do front:** o frontend mobile/web consumindo este backend pode estar configurado para apontar para `lab.alphaedtech` — está fora do escopo desta branch alterar o frontend, mas o time deve estar ciente de que o backend agora só responde em localhost.

## 7. Success Metrics

- Zero ocorrências de `lab.alphaedtech` ou `server01` em arquivos `.ts`/`.js`/`.json` executáveis.
- Zero registros em `PropertyImage.url` apontando para `lab.alphaedtech` após o reset+seed.
- API local inicia sem erros e Swagger renderiza com server `http://localhost:3000`.
- Tempo total de implementação: < 30 min (mudança mecânica de strings + reset).

## 8. Open Questions

- O frontend que consome este backend precisa ser ajustado em paralelo? (Fora do escopo, mas vale alinhar com o time.)
- O `.env`/`.env.example` contém alguma variável que referencia o servidor de produção? Se sim, deve ser tratada como FR adicional ou ignorada conforme NG-2 (sem variabilização).
- Após a emergência, esta branch será mergeada para `main` ou descartada? Se for mergeada, o time deve avaliar reverter os impactos antes do próximo deploy de produção.
