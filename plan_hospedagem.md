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
    *   Copiar o arquivo de exemplo e preencher com os dados de produção (Banco de dados, chaves API, Firebase, Supabase, JWT secret, etc.).
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
    *   Rodar as migrations do Prisma para garantir que o banco de dados (que parece ser Supabase pelo histórico) esteja atualizado.
    ```bash
    npx prisma migrate deploy
    ```

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
3. Ajustar o `.env` com as configurações de produção (Supabase, Firebase, chaves de API, etc.).
4. Testar o acesso via `http://desafio01.alphaedtech` (ou IP) na mesma rede da VPN.
