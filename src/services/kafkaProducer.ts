import { producer, kafka } from '../config/kafka';
import { logger } from '../config/logger';
import type { WhatsAppWebhookPayload } from '../types/whatsapp';

/**
 * Interface para opções de produção de evento genérico
 */
export interface ProduceEventOptions {
  topic: string;
  payload: unknown;
  key?: string;
}

/**
 * Interface para payload de visita (visit reminder)
 */
export interface VisitReminderPayload {
  windowHours: number;
  triggeredAt?: string;
}

/**
 * Produz um evento genérico para um tópico Kafka.
 *
 * @param opts - Opções: topic, payload, key (opcional para particionamento)
 * @throws Error se a produção falhar
 */
export async function produceEvent(opts: ProduceEventOptions): Promise<void> {
  try {
    await producer.send({
      topic: opts.topic,
      messages: [
        {
          key: opts.key ?? null,
          value: JSON.stringify(opts.payload),
          headers: {
            'content-type': 'application/json',
            'timestamp': new Date().toISOString(),
          },
        },
      ],
    });

    logger.info(
      { topic: opts.topic, key: opts.key },
      '[kafka-producer] event produced successfully'
    );
  } catch (err) {
    logger.error(
      { err, topic: opts.topic, key: opts.key },
      '[kafka-producer] produce failed'
    );
    throw err;
  }
}

/**
 * Produz uma mensagem de WhatsApp para o tópico 'whatsapp-messages'.
 * Key é o phoneNumber para garantir ordem de processamento por usuário (particionamento).
 *
 * @param payload - Payload do webhook do WhatsApp
 * @param phoneNumber - Número de telefone do remetente (usado como key)
 * @throws Error se a produção falhar
 */
export async function produceWhatsAppMessage(
  payload: WhatsAppWebhookPayload,
  phoneNumber?: string
): Promise<void> {
  const extractedPhoneNumber =
    phoneNumber ?? payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id;

  const key = extractedPhoneNumber ?? `wa-${Date.now()}`;

  await produceEvent({
    topic: 'whatsapp-messages',
    payload,
    key,
  });

  logger.info(
    { phoneNumber: extractedPhoneNumber, hasPayload: !!payload },
    '[kafka-producer] WhatsApp message produced'
  );
}

/**
 * Produz um evento de lembrete de visita para o tópico 'visit-reminders'.
 * Key é único (timestamp) para distribuir reminders entre partitions.
 *
 * @param payload - Payload do lembrete (ex: { windowHours: 24 })
 * @param key - Chave única para o evento (ex: reminder-24h-1234567890)
 * @throws Error se a produção falhar
 */
export async function produceVisitReminder(
  payload: VisitReminderPayload,
  key?: string
): Promise<void> {
  const eventKey = key ?? `reminder-${Date.now()}`;

  await produceEvent({
    topic: 'visit-reminders',
    payload,
    key: eventKey,
  });

  logger.info(
    { windowHours: payload.windowHours, key: eventKey },
    '[kafka-producer] visit reminder produced'
  );
}

/**
 * Conecta o producer ao Kafka (lazy connect).
 * Chamado automaticamente na primeira produção, mas pode ser pré-conectado.
 *
 * @throws Error se falhar conectar
 */
export async function connectProducer(): Promise<void> {
  try {
    await producer.connect();
    logger.info('[kafka-producer] connected successfully');
  } catch (err) {
    logger.error({ err }, '[kafka-producer] connect failed');
    throw err;
  }
}

/**
 * Desconecta o producer do Kafka.
 * Chamado durante shutdown graceful.
 *
 * @throws Error se falhar desconectar
 */
export async function disconnectProducer(): Promise<void> {
  try {
    await producer.disconnect();
    logger.info('[kafka-producer] disconnected successfully');
  } catch (err) {
    logger.error({ err }, '[kafka-producer] disconnect failed');
    throw err;
  }
}
