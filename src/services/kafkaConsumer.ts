import { consumer } from '../config/kafka';
import { logger } from '../config/logger';
import { handleWhatsappMessage, type WhatsappHandlerDeps } from '../workers/whatsappWorker';
import { sendMessage as defaultSendMessage } from './whatsappService';
import { generateAnswer as defaultGenerateAnswer } from './ragChainService';
import { extractInsights as defaultExtractInsights } from './leadExtractionService';
import { extractSearchFilters as defaultExtractSearchFilters } from './searchExtractionService';
import { propertyService } from './propertyService';
import { checkPhoneRateLimit } from '../utils/phoneRateLimiter';
import IORedis from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import type { WhatsAppWebhookPayload } from '../types/whatsapp';
import type { EachMessagePayload } from 'kafkajs';
import { PHONE_RATE_LIMIT, PHONE_RATE_WINDOW_SECONDS } from '../workers/whatsappWorker';

/**
 * Interface abstrata para operações de banco de dados
 * Permite qualquer implementação (Prisma, TypeORM, Firebase, etc.)
 */
export interface DatabaseAdapter {
  prisma: WhatsappHandlerDeps['prisma'];
}

/**
 * Opções para configurar o Kafka Consumer
 * Abstrai dependências de banco de dados
 */
export interface KafkaConsumerOptions {
  db: DatabaseAdapter;
  redisUrl?: string;
}

let isConsumerRunning = false;
let currentOptions: KafkaConsumerOptions | null = null;
let redisConnection: IORedis | null = null;
let socketEmitter: Emitter | null = null;

/**
 * Inicializa a conexão Redis e Socket.io emitter (compartilhado com whatsappWorker)
 */
function initializeRedisConnection(redisUrl?: string): void {
  if (redisConnection) {
    return; // Já inicializado
  }

  const url = redisUrl ?? process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      '[KafkaConsumer] REDIS_URL não definida. Consumer precisa de Redis para emitir eventos Socket.io'
    );
  }

  redisConnection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: () => null,
  });

  redisConnection.on('error', (err) => {
    logger.error({ err }, '[kafka-consumer] redis connection error');
  });

  socketEmitter = new Emitter(redisConnection);
}

/**
 * Handler para mensagens do tópico 'whatsapp-messages'
 * Processa mensagens de WhatsApp através do handleWhatsappMessage
 */
async function handleWhatsappMessageFromKafka(
  payload: EachMessagePayload,
  options: KafkaConsumerOptions
): Promise<void> {
  const startedAt = Date.now();
  const topic = payload.topic;
  const partition = payload.partition;
  const offset = payload.message.offset.toString();

  try {
    const messageValue = payload.message.value?.toString();
    if (!messageValue) {
      logger.warn(
        { topic, partition, offset },
        '[kafka-consumer] empty message value; skipping'
      );
      return;
    }

    const webhookPayload: WhatsAppWebhookPayload = JSON.parse(messageValue);
    const wamid = webhookPayload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
    const phoneNumber = webhookPayload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id;

    const consumerLog = logger.child({ topic, partition, offset, wamid, phoneNumber });

    // Inicializa socket emitter se necessário
    if (!socketEmitter) {
      initializeRedisConnection(options.redisUrl);
    }

    const result = await handleWhatsappMessage(webhookPayload, {
      prisma: options.db.prisma,
      sendMessage: defaultSendMessage,
      generateAnswer: defaultGenerateAnswer,
      extractInsights: defaultExtractInsights,
      extractSearchFilters: defaultExtractSearchFilters,
      searchProperties: propertyService.searchProperties.bind(propertyService),
      appBaseUrl: process.env.APP_BASE_URL || 'https://app.i-moveis.com',
      log: consumerLog,
      checkRateLimit: (phone: string) =>
        checkPhoneRateLimit(redisConnection!, phone, {
          limit: PHONE_RATE_LIMIT,
          windowSeconds: PHONE_RATE_WINDOW_SECONDS,
        }),
      emitEvent: async (event: string, data: any) => {
        const tenantId = data?.tenantId;
        const landlordId = data?.landlordId;
        const senderType = data?.message?.senderType;

        if (!socketEmitter) return;

        try {
          if (tenantId) {
            socketEmitter.to(`user:${tenantId}`).emit(event, data);
            consumerLog.info({ event, tenantId }, '[kafka-consumer] socket event sent to tenant');
          }
          if (landlordId) {
            socketEmitter.to(`landlord:${landlordId}`).emit('new_lead', data);
            consumerLog.info({ event, landlordId }, '[kafka-consumer] socket event sent to landlord');
          } else if (senderType === 'TENANT' || event === 'session_updated') {
            socketEmitter.to('provider:all').emit(event, data);
            consumerLog.info({ event }, '[kafka-consumer] socket event sent to providers');
          }
        } catch (emitErr) {
          consumerLog.error({ err: emitErr, event }, '[kafka-consumer] socket emit failed');
        }
      },
    });

    const elapsedMs = Date.now() - startedAt;
    consumerLog.info(
      { success: result.success, handoff: result.handoff, ragError: result.ragError, elapsedMs },
      '[kafka-consumer] message processed'
    );
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    logger.error(
      { err, topic, partition, offset, elapsedMs },
      '[kafka-consumer] failed to process whatsapp message'
    );
    // Rethrow para Kafka não fazer commit (retry automático)
    throw err;
  }
}

/**
 * Handler para mensagens do tópico 'visit-reminders'
 * Processa eventos de lembrete de visita
 */
async function handleVisitReminderFromKafka(payload: EachMessagePayload): Promise<void> {
  const startedAt = Date.now();
  const topic = payload.topic;
  const partition = payload.partition;
  const offset = payload.message.offset.toString();

  try {
    const messageValue = payload.message.value?.toString();
    if (!messageValue) {
      logger.warn(
        { topic, partition, offset },
        '[kafka-consumer] empty message value; skipping'
      );
      return;
    }

    const reminderPayload = JSON.parse(messageValue);
    const windowHours = reminderPayload.windowHours;

    logger.info(
      { topic, partition, offset, windowHours },
      '[kafka-consumer] processing visit reminder'
    );

    const elapsedMs = Date.now() - startedAt;
    logger.info(
      { topic, partition, offset, windowHours, elapsedMs },
      '[kafka-consumer] visit reminder processed'
    );
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    logger.error(
      { err, topic, partition, offset, elapsedMs },
      '[kafka-consumer] failed to process visit reminder'
    );
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
export async function startKafkaConsumer(options: KafkaConsumerOptions): Promise<void> {
  if (isConsumerRunning) {
    logger.warn('[kafka-consumer] already running; ignoring duplicate start');
    return;
  }

  if (!options.db?.prisma) {
    throw new Error(
      '[KafkaConsumer] options.db.prisma não fornecido. Consumer requer adaptador de banco de dados.'
    );
  }

  currentOptions = options;

  try {
    await consumer.connect();
    logger.info('[kafka-consumer] connected successfully');

    // Subscribe aos tópicos
    await consumer.subscribe({
      topics: ['whatsapp-messages', 'visit-reminders'],
      fromBeginning: false, // Começar do último offset (não reprocessar histórico)
    });
    logger.info('[kafka-consumer] subscribed to topics: whatsapp-messages, visit-reminders');

    // Configurar handler de mensagens
    await consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        if (!currentOptions) {
          logger.error('[kafka-consumer] options not available; skipping message');
          return;
        }

        if (payload.topic === 'whatsapp-messages') {
          await handleWhatsappMessageFromKafka(payload, currentOptions);
        } else if (payload.topic === 'visit-reminders') {
          await handleVisitReminderFromKafka(payload);
        } else {
          logger.warn(
            { topic: payload.topic },
            '[kafka-consumer] unknown topic; ignoring'
          );
        }
      },
    });

    isConsumerRunning = true;
    logger.info('[kafka-consumer] started successfully and waiting for messages');
  } catch (err) {
    logger.error({ err }, '[kafka-consumer] failed to start');
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
export async function stopKafkaConsumer(): Promise<void> {
  if (!isConsumerRunning) {
    logger.warn('[kafka-consumer] not running; ignoring duplicate stop');
    return;
  }

  try {
    await consumer.disconnect();
    logger.info('[kafka-consumer] disconnected successfully');

    if (redisConnection) {
      await redisConnection.disconnect();
      redisConnection = null;
      socketEmitter = null;
      logger.info('[kafka-consumer] redis connection closed');
    }

    isConsumerRunning = false;
    currentOptions = null;
    logger.info('[kafka-consumer] stopped successfully');
  } catch (err) {
    logger.error({ err }, '[kafka-consumer] failed to stop');
    throw err;
  }
}

export function isConsumerRunning_(): boolean {
  return isConsumerRunning;
}
