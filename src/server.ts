import 'dotenv/config';
import http from 'http';

import app from './app';
import { setupSwagger } from './config/swagger';
import { bootstrapLangSmith } from './config/langsmith';
import { assertRagSecrets } from './config/rag';
import { validateWebhookConfig } from './controllers/webhookController';
import { initializeSocket } from './config/socket';
import { initializeKafkaConsumerWithPrisma, shutdownKafkaConsumer } from './services/kafkaConsumerInit';
import { connectProducer, disconnectProducer } from './services/kafkaProducer';
import { logger } from './config/logger';
import { connectProducer, disconnectProducer } from './services/kafkaProducer';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

(async () => {
    if (process.env.DISABLE_WORKERS === 'true') {
        logger.warn('[server] workers desabilitados via DISABLE_WORKERS');
    } else {
        // whatsappWorker foi migrado para Kafka consumer (ver kafkaConsumerInit).
        await import('./workers/visitReminderWorker');
    }

    // Fail-fast: valida configuração crítica antes de aceitar requisições.
    if (process.env.DISABLE_RAG_VALIDATION === 'true') {
        logger.warn('[server] RAG secret validation pulada via DISABLE_RAG_VALIDATION — endpoints RAG podem falhar');
    } else {
        assertRagSecrets();
    }
    validateWebhookConfig();

    // Inicializa integrações
    bootstrapLangSmith();
    setupSwagger(app);

    const server = http.createServer(app);

    // Anexa WebSocket (Socket.IO) ao servidor HTTP
    initializeSocket(server);

    // Inicializa Kafka Producer e Consumer (substitui BullMQ workers).
    // Também é desabilitado pela flag DISABLE_WORKERS para debug local sem broker.
    if (process.env.DISABLE_WORKERS !== 'true') {
        connectProducer().catch((err) => {
            logger.error({ err }, '[server] failed to connect kafka producer');
        });
        initializeKafkaConsumerWithPrisma().catch((err) => {
            logger.error({ err }, '[server] failed to start kafka consumer');
        });
    }

    // Graceful shutdown
    function gracefulShutdown(signal: string): void {
        logger.info({ signal }, '[server] received shutdown signal');
        server.close(async () => {
            await shutdownKafkaConsumer().catch((err) => {
                logger.error({ err }, '[server] failed to shutdown kafka consumer');
            });
            await disconnectProducer().catch((err) => {
                logger.error({ err }, '[server] failed to disconnect kafka producer');
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
})();
