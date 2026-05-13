"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.produceEvent = produceEvent;
exports.produceWhatsAppMessage = produceWhatsAppMessage;
exports.produceVisitReminder = produceVisitReminder;
exports.connectProducer = connectProducer;
exports.disconnectProducer = disconnectProducer;
const kafka_1 = require("../config/kafka");
const logger_1 = require("../config/logger");
/**
 * Produz um evento genérico para um tópico Kafka.
 *
 * @param opts - Opções: topic, payload, key (opcional para particionamento)
 * @throws Error se a produção falhar
 */
async function produceEvent(opts) {
    try {
        await connectProducer();
        await kafka_1.producer.send({
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
        logger_1.logger.info({ topic: opts.topic, key: opts.key }, '[kafka-producer] event produced successfully');
    }
    catch (err) {
        // Reconecta e tenta mais uma vez em erros retriable (ex: desconexão)
        if (err?.retriable) {
            logger_1.logger.warn({ topic: opts.topic }, '[kafka-producer] retrying after reconnect');
            try {
                await connectProducer();
                await kafka_1.producer.send({
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
                logger_1.logger.info({ topic: opts.topic, key: opts.key }, '[kafka-producer] event produced (retry)');
                return;
            }
            catch (retryErr) {
                logger_1.logger.error({ err: retryErr, topic: opts.topic, key: opts.key }, '[kafka-producer] produce failed after retry');
                throw retryErr;
            }
        }
        logger_1.logger.error({ err, topic: opts.topic, key: opts.key }, '[kafka-producer] produce failed');
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
async function produceWhatsAppMessage(payload, phoneNumber) {
    const extractedPhoneNumber = phoneNumber ?? payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id;
    const key = extractedPhoneNumber ?? `wa-${Date.now()}`;
    await produceEvent({
        topic: 'whatsapp-messages',
        payload,
        key,
    });
    logger_1.logger.info({ phoneNumber: extractedPhoneNumber, hasPayload: !!payload }, '[kafka-producer] WhatsApp message produced');
}
/**
 * Produz um evento de lembrete de visita para o tópico 'visit-reminders'.
 * Key é único (timestamp) para distribuir reminders entre partitions.
 *
 * @param payload - Payload do lembrete (ex: { windowHours: 24 })
 * @param key - Chave única para o evento (ex: reminder-24h-1234567890)
 * @throws Error se a produção falhar
 */
async function produceVisitReminder(payload, key) {
    const eventKey = key ?? `reminder-${Date.now()}`;
    await produceEvent({
        topic: 'visit-reminders',
        payload,
        key: eventKey,
    });
    logger_1.logger.info({ windowHours: payload.windowHours, key: eventKey }, '[kafka-producer] visit reminder produced');
}
/**
 * Conecta o producer ao Kafka (lazy connect).
 * Chamado automaticamente na primeira produção, mas pode ser pré-conectado.
 *
 * @throws Error se falhar conectar
 */
async function connectProducer() {
    try {
        await kafka_1.producer.connect();
        logger_1.logger.info('[kafka-producer] connected successfully');
    }
    catch (err) {
        logger_1.logger.error({ err }, '[kafka-producer] connect failed');
        throw err;
    }
}
/**
 * Desconecta o producer do Kafka.
 * Chamado durante shutdown graceful.
 *
 * @throws Error se falhar desconectar
 */
async function disconnectProducer() {
    try {
        await kafka_1.producer.disconnect();
        logger_1.logger.info('[kafka-producer] disconnected successfully');
    }
    catch (err) {
        logger_1.logger.error({ err }, '[kafka-producer] disconnect failed');
        throw err;
    }
}
