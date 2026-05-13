"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumer = exports.producer = exports.admin = exports.kafka = void 0;
const kafkajs_1 = require("kafkajs");
const logger_1 = require("./logger");
// Lazy init: a validação de KAFKA_BROKERS só dispara quando o cliente é
// realmente usado, evitando que o import deste módulo derrube ambientes
// (testes, scripts) que não tocam em Kafka.
let _kafka;
let _admin;
let _producer;
let _consumer;
function getKafka() {
    if (_kafka)
        return _kafka;
    if (!process.env.KAFKA_BROKERS) {
        throw new Error('[Kafka] KAFKA_BROKERS não definida. Ex: localhost:9092 ou broker1:9092,broker2:9092,broker3:9092');
    }
    const brokers = process.env.KAFKA_BROKERS.split(',').map((b) => b.trim());
    _kafka = new kafkajs_1.Kafka({
        clientId: 'alphatoca-backend',
        brokers,
        logLevel: kafkajs_1.logLevel.ERROR,
        logCreator: () => {
            return ({ log }) => {
                const { message, ...extra } = log;
                logger_1.logger.info({ ...extra }, `[Kafka] ${message}`);
            };
        },
    });
    return _kafka;
}
function getAdmin() {
    if (!_admin)
        _admin = getKafka().admin();
    return _admin;
}
function getProducer() {
    if (!_producer) {
        _producer = getKafka().producer({
            allowAutoTopicCreation: true,
            idempotent: true,
            maxInFlightRequests: 5,
        });
    }
    return _producer;
}
function getConsumer() {
    if (!_consumer) {
        _consumer = getKafka().consumer({
            groupId: 'alphatoca-whatsapp-consumer',
            sessionTimeout: Number(process.env.KAFKA_CONSUMER_SESSION_TIMEOUT ?? 20000),
            heartbeatInterval: Number(process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL ?? 3000),
            rebalanceTimeout: 60000,
        });
    }
    return _consumer;
}
function lazyProxy(resolver) {
    return new Proxy({}, {
        get(_, prop, receiver) {
            const target = resolver();
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
        has(_, prop) {
            return prop in resolver();
        },
    });
}
exports.kafka = lazyProxy(getKafka);
exports.admin = lazyProxy(getAdmin);
exports.producer = lazyProxy(getProducer);
exports.consumer = lazyProxy(getConsumer);
