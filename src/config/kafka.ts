import { Kafka, logLevel, type Admin, type Consumer, type Producer } from 'kafkajs';
import { logger } from './logger';

// Lazy init: a validação de KAFKA_BROKERS só dispara quando o cliente é
// realmente usado, evitando que o import deste módulo derrube ambientes
// (testes, scripts) que não tocam em Kafka.
let _kafka: Kafka | undefined;
let _admin: Admin | undefined;
let _producer: Producer | undefined;
let _consumer: Consumer | undefined;

function getKafka(): Kafka {
  if (_kafka) return _kafka;

  if (!process.env.KAFKA_BROKERS) {
    throw new Error(
      '[Kafka] KAFKA_BROKERS não definida. Ex: localhost:9092 ou broker1:9092,broker2:9092,broker3:9092'
    );
  }

  const brokers = process.env.KAFKA_BROKERS.split(',').map((b) => b.trim());

  _kafka = new Kafka({
    clientId: 'alphatoca-backend',
    brokers,
    logLevel: logLevel.ERROR,
    logCreator: () => {
      return ({ log }) => {
        const { message, ...extra } = log;
        logger.info({ ...extra }, `[Kafka] ${message}`);
      };
    },
  });

  return _kafka;
}

function getAdmin(): Admin {
  if (!_admin) _admin = getKafka().admin();
  return _admin;
}

function getProducer(): Producer {
  if (!_producer) {
    _producer = getKafka().producer({
      allowAutoTopicCreation: true,
      idempotent: true,
      maxInFlightRequests: 5,
    });
  }
  return _producer;
}

function getConsumer(): Consumer {
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

function lazyProxy<T extends object>(resolver: () => T): T {
  return new Proxy({} as T, {
    get(_, prop, receiver) {
      const target = resolver();
      const value = Reflect.get(target as object, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(_, prop) {
      return prop in (resolver() as object);
    },
  });
}

export const kafka: Kafka = lazyProxy(getKafka);
export const admin: Admin = lazyProxy(getAdmin);
export const producer: Producer = lazyProxy(getProducer);
export const consumer: Consumer = lazyProxy(getConsumer);
