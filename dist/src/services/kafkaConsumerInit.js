"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeKafkaConsumerWithPrisma = initializeKafkaConsumerWithPrisma;
exports.shutdownKafkaConsumer = shutdownKafkaConsumer;
const db_1 = __importDefault(require("../config/db"));
const kafkaConsumer_1 = require("./kafkaConsumer");
const logger_1 = require("../config/logger");
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
async function initializeKafkaConsumerWithPrisma() {
    try {
        const options = {
            db: { prisma: db_1.default },
            redisUrl: process.env.REDIS_URL,
        };
        await (0, kafkaConsumer_1.startKafkaConsumer)(options);
        logger_1.logger.info('[kafka-consumer-init] initialized with Prisma');
    }
    catch (err) {
        logger_1.logger.error({ err }, '[kafka-consumer-init] failed to initialize');
        throw err;
    }
}
/**
 * Para o Kafka Consumer
 * Funciona com qualquer banco de dados
 */
async function shutdownKafkaConsumer() {
    try {
        await (0, kafkaConsumer_1.stopKafkaConsumer)();
        logger_1.logger.info('[kafka-consumer-init] shutdown complete');
    }
    catch (err) {
        logger_1.logger.error({ err }, '[kafka-consumer-init] failed to shutdown');
        throw err;
    }
}
