#!/usr/bin/env ts-node

/**
 * Health Check para Kafka
 * Verifica se o Kafka está acessível e funcional
 * 
 * Uso: 
 *   npx ts-node scripts/kafka-health-check.ts
 *   npm run kafka:health
 */

import { kafka, admin } from '../src/config/kafka';
import { logger } from '../src/config/logger';

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  checks: {
    name: string;
    status: 'ok' | 'fail';
    message?: string;
    duration?: number;
  }[];
  timestamp: string;
}

async function checkBrokerConnection(): Promise<{ status: 'ok' | 'fail'; message: string; duration: number }> {
  const start = Date.now();
  try {
    await admin.connect();
    const metadata = await admin.fetchMetadata({ topics: [] });
    await admin.disconnect();
    const duration = Date.now() - start;
    return {
      status: 'ok',
      message: `Connected to ${metadata.brokers.length} broker(s)`,
      duration,
    };
  } catch (err) {
    const duration = Date.now() - start;
    return {
      status: 'fail',
      message: err instanceof Error ? err.message : 'Unknown error',
      duration,
    };
  }
}

async function checkTopics(): Promise<{ status: 'ok' | 'fail'; message: string; duration: number }> {
  const start = Date.now();
  try {
    await admin.connect();
    const topics = await admin.listTopics();
    await admin.disconnect();
    const duration = Date.now() - start;

    const requiredTopics = ['whatsapp-messages', 'visit-reminders'];
    const missingTopics = requiredTopics.filter(t => !topics.includes(t));

    if (missingTopics.length > 0) {
      return {
        status: 'fail',
        message: `Missing topics: ${missingTopics.join(', ')}`,
        duration,
      };
    }

    return {
      status: 'ok',
      message: `All required topics exist: ${topics.filter(t => requiredTopics.includes(t)).join(', ')}`,
      duration,
    };
  } catch (err) {
    const duration = Date.now() - start;
    return {
      status: 'fail',
      message: err instanceof Error ? err.message : 'Unknown error',
      duration,
    };
  }
}

async function checkProducer(): Promise<{ status: 'ok' | 'fail'; message: string; duration: number }> {
  const { producer } = await import('../src/config/kafka');
  const start = Date.now();
  try {
    await producer.connect();
    await producer.disconnect();
    const duration = Date.now() - start;
    return {
      status: 'ok',
      message: 'Producer can connect/disconnect successfully',
      duration,
    };
  } catch (err) {
    const duration = Date.now() - start;
    return {
      status: 'fail',
      message: err instanceof Error ? err.message : 'Unknown error',
      duration,
    };
  }
}

async function checkConsumer(): Promise<{ status: 'ok' | 'fail'; message: string; duration: number }> {
  const { consumer } = await import('../src/config/kafka');
  const start = Date.now();
  try {
    await consumer.connect();
    await consumer.disconnect();
    const duration = Date.now() - start;
    return {
      status: 'ok',
      message: 'Consumer can connect/disconnect successfully',
      duration,
    };
  } catch (err) {
    const duration = Date.now() - start;
    return {
      status: 'fail',
      message: err instanceof Error ? err.message : 'Unknown error',
      duration,
    };
  }
}

async function runHealthCheck(): Promise<void> {
  console.log('\n===========================================');
  console.log('       KAFKA HEALTH CHECK');
  console.log('===========================================\n');

  const result: HealthStatus = {
    status: 'healthy',
    checks: [],
    timestamp: new Date().toISOString(),
  };

  console.log('⏳ Checking broker connection...');
  const brokerCheck = await checkBrokerConnection();
  result.checks.push({ name: 'broker_connection', ...brokerCheck });
  console.log(`   ${brokerCheck.status === 'ok' ? '✅' : '❌'} ${brokerCheck.message} (${brokerCheck.duration}ms)`);

  console.log('\n⏳ Checking topics...');
  const topicsCheck = await checkTopics();
  result.checks.push({ name: 'topics', ...topicsCheck });
  console.log(`   ${topicsCheck.status === 'ok' ? '✅' : '❌'} ${topicsCheck.message} (${topicsCheck.duration}ms)`);

  console.log('\n⏳ Checking producer...');
  const producerCheck = await checkProducer();
  result.checks.push({ name: 'producer', ...producerCheck });
  console.log(`   ${producerCheck.status === 'ok' ? '✅' : '❌'} ${producerCheck.message} (${producerCheck.duration}ms)`);

  console.log('\n⏳ Checking consumer...');
  const consumerCheck = await checkConsumer();
  result.checks.push({ name: 'consumer', ...consumerCheck });
  console.log(`   ${consumerCheck.status === 'ok' ? '✅' : '❌'} ${consumerCheck.message} (${consumerCheck.duration}ms)`);

  const failedChecks = result.checks.filter(c => c.status === 'fail');
  if (failedChecks.length > 0) {
    result.status = 'unhealthy';
    console.log('\n❌ HEALTH CHECK FAILED');
    console.log('   Failed checks:', failedChecks.map(c => c.name).join(', '));
  } else {
    console.log('\n✅ ALL CHECKS PASSED - KAFKA IS HEALTHY');
  }

  console.log('\n===========================================');
  console.log(`Timestamp: ${result.timestamp}`);
  console.log(`Overall Status: ${result.status.toUpperCase()}`);
  console.log('===========================================\n');

  if (result.status === 'unhealthy') {
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  runHealthCheck().catch((err) => {
    logger.error({ err }, '[kafka-health-check] Fatal error');
    console.error('\n❌ Fatal error during health check');
    process.exit(1);
  });
}

export { runHealthCheck, HealthStatus };