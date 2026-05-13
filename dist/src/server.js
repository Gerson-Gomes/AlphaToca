"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = __importDefault(require("http"));
const app_1 = __importDefault(require("./app"));
const swagger_1 = require("./config/swagger");
const langsmith_1 = require("./config/langsmith");
const rag_1 = require("./config/rag");
const webhookController_1 = require("./controllers/webhookController");
const socket_1 = require("./config/socket");
const kafkaConsumerInit_1 = require("./services/kafkaConsumerInit");
const kafkaProducer_1 = require("./services/kafkaProducer");
const logger_1 = require("./config/logger");
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
(async () => {
    if (process.env.DISABLE_WORKERS === 'true') {
        logger_1.logger.warn('[server] workers desabilitados via DISABLE_WORKERS');
    }
    else {
        // whatsappWorker foi migrado para Kafka consumer (ver kafkaConsumerInit).
        await Promise.resolve().then(() => __importStar(require('./workers/visitReminderWorker')));
    }
    // Fail-fast: valida configuração crítica antes de aceitar requisições.
    if (process.env.DISABLE_RAG_VALIDATION === 'true') {
        logger_1.logger.warn('[server] RAG secret validation pulada via DISABLE_RAG_VALIDATION — endpoints RAG podem falhar');
    }
    else {
        (0, rag_1.assertRagSecrets)();
    }
    (0, webhookController_1.validateWebhookConfig)();
    // Inicializa integrações
    (0, langsmith_1.bootstrapLangSmith)();
    (0, swagger_1.setupSwagger)(app_1.default);
    const server = http_1.default.createServer(app_1.default);
    // Anexa WebSocket (Socket.IO) ao servidor HTTP
    (0, socket_1.initializeSocket)(server);
    // Inicializa Kafka Producer e Consumer (substitui BullMQ workers).
    // Também é desabilitado pela flag DISABLE_WORKERS para debug local sem broker.
    if (process.env.DISABLE_WORKERS !== 'true') {
        (0, kafkaProducer_1.connectProducer)().catch((err) => {
            logger_1.logger.error({ err }, '[server] failed to connect kafka producer');
        });
        (0, kafkaConsumerInit_1.initializeKafkaConsumerWithPrisma)().catch((err) => {
            logger_1.logger.error({ err }, '[server] failed to start kafka consumer');
        });
    }
    // Graceful shutdown
    function gracefulShutdown(signal) {
        logger_1.logger.info({ signal }, '[server] received shutdown signal');
        server.close(async () => {
            await (0, kafkaConsumerInit_1.shutdownKafkaConsumer)().catch((err) => {
                logger_1.logger.error({ err }, '[server] failed to shutdown kafka consumer');
            });
            await (0, kafkaProducer_1.disconnectProducer)().catch((err) => {
                logger_1.logger.error({ err }, '[server] failed to disconnect kafka producer');
            });
            logger_1.logger.info({ signal }, '[server] closed');
            process.exit(0);
        });
    }
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    server.listen(port, '0.0.0.0', () => {
        logger_1.logger.info({ port }, '[server] HTTP + WebSocket + Kafka running on 0.0.0.0');
    });
})();
