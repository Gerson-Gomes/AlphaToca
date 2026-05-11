# Plano de Implementação para Hospedagem: AlphaToca Backend

Este documento descreve os passos necessários para configurar e hospedar a API AlphaToca-Backend no servidor especificado.

## Dados do Servidor
*   **Servidor:** desafio01
*   **DNS/VPN:** desafio01.alphaedtech
*   **IP:** 10.10.0.201/24
*   **Usuário:** desafio01
*   **Senha:** ****** (A ser utilizada nas autenticações necessárias, não armazenar em texto plano onde possível)

## 1. Preparação do Servidor
1.  **Acesso:** Conectar via SSH utilizando as credenciais fornecidas:
    `ssh desafio01@desafio01.alphaedtech` (ou usando o IP `ssh desafio01@10.10.0.201`)
2.  **Atualização do Sistema:** Executar atualização dos pacotes:
    ```bash
    sudo apt update && sudo apt upgrade -y
    ```
3.  **Instalação de Dependências Essenciais:**
    *   Node.js (versão recomendada: LTS mais recente, ex: 20.x ou 22.x)
    *   NPM ou Yarn ou PNPM (gerenciador de pacotes utilizado pelo projeto)
    *   Git
    *   PM2 (Process Manager para manter a API rodando em background e reiniciar em caso de falhas)
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs git
    sudo npm install -pm2 -g
    ```

## 2. Deploy da Aplicação
1.  **Clonar o Repositório:**
    *   Criar um diretório para a aplicação (ex: `/var/www/alphatoca-backend` ou no home do usuário `~/alphatoca-backend`).
    *   Clonar via Git.
    ```bash
    mkdir -p ~/apps
    cd ~/apps
    git clone <URL_DO_REPOSITORIO> alphatoca-backend
    cd alphatoca-backend
    ```
2.  **Instalação de Pacotes da Aplicação:**
    ```bash
    npm install
    ```
3.  **Configuração de Variáveis de Ambiente (.env):**
    *   Copiar o arquivo de exemplo e preencher com os dados de produção (banco de dados, chaves API, Firebase, JWT secret, etc.). O backend usa Postgres nativo co-localizado: configurar `DATABASE_URL` e `DIRECT_URL` apontando para `127.0.0.1:5432` (ver seção 2.5 abaixo e `scripts/db-migration/01-provision-postgres.sh`).
    ```bash
    cp .env.example .env
    nano .env # Editar com as configurações reais de produção
    ```
4.  **Build (se aplicável):**
    *   Sendo um projeto TypeScript (como indicado pelos arquivos `.ts`), é necessário compilar para JavaScript.
    ```bash
    npm run build
    ```
5.  **Migrações de Banco de Dados:**
    *   Rodar as migrations do Prisma para garantir que o banco de dados Postgres nativo (rodando na mesma máquina, em `127.0.0.1:5432`) esteja atualizado.
    ```bash
    npx prisma migrate deploy
    ```

## 2.5 Banco de Dados Local

A partir da migração documentada no PRD da migração de banco para localhost (em `tasks/`), o banco de dados de produção é Postgres 16 nativo (instalado via apt), co-localizado com a API no servidor `desafio01.alphaedtech` e ouvindo apenas em `localhost`. O índice operacional completo está em `scripts/db-migration/README.md`.

1.  **Provisionamento (uma vez por servidor):** Executar como root o script `scripts/db-migration/01-provision-postgres.sh`. Ele instala `postgresql-16` / `postgresql-contrib-16`, cria o role `imoveis` e o database `imoveis` (`UTF8` / `en_US.UTF-8`), trava `listen_addresses = 'localhost'`, e imprime uma única vez a senha gerada para uso no `.env`.
2.  **Variáveis de ambiente:** Após o provisionamento, ajustar o `.env` da aplicação:
    ```env
    DATABASE_URL="postgresql://imoveis:<senha>@127.0.0.1:5432/imoveis?schema=public"
    DIRECT_URL="postgresql://imoveis:<senha>@127.0.0.1:5432/imoveis?schema=public"
    ```
    A senha deve estar URL-encoded (caracteres como `/`, `@`, `:`, `+` precisam ser escapados — o script `04-cutover-env.sh` faz isso automaticamente).
3.  **Cutover e validação:** O procedimento operacional completo (`02-dump...sh` → `03-restore...sh` → `04-cutover-env.sh` → `05-smoke-test.sh`) está indexado em `scripts/db-migration/README.md`.
4.  **Rollback:** Em caso de falha crítica do banco local na janela de 72h pós-cutover, seguir o runbook de rollback localizado em `documentation/` (linkado a partir de `scripts/db-migration/README.md`).

## 3. Configuração do Process Manager (PM2)
1.  **Iniciar a Aplicação:**
    ```bash
    # Supondo que o build gera arquivos na pasta 'dist' e o ponto de entrada seja 'dist/app.js' ou 'dist/server.js'
    pm2 start dist/app.js --name "alphatoca-backend"
    ```
2.  **Configurar PM2 para Iniciar com o Sistema:**
    ```bash
    pm2 startup
    # O comando acima gera um script, que você deve copiar e colar no terminal.
    pm2 save
    ```

## 4. Configuração do Reverse Proxy (Nginx)
Para expor a API de forma segura e usar nomes de domínio/SSL.
1.  **Instalar Nginx:**
    ```bash
    sudo apt install nginx -y
    ```
2.  **Configurar Virtual Host:**
    *   Criar um arquivo de configuração para a API em `/etc/nginx/sites-available/alphatoca-backend`.
    ```nginx
    server {
        listen 80;
        server_name desafio01.alphaedtech 10.10.0.201;

        location / {
            proxy_pass http://localhost:3000; # Substituir 3000 pela porta real da sua API
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }
    }
    ```
3.  **Ativar o Site e Reiniciar Nginx:**
    ```bash
    sudo ln -s /etc/nginx/sites-available/alphatoca-backend /etc/nginx/sites-enabled/
    sudo nginx -t # Testar a configuração
    sudo systemctl restart nginx
    ```

## 5. Segurança e Firewall (UFW)
1.  **Configurar Firewall:** Permitir tráfego SSH, HTTP e HTTPS.
    ```bash
    sudo ufw allow OpenSSH
    sudo ufw allow 'Nginx Full'
    sudo ufw enable
    ```

## 6. (Opcional, mas recomendado) Certificado SSL
Se o domínio `desafio01.alphaedtech` for acessível externamente e resolver para o IP corretamente (ou se usar um domínio real):
1.  **Instalar Certbot:**
    ```bash
    sudo apt install certbot python3-certbot-nginx -y
    sudo certbot --nginx -d desafio01.alphaedtech
    ```
    *Nota: Se for uma VPN interna sem acesso direto à internet para validação HTTP-01 do Let's Encrypt, pode ser necessário gerenciar certificados internamente ou usar validação DNS.*

## Resumo dos Próximos Passos
1. Conectar no servidor via SSH.
2. Seguir as etapas de preparação e deploy.
3. Ajustar o `.env` com as configurações de produção (`DATABASE_URL` e `DIRECT_URL` apontando para o Postgres local em `127.0.0.1:5432`, Firebase, chaves de API, etc.).
4. Testar o acesso via `http://desafio01.alphaedtech` (ou IP) na mesma rede da VPN.
