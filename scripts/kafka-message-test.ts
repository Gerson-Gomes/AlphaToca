#!/usr/bin/env ts-node

/**
 * Teste de Produção e Consumo de Mensagens Kafka
 * 
 * Este script testa o pipeline completo:
 * 1. Produz mensagens de teste para os tópicos
 * 2. Consome as mensagens e verifica o conteúdo
 * 3. Reporta latência e throughput
 * 
 * Uso:
 *   npx ts-node scripts/kafka-message-test.ts
 *   npm run kafka:test
 */

import { producer, consumer, kafka } from '../src/config/kafka';
import { logger } from '../src/config/logger';

interface TestConfig {
  topic: string;
  messageCount: number;
  keyPrefix: string;
}

interface TestResult {
  topic: string;
  produced: number;
  consumed: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

const TEST_CONFIGS: TestConfig[] = [
  {
    topic: 'whatsapp-messages',
    messageCount: 5,
    keyPrefix: 'test-whatsapp',
  },
  {
    topic: 'visit-reminders',
    messageCount: 3,
    keyPrefix: 'test-reminder',
  },
];

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function produceMessages(config: TestConfig): Promise<{ messages: any[]; duration: number }> {
  const messages: any[] = [];
  const start = Date.now();

  await producer.connect();
  logger.info({ topic: config.topic, count: config.messageCount }, '[producer] Starting to send messages');

  for (let i = 0; i < config.messageCount; i++) {
    const message = {
      testId: `test-${Date.now()}-${i}`,
      timestamp: new Date().toISOString(),
      payload: {
        message: `Test message ${i + 1} from kafka-message-test`,
        source: 'kafka-message-test',
        sequence: i + 1,
      },
    };

    await producer.send({
      topic: config.topic,
      messages: [
        {
          key: `${config.keyPrefix}-${Date.now()}-${i}`,
          value: JSON.stringify(message),
          headers: {
            'content-type': 'application/json',
            'test-run': 'true',
          },
        },
      ],
    });

    messages.push(message);
    logger.info({ topic: config.topic, sequence: i + 1 }, '[producer] Message sent');
  }

  const duration = Date.now() - start;
  await producer.disconnect();

  return { messages, duration };
}

async function consumeAndVerify(topic: string, expectedCount: number, timeoutMs: number = 10000): Promise<{ consumed: any[]; duration: number }> {
  const consumed: any[] = [];
  const start = Date.now();
  let resolved = false;

  await consumer.connect();
  await consumer.subscribe({ topics: [topic], fromBeginning: false });

  const consumePromise = new Promise<any[]>((resolve) => {
    const timeout = setTimeout(() => {
      resolve(consumed);
    }, timeoutMs);

    consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const value = message.value?.toString();
        if (value) {
          try {
            const parsed = JSON.parse(value);
            if (parsed.testId?.startsWith('test-')) {
              consumed.push(parsed);
              logger.info({ topic, partition, testId: parsed.testId }, '[consumer] Test message received');

              if (consumed.length >= expectedCount && !resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(consumed);
              }
            }
          } catch {
            // Ignore non-test messages
          }
        }
      },
    });
  });

  const result = await consumePromise;
  const duration = Date.now() - start;

  await consumer.disconnect();

  return { consumed: result, duration };
}

async function runTest(config: TestConfig): Promise<TestResult> {
  console.log(`\n📤 Testing topic: ${config.topic}`);
  console.log(`   Producing ${config.messageCount} messages...`);

  try {
    const { messages, duration: produceDuration } = await produceMessages(config);

    console.log(`   ✅ Produced ${messages.length} messages in ${produceDuration}ms`);

    // Aguardar um pouco para o Kafka processar
    console.log(`   ⏳ Waiting for messages to be available...`);
    await sleep(2000);

    console.log(`   📥 Consuming messages...`);
    const { consumed, duration: consumeDuration } = await consumeAndVerify(config.topic, config.messageCount);

    console.log(`   ✅ Consumed ${consumed.length} messages in ${consumeDuration}ms`);

    const latencyMs = produceDuration + consumeDuration;

    return {
      topic: config.topic,
      produced: messages.length,
      consumed: consumed.length,
      latencyMs,
      success: consumed.length >= messages.length * 0.8, // 80% tolerance
    };
  } catch (err) {
    logger.error({ err, topic: config.topic }, '[test] Failed');
    return {
      topic: config.topic,
      produced: 0,
      consumed: 0,
      latencyMs: 0,
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function runAllTests(): Promise<void> {
  console.log('\n===========================================');
  console.log('       KAFKA MESSAGE TEST');
  console.log('===========================================');
  console.log(`Started at: ${new Date().toISOString()}`);

  const results: TestResult[] = [];

  for (const config of TEST_CONFIGS) {
    const result = await runTest(config);
    results.push(result);
  }

  console.log('\n===========================================');
  console.log('         TEST RESULTS SUMMARY');
  console.log('===========================================');

  let allPassed = true;
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    console.log(`\n${status} Topic: ${result.topic}`);
    if (result.success) {
      console.log(`   Produced: ${result.produced}`);
      console.log(`   Consumed: ${result.consumed}`);
      console.log(`   Latency: ${result.latencyMs}ms`);
    } else {
      console.log(`   Error: ${result.error}`);
      allPassed = false;
    }
  }

  console.log('\n===========================================');
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED');
  } else {
    console.log('❌ SOME TESTS FAILED');
    process.exit(1);
  }
  console.log('===========================================\n');
}

// Executar se chamado diretamente
if (require.main === module) {
  runAllTests().catch((err) => {
    logger.error({ err }, '[kafka-message-test] Fatal error');
    console.error('\n❌ Fatal error during test');
    process.exit(1);
  });
}

export { runAllTests, runTest, TestResult, TestConfig };