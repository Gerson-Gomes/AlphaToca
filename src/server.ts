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
import { initializeKafkaConsumerWithPrisma, shutdownKafkaConsumer } from './services/kafkaConsumerInit';
import { logger } from './config/logger';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Fail-fast: valida configuração crítica antes de aceitar requisições.
validateWebhookConfig();
assertRagSecrets();
bootstrapLangSmith();

const server = http.createServer(app);

// Configura Swagger
setupSwagger(app);

// Anexa WebSocket (Socket.IO) ao servidor HTTP
initializeSocket(server);

// Inicializa Kafka Consumer (substitui BullMQ workers)
initializeKafkaConsumerWithPrisma().catch((err) => {
    logger.error({ err }, '[server] failed to start kafka consumer');
});

// Graceful shutdown
function gracefulShutdown(signal: string): void {
    logger.info({ signal }, '[server] received shutdown signal');
    server.close(async () => {
        await shutdownKafkaConsumer().catch((err) => {
            logger.error({ err }, '[server] failed to shutdown kafka consumer');
        });
        logger.info({ signal }, '[server] closed');
        process.exit(0);
    });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, '[server] HTTP + WebSocket + Kafka running on 0.0.0.0');
});
