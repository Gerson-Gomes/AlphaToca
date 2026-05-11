import { Kafka, logLevel, type IAdmin } from 'kafkajs';
import { logger } from './logger';

if (!process.env.KAFKA_BROKERS) {
  throw new Error(
    '[Kafka] KAFKA_BROKERS não definida. Ex: localhost:9092 ou broker1:9092,broker2:9092,broker3:9092'
  );
}

const brokers = process.env.KAFKA_BROKERS.split(',').map((b) => b.trim());

export const kafka = new Kafka({
  clientId: 'alphatoca-backend',
  brokers,
  logLevel: logLevel.ERROR,
  logCreator: () => {
    return ({ namespace, level, label, log }) => {
      const logFn = level <= logLevel.ERROR ? logger.error : logger.debug;
      logFn({ namespace, level, label, ...log });
    };
  },
});

export const admin: IAdmin = kafka.admin();

export const producer = kafka.producer({
  allowAutoTopicCreation: false,
  idempotent: true,
  maxInFlightRequests: 5,
  compression: 1, // GZIP
  timeout: Number(process.env.KAFKA_PRODUCER_TIMEOUT ?? 30000),
});

export const consumer = kafka.consumer({
  groupId: 'alphatoca-whatsapp-consumer',
  sessionTimeout: Number(process.env.KAFKA_CONSUMER_SESSION_TIMEOUT ?? 20000),
  heartbeatInterval: Number(process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL ?? 3000),
  rebalanceTimeout: 60000,
});
