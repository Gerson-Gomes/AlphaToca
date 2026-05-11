import 'dotenv/config';
import http from 'http';

import app from './app';
// import './workers/whatsappWorker'; (Removido: Migração para Kafka)
import './workers/visitReminderWorker';
import { setupSwagger } from './config/swagger';
import { bootstrapLangSmith } from './config/langsmith';
import { assertRagSecrets } from './config/rag';
import { validateWebhookConfig } from './controllers/webhookController';
import { initializeSocket } from './config/socket';
import { logger } from './config/logger';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Fail-fast: valida configuração crítica antes de aceitar requisições.
assertRagSecrets();
validateWebhookConfig();

// Inicializa integrações
bootstrapLangSmith();
setupSwagger(app);

const server = http.createServer(app);

// Anexa WebSocket (Socket.IO) ao servidor HTTP
initializeSocket(server);

// Task 2: Inicializa o Produtor e o Consumidor Kafka
import { startChatWorker } from './workers/chatWorker';
import { connectProducer } from './config/kafka';

const startApp = async () => {
    try {
        await connectProducer();
        await startChatWorker();
        
        server.listen(port, '0.0.0.0', () => {
            logger.info({ port }, '[server] HTTP + WebSocket running on 0.0.0.0 (Kafka Enabled)');
        });
    } catch (err) {
        logger.error({ err }, '[server] Falha ao iniciar infraestrutura Kafka');
        process.exit(1);
    }
};

startApp();
