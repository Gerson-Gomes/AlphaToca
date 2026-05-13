#!/usr/bin/env node

/**
 * Script para criar tópicos Kafka
 * Uso: npx ts-node scripts/create-kafka-topics.ts
 * Ou compile primeiro: npm run build && node dist/scripts/create-kafka-topics.js
 */

import { admin } from '../src/config/kafka';
import { logger } from '../src/config/logger';

interface TopicConfig {
  name: string;
  partitions: number;
  replicationFactor: number;
}

const TOPICS: TopicConfig[] = [
  {
    name: 'whatsapp-messages',
    partitions: 3,
    replicationFactor: 1,
  },
  {
    name: 'visit-reminders',
    partitions: 1,
    replicationFactor: 1,
  },
];

async function createTopics(): Promise<void> {
  try {
    logger.info('[Kafka Topics] Connecting to admin...');
    await admin.connect();

    logger.info('[Kafka Topics] Listing existing topics...');
    const existingTopics = await admin.listTopics();
    logger.info({ topics: existingTopics }, '[Kafka Topics] Existing topics');

    // Filtrar tópicos que já existem
    const topicsToCreate = TOPICS.filter((t) => !existingTopics.includes(t.name));

    if (topicsToCreate.length === 0) {
      logger.info('[Kafka Topics] All topics already exist');
      await admin.disconnect();
      return;
    }

    logger.info(
      { topics: topicsToCreate.map((t) => t.name) },
      '[Kafka Topics] Creating topics...'
    );

    await admin.createTopics({
      topics: topicsToCreate.map((t) => ({
        topic: t.name,
        numPartitions: t.partitions,
        replicationFactor: t.replicationFactor,
      })),
      validateOnly: false,
      timeout: 30000,
    });

    logger.info(
      { topics: topicsToCreate.map((t) => t.name) },
      '[Kafka Topics] Topics created successfully'
    );

    await admin.disconnect();
  } catch (err) {
    logger.error({ err }, '[Kafka Topics] Failed to create topics');
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  createTopics().catch((err) => {
    logger.error({ err }, '[Kafka Topics] Fatal error');
    process.exit(1);
  });
}

export { createTopics };
