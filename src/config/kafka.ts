import { Kafka, logLevel, type Admin } from 'kafkajs';
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
    return ({ log }) => {
      const { message, ...extra } = log;
      logger.info({ ...extra }, `[Kafka] ${message}`);
    };
  },
});

export const admin: Admin = kafka.admin();

export const producer = kafka.producer({
  allowAutoTopicCreation: true,
  idempotent: true,
  maxInFlightRequests: 5,
});

export const consumer = kafka.consumer({
  groupId: 'alphatoca-whatsapp-consumer',
  sessionTimeout: Number(process.env.KAFKA_CONSUMER_SESSION_TIMEOUT ?? 20000),
  heartbeatInterval: Number(process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL ?? 3000),
  rebalanceTimeout: 60000,
});
