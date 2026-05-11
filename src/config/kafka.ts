import { Kafka, logLevel } from 'kafkajs';
import { logger } from './logger';

const brokers = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'];
const clientId = process.env.KAFKA_CLIENT_ID || 'alphatoca-app';

export const kafka = new Kafka({
  clientId,
  brokers,
  logLevel: logLevel.ERROR,
  logCreator: () => {
    return ({ log }) => {
      const { message, ...extra } = log;
      logger.info(extra, `[Kafka] ${message}`);
    };
  },
});

export const producer = kafka.producer();

export const connectProducer = async () => {
  await producer.connect();
  logger.info('[Kafka] Produtor conectado');
};
