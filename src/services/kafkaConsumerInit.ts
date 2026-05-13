import prisma from '../config/db';
import { startKafkaConsumer, stopKafkaConsumer, type KafkaConsumerOptions } from './kafkaConsumer';
import { logger } from '../config/logger';

/**
 * Inicializa o Kafka Consumer com Prisma
 * 
 * Este é um helper específico para a implementação atual com Prisma.
 * Para trocar para outro banco de dados (Firebase, MongoDB, etc),
 * crie um novo arquivo similar e passe um DatabaseAdapter diferente.
 * 
 * Exemplo para Firebase:
 * ```typescript
 * // firebaseKafkaConsumer.ts
 * import { initializeApp } from 'firebase/app';
 * import { getFirestore } from 'firebase/firestore';
 * import { startKafkaConsumer } from './kafkaConsumer';
 * 
 * const db = getFirestore();
 * const options: KafkaConsumerOptions = {
 *   db: { prisma: db }, // Mesmo que o DB seja Firebase, mantemos a interface
 *   redisUrl: process.env.REDIS_URL,
 * };
 * await startKafkaConsumer(options);
 * ```
 */
export async function initializeKafkaConsumerWithPrisma(): Promise<void> {
  try {
    const options: KafkaConsumerOptions = {
      db: { prisma },
      redisUrl: process.env.REDIS_URL,
    };

    await startKafkaConsumer(options);
    logger.info('[kafka-consumer-init] initialized with Prisma');
  } catch (err) {
    logger.error({ err }, '[kafka-consumer-init] failed to initialize');
    throw err;
  }
}

/**
 * Para o Kafka Consumer
 * Funciona com qualquer banco de dados
 */
export async function shutdownKafkaConsumer(): Promise<void> {
  try {
    await stopKafkaConsumer();
    logger.info('[kafka-consumer-init] shutdown complete');
  } catch (err) {
    logger.error({ err }, '[kafka-consumer-init] failed to shutdown');
    throw err;
  }
}
