"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startKafkaConsumer = startKafkaConsumer;
exports.stopKafkaConsumer = stopKafkaConsumer;
exports.isConsumerRunning_ = isConsumerRunning_;
const kafka_1 = require("../config/kafka");
const logger_1 = require("../config/logger");
const whatsappWorker_1 = require("../workers/whatsappWorker");
const whatsappService_1 = require("./whatsappService");
const ragChainService_1 = require("./ragChainService");
const leadExtractionService_1 = require("./leadExtractionService");
const searchExtractionService_1 = require("./searchExtractionService");
const propertyService_1 = require("./propertyService");
const phoneRateLimiter_1 = require("../utils/phoneRateLimiter");
const ioredis_1 = __importDefault(require("ioredis"));
const redis_emitter_1 = require("@socket.io/redis-emitter");
const whatsappWorker_2 = require("../workers/whatsappWorker");
let isConsumerRunning = false;
let currentOptions = null;
let redisConnection = null;
let socketEmitter = null;
/**
 * Inicializa a conexão Redis e Socket.io emitter (compartilhado com whatsappWorker)
 */
function initializeRedisConnection(redisUrl) {
    if (redisConnection) {
        return; // Já inicializado
    }
    const url = redisUrl ?? process.env.REDIS_URL;
    if (!url) {
        throw new Error('[KafkaConsumer] REDIS_URL não definida. Consumer precisa de Redis para emitir eventos Socket.io');
    }
    redisConnection = new ioredis_1.default(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: false,
        retryStrategy: () => null,
    });
    redisConnection.on('error', (err) => {
        logger_1.logger.error({ err }, '[kafka-consumer] redis connection error');
    });
    socketEmitter = new redis_emitter_1.Emitter(redisConnection);
}
/**
 * Handler para mensagens do tópico 'whatsapp-messages'
 * Processa mensagens de WhatsApp através do handleWhatsappMessage
 */
async function handleWhatsappMessageFromKafka(payload, options) {
    const startedAt = Date.now();
    const topic = payload.topic;
    const partition = payload.partition;
    const offset = payload.message.offset.toString();
    try {
        const messageValue = payload.message.value?.toString();
        if (!messageValue) {
            logger_1.logger.warn({ topic, partition, offset }, '[kafka-consumer] empty message value; skipping');
            return;
        }
        const webhookPayload = JSON.parse(messageValue);
        const wamid = webhookPayload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
        const phoneNumber = webhookPayload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id;
        const consumerLog = logger_1.logger.child({ topic, partition, offset, wamid, phoneNumber });
        // Inicializa socket emitter se necessário
        if (!socketEmitter) {
            initializeRedisConnection(options.redisUrl);
        }
        const result = await (0, whatsappWorker_1.handleWhatsappMessage)(webhookPayload, {
            prisma: options.db.prisma,
            sendMessage: whatsappService_1.sendMessage,
            generateAnswer: ragChainService_1.generateAnswer,
            extractInsights: leadExtractionService_1.extractInsights,
            extractSearchFilters: searchExtractionService_1.extractSearchFilters,
            searchProperties: propertyService_1.propertyService.searchProperties.bind(propertyService_1.propertyService),
            appBaseUrl: process.env.APP_BASE_URL || 'https://app.i-moveis.com',
            log: consumerLog,
            checkRateLimit: (phone) => (0, phoneRateLimiter_1.checkPhoneRateLimit)(redisConnection, phone, {
                limit: whatsappWorker_2.PHONE_RATE_LIMIT,
                windowSeconds: whatsappWorker_2.PHONE_RATE_WINDOW_SECONDS,
            }),
            emitEvent: async (event, data) => {
                const tenantId = data?.tenantId;
                const landlordId = data?.landlordId;
                const senderType = data?.message?.senderType;
                if (!socketEmitter)
                    return;
                try {
                    if (tenantId) {
                        socketEmitter.to(`user:${tenantId}`).emit(event, data);
                        consumerLog.info({ event, tenantId }, '[kafka-consumer] socket event sent to tenant');
                    }
                    if (landlordId) {
                        socketEmitter.to(`landlord:${landlordId}`).emit('new_lead', data);
                        consumerLog.info({ event, landlordId }, '[kafka-consumer] socket event sent to landlord');
                    }
                    else if (senderType === 'TENANT' || event === 'session_updated') {
                        socketEmitter.to('provider:all').emit(event, data);
                        consumerLog.info({ event }, '[kafka-consumer] socket event sent to providers');
                    }
                }
                catch (emitErr) {
                    consumerLog.error({ err: emitErr, event }, '[kafka-consumer] socket emit failed');
                }
            },
        });
        const elapsedMs = Date.now() - startedAt;
        consumerLog.info({ success: result.success, handoff: result.handoff, ragError: result.ragError, elapsedMs }, '[kafka-consumer] message processed');
    }
    catch (err) {
        const elapsedMs = Date.now() - startedAt;
        logger_1.logger.error({ err, topic, partition, offset, elapsedMs }, '[kafka-consumer] failed to process whatsapp message');
        // Rethrow para Kafka não fazer commit (retry automático)
        throw err;
    }
}
/**
 * Handler para mensagens do tópico 'visit-reminders'
 * Processa eventos de lembrete de visita
 */
async function handleVisitReminderFromKafka(payload) {
    const startedAt = Date.now();
    const topic = payload.topic;
    const partition = payload.partition;
    const offset = payload.message.offset.toString();
    try {
        const messageValue = payload.message.value?.toString();
        if (!messageValue) {
            logger_1.logger.warn({ topic, partition, offset }, '[kafka-consumer] empty message value; skipping');
            return;
        }
        const reminderPayload = JSON.parse(messageValue);
        const windowHours = reminderPayload.windowHours;
        logger_1.logger.info({ topic, partition, offset, windowHours }, '[kafka-consumer] processing visit reminder');
        const elapsedMs = Date.now() - startedAt;
        logger_1.logger.info({ topic, partition, offset, windowHours, elapsedMs }, '[kafka-consumer] visit reminder processed');
    }
    catch (err) {
        const elapsedMs = Date.now() - startedAt;
        logger_1.logger.error({ err, topic, partition, offset, elapsedMs }, '[kafka-consumer] failed to process visit reminder');
        // Rethrow para Kafka não fazer commit (retry automático)
        throw err;
    }
}
/**
 * Inicia o consumer do Kafka
 * Subscribe aos tópicos e começa a processar mensagens
 *
 * @param options - Configuração com adaptador de banco de dados
 * @throws Error se falhar conectar ou configurar consumer
 */
async function startKafkaConsumer(options) {
    if (isConsumerRunning) {
        logger_1.logger.warn('[kafka-consumer] already running; ignoring duplicate start');
        return;
    }
    if (!options.db?.prisma) {
        throw new Error('[KafkaConsumer] options.db.prisma não fornecido. Consumer requer adaptador de banco de dados.');
    }
    currentOptions = options;
    try {
        await kafka_1.consumer.connect();
        logger_1.logger.info('[kafka-consumer] connected successfully');
        // Subscribe aos tópicos
        await kafka_1.consumer.subscribe({
            topics: ['whatsapp-messages', 'visit-reminders'],
            fromBeginning: false, // Começar do último offset (não reprocessar histórico)
        });
        logger_1.logger.info('[kafka-consumer] subscribed to topics: whatsapp-messages, visit-reminders');
        // Configurar handler de mensagens
        await kafka_1.consumer.run({
            eachMessage: async (payload) => {
                if (!currentOptions) {
                    logger_1.logger.error('[kafka-consumer] options not available; skipping message');
                    return;
                }
                if (payload.topic === 'whatsapp-messages') {
                    await handleWhatsappMessageFromKafka(payload, currentOptions);
                }
                else if (payload.topic === 'visit-reminders') {
                    await handleVisitReminderFromKafka(payload);
                }
                else {
                    logger_1.logger.warn({ topic: payload.topic }, '[kafka-consumer] unknown topic; ignoring');
                }
            },
        });
        isConsumerRunning = true;
        logger_1.logger.info('[kafka-consumer] started successfully and waiting for messages');
    }
    catch (err) {
        logger_1.logger.error({ err }, '[kafka-consumer] failed to start');
        currentOptions = null;
        throw err;
    }
}
/**
 * Para o consumer do Kafka
 * Desconecta e limpa recursos
 *
 * @throws Error se falhar desconectar
 */
async function stopKafkaConsumer() {
    if (!isConsumerRunning) {
        logger_1.logger.warn('[kafka-consumer] not running; ignoring duplicate stop');
        return;
    }
    try {
        await kafka_1.consumer.disconnect();
        logger_1.logger.info('[kafka-consumer] disconnected successfully');
        if (redisConnection) {
            await redisConnection.disconnect();
            redisConnection = null;
            socketEmitter = null;
            logger_1.logger.info('[kafka-consumer] redis connection closed');
        }
        isConsumerRunning = false;
        currentOptions = null;
        logger_1.logger.info('[kafka-consumer] stopped successfully');
    }
    catch (err) {
        logger_1.logger.error({ err }, '[kafka-consumer] failed to stop');
        throw err;
    }
}
function isConsumerRunning_() {
    return isConsumerRunning;
}
